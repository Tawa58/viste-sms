import 'server-only'

import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import {
  assertCanAccessStudent,
  assertTeacherOwnsClass,
  listAccessibleStudents,
} from '@/server/authorization/isolation'
import { badRequest, notFound } from '@/server/errors'
import { resolveEducationLevelId } from '@/lib/education-levels'
import { syncStudentTermInvoice } from '@/server/services/finance-service'
import {
  enrollmentYearFromDate,
  formatVhsNumber,
  maxVhsSequence,
} from '@/lib/student-numbers'
import { getAdminDb } from '@/lib/firebase/admin'
import { getDoc, newId, queryCollection, setDoc, deleteDoc } from '@/server/repositories/firestore-repo'
import { getDefaultStreamForClass } from '@/server/services/classes-service'
import type {
  ExemptionCreateInput,
  ScholarshipCreateInput,
  StudentCreateInput,
  StudentUpdateInput,
  TransferStudentInput,
} from '@/server/validators/school'
import type {
  ClassTransfer,
  Guardian,
  SchoolClass,
  Student,
  StudentExemption,
  StudentScholarship,
  Term,
} from '@/types'

export type StudentDto = Student

function emptyToUndefined(value?: string | null) {
  if (!value || !value.trim()) return undefined
  return value.trim()
}

/** Allocate next VHS-{year}-{001} via a per-year counter (seeded from existing students). */
async function allocateVhsStudentNumber(admissionDate: string): Promise<string> {
  const year = enrollmentYearFromDate(admissionDate)
  const db = getAdminDb()
  const counterRef = db.collection('counters').doc(`vhs-${year}`)

  const existingCounter = await counterRef.get()
  if (!existingCounter.exists) {
    const existing = await db.collection('students').select('studentNumber', 'admissionNumber').get()
    const rows = existing.docs.map(
      (d) => d.data() as { studentNumber?: string; admissionNumber?: string },
    )
    const seed = maxVhsSequence(rows, year) + 1
    await counterRef.set({ next: seed, year, updatedAt: new Date().toISOString() }, { merge: true })
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef)
    const next = typeof snap.data()?.next === 'number' ? (snap.data()!.next as number) : 1
    tx.set(
      counterRef,
      { next: next + 1, year, updatedAt: new Date().toISOString() },
      { merge: true },
    )
    return formatVhsNumber(year, next)
  })
}

export async function listStudents(
  session: SessionContext,
  opts?: { classId?: string },
): Promise<StudentDto[]> {
  requirePermission(session, 'students.read')

  if (opts?.classId) {
    if (session.role === 'TEACHER') {
      await assertTeacherOwnsClass(session, opts.classId)
    }
    if (session.role === 'PARENT' || session.role === 'STUDENT') {
      const accessible = await listAccessibleStudents(session)
      return accessible.filter((s) => s.classId === opts.classId)
    }
    const rows = await queryCollection<Student>('students', {
      limit: 300,
      where: [{ field: 'classId', op: '==', value: opts.classId }],
    })
    return rows
  }

  return listAccessibleStudents(session)
}

export async function getStudent(session: SessionContext, id: string): Promise<StudentDto> {
  requirePermission(session, 'students.read')
  return assertCanAccessStudent(session, id)
}

