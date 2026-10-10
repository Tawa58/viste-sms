import 'server-only'

import { randomInt } from 'node:crypto'
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
import {
  currentMonthPeriod,
  invoiceBlocksPortal,
  invoiceBalance,
  invoicesForBillingPeriod,
} from '@/lib/fees'
import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import { AppError, badRequest, notFound } from '@/server/errors'
import { forget } from '@/server/http/memo'
import { getDoc, setDoc } from '@/server/repositories/firestore-repo'
import { computeConfirmedPaid, resolveBillingTerm } from '@/server/services/finance-service'
import {
  currentPortalMonth,
  formatPortalMonth,
  portalMonthExpiry,
  studentPortalEmail,
} from '@/lib/student-portal'
import type {
  Invoice,
  Student,
  StudentPortalAccess,
  StudentPortalBatchRow,
  StudentPortalStatus,
} from '@/types'

const COLLECTION = 'studentPortalAccess'
const CODE_LENGTH = 8

type PortalRow = {
  id: string
  studentId: string
  studentNumber: string
  authUid: string
  authEmail: string
  /** Plain admin-issued code for the handout sheet; cleared once the student changes it. */
  code: string
  codeChangedByStudent: boolean
  validMonth: string
  expiresAt: string
  issuedAt: string
  issuedBy: string
  issuedByName?: string
  revokedAt?: string | null
}

function portalLocked(message: string) {
  return new AppError(403, 'PORTAL_LOCKED', message)
}

function generateCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) out += String(randomInt(0, 10))
  return out
}

function studentName(s: Student) {
  return [s.firstName, s.lastName].filter(Boolean).join(' ')
}

function rowStatus(row: PortalRow | null): StudentPortalStatus {
  if (!row) return 'NONE'
  if (row.revokedAt) return 'REVOKED'
  if (Date.parse(row.expiresAt) <= Date.now()) return 'EXPIRED'
  return 'ACTIVE'
}

/** Codes are only issued when the student has invoices on record and nothing outstanding. */
async function portalFeeStatus(
  studentId: string,
): Promise<{ cleared: boolean; message?: string }> {
  const [invoices, term] = await Promise.all([
    getAdminDb()
      .collection('invoices')
      .where('studentId', '==', studentId)
      .get(),
    resolveBillingTerm(),
  ])
  if (invoices.empty) {
    return {
      cleared: false,
      message: 'No fee invoice on record. Record the fee payment before issuing a code.',
    }
  }
  const currentInvoices = invoicesForBillingPeriod(
    invoices.docs.map((doc) => ({ ...(doc.data() as Invoice), id: doc.id })),
    term.id,
    currentMonthPeriod(),
  )
  let outstanding = 0
  for (const inv of currentInvoices) {
    if (!invoiceBlocksPortal(inv)) continue
    const paid = await computeConfirmedPaid(inv.id)
    outstanding += invoiceBalance({ ...inv, paid })
  }
  if (outstanding > 0) {
    return {
      cleared: false,
      message: `Fees not cleared — outstanding balance ${outstanding.toFixed(2)}.`,
    }
  }
  if (
    currentInvoices.some(
      (inv) => invoiceBlocksPortal(inv) && (inv.scholarshipAmount ?? 0) > 0,
    )
  ) {
    return { cleared: true, message: 'Cleared by scholarship' }
  }
  return { cleared: true }
}

function toDto(
  student: Student,
  row: PortalRow | null,
  fees: { cleared: boolean; message?: string },
): StudentPortalAccess {
  return {
    studentId: student.id,
    studentNumber: student.studentNumber,
    status: rowStatus(row),
    code: row && !row.revokedAt ? row.code || undefined : undefined,
    codeChangedByStudent: row?.codeChangedByStudent ?? false,
    validMonth: row?.validMonth,
    expiresAt: row?.expiresAt,
    issuedAt: row?.issuedAt,
    issuedByName: row?.issuedByName,
    feeCleared: fees.cleared,
    feeMessage: fees.message,
  }
}

async function loadStudent(studentId: string): Promise<Student> {
  const student = await getDoc<Student>('students', studentId)
  if (!student) throw notFound('Student not found')
  return student
}

export async function getStudentPortalAccess(
  session: SessionContext,
  studentId: string,
): Promise<StudentPortalAccess> {
  requirePermission(session, 'students.create')
  const student = await loadStudent(studentId)
  const [row, fees] = await Promise.all([
    getDoc<PortalRow>(COLLECTION, studentId),
    portalFeeStatus(studentId),
  ])
  return toDto(student, row, fees)
}