export async function createStudent(
  session: SessionContext,
  input: StudentCreateInput,
  requestId?: string,
): Promise<StudentDto> {
  requirePermission(session, 'students.create')

  const schoolClass = await getDoc<SchoolClass>('classes', input.classId)
  if (!schoolClass) throw badRequest('Class not found')
  if ((schoolClass.status ?? 'ACTIVE') === 'ARCHIVED') {
    throw badRequest('Cannot register a student into an archived class')
  }

  let streamId = emptyToUndefined(input.streamId)
  if (!streamId) {
    const stream = await getDefaultStreamForClass(input.classId)
    if (!stream) throw badRequest('Class has no stream — recreate the class')
    streamId = stream.id
  }

  const guardianIds = [...input.guardianIds]
  if (input.newGuardians?.length) {
    requirePermission(session, 'parents.manage')
    for (const g of input.newGuardians) {
      const gid = newId('g')
      const guardian: Guardian = {
        id: gid,
        firstName: g.firstName.trim(),
        lastName: g.lastName.trim(),
        relationship: g.relationship.trim(),
        email: emptyToUndefined(g.email) ?? '',
        phone: g.phone.trim(),
        address: emptyToUndefined(g.address) ?? '—',
        occupation: emptyToUndefined(g.occupation),
        emergencyContact: g.emergencyContact,
        studentIds: [],
      }
      await setDoc('guardians', gid, { ...guardian })
      guardianIds.push(gid)
    }
  }

  const id = newId('stu')
  const educationLevelId =
    emptyToUndefined(input.educationLevelId) ||
    schoolClass.educationLevelId ||
    resolveEducationLevelId(schoolClass.level)

  const providedStudentNo = emptyToUndefined(input.studentNumber)
  const providedAdmissionNo = emptyToUndefined(input.admissionNumber)
  let studentNumber = providedStudentNo
  let admissionNumber = providedAdmissionNo

  if (!studentNumber || !admissionNumber) {
    const allocated = await allocateVhsStudentNumber(input.admissionDate)
    studentNumber = studentNumber ?? allocated
    admissionNumber = admissionNumber ?? allocated
  }

  // Keep both in sync when only one was provided
  if (providedStudentNo && !providedAdmissionNo) admissionNumber = providedStudentNo
  if (providedAdmissionNo && !providedStudentNo) studentNumber = providedAdmissionNo

  const row: Student = {
    id,
    studentNumber,
    admissionNumber,
    firstName: input.firstName.trim(),
    middleName: emptyToUndefined(input.middleName),
    lastName: input.lastName.trim(),
    dateOfBirth: input.dateOfBirth,
    gender: input.gender,
    email: emptyToUndefined(input.email),
    phone: emptyToUndefined(input.phone),
    address: input.address.trim() || '—',
    admissionDate: input.admissionDate,
    status: input.status ?? 'ACTIVE',
    residency: input.residency ?? 'DAY',
    paymentPlan: input.paymentPlan ?? 'TERMLY',
    classId: input.classId,
    streamId,
    educationLevelId,
    academicYearId: emptyToUndefined(input.academicYearId) || schoolClass.academicYearId,
    termId: emptyToUndefined(input.termId) || schoolClass.termId,
    subjectIds: [...input.subjectIds],
    sportIds: [...(input.sportIds ?? [])],
    clubIds: [...(input.clubIds ?? [])],
    houseId: emptyToUndefined(input.houseId),
    guardianIds,
    profilePhotoId: input.profilePhotoId,
  }
  await setDoc('students', id, { ...row })

  for (const gid of guardianIds) {
    const guardian = await getDoc<Guardian>('guardians', gid)
    if (guardian && !guardian.studentIds.includes(id)) {
      await setDoc('guardians', gid, {
        ...guardian,
        studentIds: [...guardian.studentIds, id],
      })
    }
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.create',
    entityType: 'students',
    entityId: id,
    requestId,
  })
  await syncStudentTermInvoice(row)
  return row
}

export async function updateStudent(
  session: SessionContext,
  id: string,
  patch: StudentUpdateInput,
  requestId?: string,
): Promise<StudentDto> {
  requirePermission(session, 'students.update')
  const current = await assertCanAccessStudent(session, id)

  if (session.role === 'TEACHER') {
    const { isClassTeacherOf } = await import('@/server/authorization/isolation')
    const asClassTeacher = await isClassTeacherOf(session, current.classId)
    // Class teachers maintain homeroom profile fields; subject teachers contact only.
    const allowed = asClassTeacher
      ? new Set([
          'phone',
          'email',
          'address',
          'profilePhotoId',
          'houseId',
          'sportIds',
          'clubIds',
          'middleName',
        ])
      : new Set(['phone', 'email', 'address', 'profilePhotoId'])
    for (const key of Object.keys(patch)) {
      if (!allowed.has(key)) {
        throw badRequest(
          asClassTeacher
            ? `Class teachers cannot update field: ${key}`
            : `Teachers cannot update field: ${key}`,
        )
      }
    }
  }

  if (patch.classId && patch.classId !== current.classId) {
    throw badRequest('Use the transfer endpoint to change a student class')
  }

  const next: Student = {
    ...current,
    ...patch,
    id,
    email: patch.email === '' ? undefined : (patch.email ?? current.email),
    middleName:
      patch.middleName === '' ? undefined : (patch.middleName ?? current.middleName),
    houseId: patch.houseId === '' ? undefined : (patch.houseId ?? current.houseId),
    subjectIds: patch.subjectIds ?? current.subjectIds,
    sportIds: patch.sportIds ?? current.sportIds ?? [],
    clubIds: patch.clubIds ?? current.clubIds ?? [],
    guardianIds: patch.guardianIds ?? current.guardianIds,
    streamId: emptyToUndefined(patch.streamId) ?? current.streamId,
  }
  await setDoc('students', id, { ...next })

  if (patch.guardianIds) {
    const allGuardians = await queryCollection<Guardian>('guardians', { limit: 100 })
    for (const guardian of allGuardians) {
      const linked = next.guardianIds.includes(guardian.id)
      const has = guardian.studentIds.includes(id)
      if (linked && !has) {
        await setDoc('guardians', guardian.id, {
          ...guardian,
          studentIds: [...guardian.studentIds, id],
        })
      } else if (!linked && has) {
        await setDoc('guardians', guardian.id, {
          ...guardian,
          studentIds: guardian.studentIds.filter((sid) => sid !== id),
        })
      }
    }
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.update',
    entityType: 'students',
    entityId: id,
    requestId,
    metadata: { fields: Object.keys(patch) },
  })
  if (
    (next.residency ?? 'DAY') !== (current.residency ?? 'DAY') ||
    (next.paymentPlan ?? 'TERMLY') !== (current.paymentPlan ?? 'TERMLY') ||
    next.educationLevelId !== current.educationLevelId ||
    (next.status === 'ACTIVE' && current.status !== 'ACTIVE')
  ) {
    await syncStudentTermInvoice(next)
  }
  return next
}

export async function archiveStudent(
  session: SessionContext,
  id: string,
  requestId?: string,
): Promise<StudentDto> {
  requirePermission(session, 'students.archive')
  await assertCanAccessStudent(session, id)
  const current = await getDoc<Student>('students', id)
  if (!current) throw notFound('Student not found')
  const next: Student = { ...current, status: 'ARCHIVED' }
  await setDoc('students', id, { ...next })
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.archive',
    entityType: 'students',
    entityId: id,
    requestId,
  })
  return next
}

/** Permanently remove a student record and unlink from guardians. */
export async function deleteStudent(
  session: SessionContext,
  id: string,
  requestId?: string,
): Promise<{ deleted: true; id: string }> {
  requirePermission(session, 'students.archive')
  await assertCanAccessStudent(session, id)
  const current = await getDoc<Student>('students', id)
  if (!current) throw notFound('Student not found')

  const guardians = await queryCollection<Guardian>('guardians', { limit: 200 })
  for (const g of guardians) {
    if (!(g.studentIds ?? []).includes(id)) continue
    await setDoc('guardians', g.id, {
      ...g,
      studentIds: (g.studentIds ?? []).filter((sid) => sid !== id),
    })
  }

  await deleteDoc('students', id)
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.delete',
    entityType: 'students',
    entityId: id,
    requestId,
    metadata: { name: `${current.firstName} ${current.lastName}` },
  })
  return { deleted: true, id }
}