/** Create or refresh the student's Firebase login with a fresh code valid for this month. */
async function issueCode(
  session: SessionContext,
  student: Student,
): Promise<{ row: PortalRow; code: string }> {
  if (student.status !== 'ACTIVE') {
    throw badRequest('Only active students can be given portal access')
  }
  const fees = await portalFeeStatus(student.id)
  if (!fees.cleared) throw badRequest(fees.message ?? 'Fees not cleared')

  const code = generateCode()
  const authEmail = studentPortalEmail(student.studentNumber)
  const displayName = studentName(student)
  const existing = await getDoc<PortalRow>(COLLECTION, student.id)
  const auth = getAdminAuth()

  let authUid = existing?.authUid
  if (authUid) {
    try {
      await auth.updateUser(authUid, { email: authEmail, password: code, displayName, disabled: false })
    } catch (err) {
      if ((err as { code?: string }).code !== 'auth/user-not-found') throw err
      authUid = undefined
    }
  }
  if (!authUid) {
    try {
      const user = await auth.createUser({ email: authEmail, password: code, displayName })
      authUid = user.uid
    } catch (err) {
      if ((err as { code?: string }).code !== 'auth/email-already-exists') throw err
      const user = await auth.getUserByEmail(authEmail)
      await auth.updateUser(user.uid, { password: code, displayName, disabled: false })
      authUid = user.uid
    }
  }

  await getAdminDb().collection('users').doc(authUid).set(
    {
      id: authUid,
      name: displayName,
      email: authEmail,
      role: 'STUDENT',
      studentId: student.id,
      preferredLanguage: 'en',
      timezone: 'Africa/Harare',
    },
    { merge: true },
  )

  const validMonth = currentPortalMonth()
  const row: PortalRow = {
    id: student.id,
    studentId: student.id,
    studentNumber: student.studentNumber,
    authUid,
    authEmail,
    code,
    codeChangedByStudent: false,
    validMonth,
    expiresAt: portalMonthExpiry(validMonth),
    issuedAt: new Date().toISOString(),
    issuedBy: session.uid,
    issuedByName: session.profile.name || session.profile.email,
    revokedAt: null,
  }
  const { id: _id, ...data } = row
  await setDoc(COLLECTION, student.id, data)
  forget(`session:${authUid}`)
  return { row, code }
}

export async function issueStudentPortalCode(
  session: SessionContext,
  studentId: string,
  requestId?: string,
): Promise<StudentPortalAccess> {
  requirePermission(session, 'students.create')
  const student = await loadStudent(studentId)
  const { row } = await issueCode(session, student)
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.portal_code.issue',
    entityType: 'students',
    entityId: studentId,
    requestId,
    metadata: { validMonth: row.validMonth },
  })
  return toDto(student, row, { cleared: true })
}

export async function revokeStudentPortalAccess(
  session: SessionContext,
  studentId: string,
  requestId?: string,
): Promise<StudentPortalAccess> {
  requirePermission(session, 'students.create')
  const student = await loadStudent(studentId)
  const row = await getDoc<PortalRow>(COLLECTION, studentId)
  if (!row) throw badRequest('This student has no portal access to revoke')

  await getAdminAuth()
    .updateUser(row.authUid, { disabled: true })
    .catch((err: { code?: string }) => {
      if (err.code !== 'auth/user-not-found') throw err
    })
  const next: PortalRow = { ...row, code: '', revokedAt: new Date().toISOString() }
  const { id: _id, ...data } = next
  await setDoc(COLLECTION, studentId, data)
  forget(`session:${row.authUid}`)

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.portal_code.revoke',
    entityType: 'students',
    entityId: studentId,
    requestId,
  })
  return toDto(student, next, await portalFeeStatus(studentId))
}

/** Issue this month's codes for every active, fee-cleared student in a class. */
export async function issuePortalCodesForClass(
  session: SessionContext,
  classId: string,
  requestId?: string,
): Promise<StudentPortalBatchRow[]> {
  requirePermission(session, 'students.create')
  const snap = await getAdminDb()
    .collection('students')
    .where('classId', '==', classId)
    .limit(300)
    .get()
  const students = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) }))
    .filter((s) => s.status === 'ACTIVE')
    .sort((a, b) => studentName(a).localeCompare(studentName(b)))

  const results: StudentPortalBatchRow[] = new Array(students.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < students.length) {
      const index = cursor++
      const student = students[index]!
      const base = {
        studentId: student.id,
        studentNumber: student.studentNumber,
        name: studentName(student),
      }
      try {
        const { row, code } = await issueCode(session, student)
        results[index] = { ...base, code, expiresAt: row.expiresAt }
      } catch (err) {
        results[index] = {
          ...base,
          skipped: err instanceof AppError ? err.message : 'Could not issue code',
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, students.length) }, worker))

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.portal_code.issue_class',
    entityType: 'classes',
    entityId: classId,
    requestId,
    metadata: {
      issued: results.filter((r) => r.code).length,
      skipped: results.filter((r) => r.skipped).length,
    },
  })
  return results
}

/** Block student sessions whose code was revoked or has expired for the month. */
export async function assertStudentPortalActive(studentId: string): Promise<void> {
  const row = await getDoc<PortalRow>(COLLECTION, studentId)
  const status = rowStatus(row)
  if (status === 'ACTIVE') return
  if (status === 'REVOKED') {
    throw portalLocked('Your portal access has been revoked. Please contact the school office.')
  }
  if (status === 'EXPIRED') {
    throw portalLocked(
      `Your portal code for ${formatPortalMonth(row!.validMonth)} has expired. Get this month's code from the school office once fees are cleared.`,
    )
  }
  throw portalLocked('No portal code has been issued for you yet. Please contact the school office.')
}

/** Student set their own password — stop showing the admin-issued code. */
export async function markStudentCodeChanged(studentId: string): Promise<void> {
  const row = await getDoc<PortalRow>(COLLECTION, studentId)
  if (!row) return
  await setDoc(COLLECTION, studentId, { code: '', codeChangedByStudent: true }, true)
}