export async function transferStudent(
  session: SessionContext,
  input: TransferStudentInput,
  requestId?: string,
): Promise<{ student: StudentDto; transfer: ClassTransfer }> {
  requirePermission(session, 'students.transfer')
  await assertCanAccessStudent(session, input.studentId)

  const student = await getDoc<Student>('students', input.studentId)
  if (!student) throw notFound('Student not found')

  if (student.classId === input.toClassId) {
    throw badRequest('Student is already in that class')
  }

  const toClass = await getDoc<SchoolClass>('classes', input.toClassId)
  if (!toClass) throw badRequest('Destination class not found')
  if ((toClass.status ?? 'ACTIVE') === 'ARCHIVED') {
    throw badRequest('Cannot transfer into an archived class')
  }

  const toStream = await getDefaultStreamForClass(input.toClassId)
  if (!toStream) throw badRequest('Destination class has no stream')

  const transferId = newId('xfer')
  const transfer: ClassTransfer = {
    id: transferId,
    studentId: student.id,
    fromClassId: student.classId,
    toClassId: input.toClassId,
    fromStreamId: student.streamId,
    toStreamId: toStream.id,
    date: input.date || new Date().toISOString().slice(0, 10),
    reason: emptyToUndefined(input.reason),
    notes: emptyToUndefined(input.notes),
    transferredBy: session.uid,
    transferredByName: session.profile.name || session.profile.email || session.uid,
  }
  await setDoc('classTransfers', transferId, { ...transfer })

  const next: Student = {
    ...student,
    classId: input.toClassId,
    streamId: toStream.id,
    educationLevelId:
      toClass.educationLevelId ||
      resolveEducationLevelId(toClass.level) ||
      student.educationLevelId,
    academicYearId: toClass.academicYearId || student.academicYearId,
    termId: toClass.termId || student.termId,
  }
  await setDoc('students', student.id, { ...next })

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.transfer',
    entityType: 'students',
    entityId: student.id,
    requestId,
    metadata: {
      fromClassId: transfer.fromClassId,
      toClassId: transfer.toClassId,
      transferId,
    },
  })

  if (next.educationLevelId !== student.educationLevelId) {
    await syncStudentTermInvoice(next)
  }
  return { student: next, transfer }
}

export async function listStudentTransfers(
  session: SessionContext,
  studentId: string,
): Promise<ClassTransfer[]> {
  requirePermission(session, 'students.read')
  await assertCanAccessStudent(session, studentId)
  const all = await queryCollection<ClassTransfer>('classTransfers', { limit: 100 })
  return all
    .filter((t) => t.studentId === studentId)
    .sort((a, b) => b.date.localeCompare(a.date))
}

export async function createExemption(
  session: SessionContext,
  input: ExemptionCreateInput,
  requestId?: string,
): Promise<StudentExemption> {
  requirePermission(session, 'students.exempt')
  await assertCanAccessStudent(session, input.studentId)

  const id = newId('exm')
  const row: StudentExemption = {
    id,
    studentId: input.studentId,
    type: input.type,
    targetId: emptyToUndefined(input.targetId),
    targetLabel: input.targetLabel.trim(),
    reason: input.reason.trim(),
    startDate: input.startDate,
    endDate: emptyToUndefined(input.endDate),
    notes: emptyToUndefined(input.notes),
    createdBy: session.uid,
    createdByName: session.profile.name || session.profile.email || session.uid,
    createdAt: new Date().toISOString(),
    active: true,
  }
  await setDoc('studentExemptions', id, { ...row })
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.exemption.create',
    entityType: 'studentExemptions',
    entityId: id,
    requestId,
  })
  return row
}

export async function listStudentExemptions(
  session: SessionContext,
  studentId: string,
): Promise<StudentExemption[]> {
  requirePermission(session, 'students.read')
  await assertCanAccessStudent(session, studentId)
  const all = await queryCollection<StudentExemption>('studentExemptions', { limit: 100 })
  return all
    .filter((e) => e.studentId === studentId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
}

export async function deactivateExemption(
  session: SessionContext,
  id: string,
  requestId?: string,
): Promise<StudentExemption> {
  requirePermission(session, 'students.exempt')
  const current = await getDoc<StudentExemption>('studentExemptions', id)
  if (!current) throw notFound('Exemption not found')
  await assertCanAccessStudent(session, current.studentId)
  const next: StudentExemption = { ...current, active: false }
  await setDoc('studentExemptions', id, { ...next })
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.exemption.deactivate',
    entityType: 'studentExemptions',
    entityId: id,
    requestId,
  })
  return next
}

export async function createStudentScholarship(
  session: SessionContext,
  studentId: string,
  input: ScholarshipCreateInput,
  requestId?: string,
): Promise<StudentScholarship> {
  requirePermission(session, 'students.exempt')
  const student = await assertCanAccessStudent(session, studentId)
  const term = input.termId ? await getDoc<Term>('terms', input.termId) : undefined
  if (input.termId && !term) throw badRequest('The selected scholarship term does not exist')
  const id = newId('sch')
  const row: StudentScholarship = {
    id,
    studentId,
    termId: input.termId || undefined,
    grantor: input.grantor.trim(),
    startDate: term?.startDate ?? input.startDate,
    endDate: term?.endDate ?? input.endDate,
    feeCoveragePercent: input.feeCoveragePercent,
    benefits: input.benefits,
    otherBenefits: emptyToUndefined(input.otherBenefits),
    notes: emptyToUndefined(input.notes),
    active: true,
    createdBy: session.uid,
    createdByName: session.profile.name || session.profile.email || session.uid,
    createdAt: new Date().toISOString(),
  }
  await setDoc('studentScholarships', id, { ...row })
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.scholarship.create',
    entityType: 'studentScholarships',
    entityId: id,
    requestId,
    metadata: {
      studentId,
      grantor: row.grantor,
      termId: row.termId,
      feeCoveragePercent: row.feeCoveragePercent,
      startDate: row.startDate,
      endDate: row.endDate,
    },
  })
  await syncStudentTermInvoice(student, row.termId)
  return row
}

export async function listStudentScholarships(
  session: SessionContext,
  studentId: string,
): Promise<StudentScholarship[]> {
  requirePermission(session, 'students.read')
  await assertCanAccessStudent(session, studentId)
  const all = await queryCollection<StudentScholarship>('studentScholarships', { limit: 500 })
  return all
    .filter((scholarship) => scholarship.studentId === studentId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
}

export async function deactivateStudentScholarship(
  session: SessionContext,
  scholarshipId: string,
  requestId?: string,
): Promise<StudentScholarship> {
  requirePermission(session, 'students.exempt')
  const current = await getDoc<StudentScholarship>('studentScholarships', scholarshipId)
  if (!current) throw notFound('Scholarship not found')
  const student = await assertCanAccessStudent(session, current.studentId)
  const next = { ...current, active: false }
  await setDoc('studentScholarships', scholarshipId, next)
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'student.scholarship.deactivate',
    entityType: 'studentScholarships',
    entityId: scholarshipId,
    requestId,
  })
  await syncStudentTermInvoice(student, current.termId)
  return next
}

export const listStudentsService = listStudents
export const getStudentService = getStudent
export const createStudentService = createStudent
export const updateStudentService = updateStudent
export const archiveStudentService = archiveStudent
export const deleteStudentService = deleteStudent
export const transferStudentService = transferStudent
export const listStudentTransfersService = listStudentTransfers
export const createExemptionService = createExemption
export const listStudentExemptionsService = listStudentExemptions
export const deactivateExemptionService = deactivateExemption
export const createStudentScholarshipService = createStudentScholarship
export const listStudentScholarshipsService = listStudentScholarships
export const deactivateStudentScholarshipService = deactivateStudentScholarship

export { listStaffService } from '@/server/services/staff-service'
