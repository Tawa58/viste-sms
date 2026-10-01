import 'server-only'

import { getAdminDb } from '@/lib/firebase/admin'
import { currentScaleVersion, grossOf } from '@/lib/hr/payroll-engine'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission, sessionHasPermission } from '@/server/authorization/permissions'
import { badRequest, conflict, forbidden, notFound } from '@/server/errors'
import { getDoc, newId } from '@/server/repositories/firestore-repo'
import {
  HR,
  actorName,
  audit,
  clean,
  nextSequenceCode,
  nowIso,
  readAll,
} from '@/server/services/hr-common'
import type {
  HrStaffInput,
  SalaryScaleBody,
  SalaryScaleUpdateBody,
} from '@/server/validators/hr'
import type {
  HrEmployee,
  HrLinkableAccount,
  HrStaffBundle,
  SalaryScaleVersion,
  UserRole,
} from '@/types'

const NON_STAFF_ROLES: UserRole[] = ['PARENT', 'STUDENT']

function empty(value?: string | null) {
  const v = value?.trim()
  return v ? v : undefined
}

async function listAccounts(): Promise<HrLinkableAccount[]> {
  const snap = await getAdminDb()
    .collection('users')
    .select('name', 'email', 'role', 'employeeNumber', 'disabled', 'status')
    .limit(1000)
    .get()
  return snap.docs
    .map((d): HrLinkableAccount | null => {
      const u = d.data() as {
        name?: string
        email?: string
        role?: UserRole
        employeeNumber?: string
        disabled?: boolean
        status?: string
      }
      if (!u.role || NON_STAFF_ROLES.includes(u.role) || u.disabled || u.status === 'DISABLED') {
        return null
      }
      return {
        uid: d.id,
        name: u.name || u.email || d.id,
        role: u.role,
        ...(u.employeeNumber ? { employeeNumber: u.employeeNumber } : {}),
      }
    })
    .filter((a): a is HrLinkableAccount => a !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listHrStaff(session: SessionContext): Promise<HrStaffBundle> {
  requirePermission(session, 'hr.read')
  const [employees, accounts] = await Promise.all([
    readAll<HrEmployee>(HR.staff),
    sessionHasPermission(session, 'hr.manage') ? listAccounts() : Promise.resolve([]),
  ])
  return {
    employees: employees.sort((a, b) => a.fullName.localeCompare(b.fullName)),
    accounts,
  }
}

async function assertAssignableScale(scaleId: string | undefined) {
  if (!scaleId) return
  const versions = await readScaleVersions(scaleId)
  const current = currentScaleVersion(versions, scaleId)
  if (!current) throw badRequest(`Salary scale ${scaleId} does not exist`)
  if (current.status !== 'ACTIVE') throw badRequest(`Salary scale ${scaleId} is inactive`)
}

async function linkedName(uid: string | undefined) {
  if (!uid) return undefined
  const snap = await getAdminDb().collection('users').doc(uid).get()
  if (!snap.exists) throw badRequest('The linked login no longer exists')
  const u = snap.data() as { name?: string; email?: string }
  return u.name || u.email || uid
}

async function assertUniqueNationalId(nationalId: string, exceptId?: string) {
  const snap = await getAdminDb()
    .collection(HR.staff)
    .where('nationalId', '==', nationalId)
    .limit(2)
    .get()
  if (snap.docs.some((d) => d.id !== exceptId)) {
    throw conflict(`Another employee already has national ID ${nationalId}`)
  }
}

function fromInput(input: HrStaffInput) {
  return {
    fullName: input.fullName.trim(),
    nationalId: input.nationalId.trim().toUpperCase(),
    gender: input.gender,
    dateOfBirth: input.dateOfBirth,
    phone: input.phone.trim(),
    email: input.email.trim().toLowerCase(),
    address: input.address.trim(),
    emergencyContact: input.emergencyContact,
    position: input.position.trim(),
    department: input.department.trim(),
    category: input.category,
    dateEmployed: input.dateEmployed,
    employmentType: input.employmentType,
    status: input.status,
    salaryScaleId: empty(input.salaryScaleId),
    bank: input.bank,
    linkedUid: empty(input.linkedUid),
    notes: empty(input.notes),
  }
}

export async function createHrStaff(
  session: SessionContext,
  input: HrStaffInput,
  requestId?: string,
): Promise<HrEmployee> {
  requirePermission(session, 'hr.manage')
  const data = fromInput(input)
  await Promise.all([assertUniqueNationalId(data.nationalId), assertAssignableScale(data.salaryScaleId)])
  const id = newId('emp')
  const now = nowIso()
  const row: HrEmployee = clean({
    ...data,
    id,
    employeeNumber: await nextSequenceCode('hr-employee', 'EMP'),
    linkedName: await linkedName(data.linkedUid),
    createdAt: now,
    updatedAt: now,
    createdByName: actorName(session),
  })
  await getAdminDb().collection(HR.staff).doc(id).set(row)
  await audit(session, 'hr.staff_create', HR.staff, id, requestId)
  return row
}

export async function updateHrStaff(
  session: SessionContext,
  id: string,
  input: HrStaffInput,
  requestId?: string,
): Promise<HrEmployee> {
  requirePermission(session, 'hr.manage')
  const current = await getDoc<HrEmployee>(HR.staff, id)
  if (!current) throw notFound('Employee not found')
  const data = fromInput(input)
  await Promise.all([
    data.nationalId !== current.nationalId ? assertUniqueNationalId(data.nationalId, id) : null,
    data.salaryScaleId !== current.salaryScaleId ? assertAssignableScale(data.salaryScaleId) : null,
  ])
  const next: HrEmployee = clean({
    ...data,
    id,
    employeeNumber: current.employeeNumber,
    linkedName:
      data.linkedUid === current.linkedUid ? current.linkedName : await linkedName(data.linkedUid),
    createdAt: current.createdAt,
    createdByName: current.createdByName,
    updatedAt: nowIso(),
  })
  await getAdminDb().collection(HR.staff).doc(id).set(next)
  await audit(session, 'hr.staff_update', HR.staff, id, requestId, {
    status: next.status,
    salaryScaleId: next.salaryScaleId ?? null,
  })
  return next
}

export async function deleteHrStaff(session: SessionContext, id: string, requestId?: string) {
  requirePermission(session, 'hr.manage')
  const current = await getDoc<HrEmployee>(HR.staff, id)
  if (!current) throw notFound('Employee not found')
  const history = await getAdminDb()
    .collection(HR.items)
    .where('employeeId', '==', id)
    .limit(1)
    .get()
  if (!history.empty) {
    throw conflict(
      `${current.fullName} has payroll history. Mark the employee as Resigned instead of deleting the record.`,
    )
  }
  await getAdminDb().collection(HR.staff).doc(id).delete()
  await audit(session, 'hr.staff_delete', HR.staff, id, requestId)
}

/* ---------- Salary scales ---------- */

async function readScaleVersions(scaleId?: string): Promise<SalaryScaleVersion[]> {
  if (!scaleId) return readAll<SalaryScaleVersion>(HR.scales)
  const snap = await getAdminDb().collection(HR.scales).where('scaleId', '==', scaleId).get()
  return snap.docs.map((d) => ({ ...(d.data() as SalaryScaleVersion), id: d.id }))
}

export async function listSalaryScales(session: SessionContext): Promise<SalaryScaleVersion[]> {
  if (!sessionHasPermission(session, 'hr.read') && !sessionHasPermission(session, 'payroll.read')) {
    throw forbidden('Missing permission: hr.read')
  }
  const rows = await readScaleVersions()
  return rows.sort(
    (a, b) => a.scaleId.localeCompare(b.scaleId) || b.version - a.version,
  )
}

function scaleFields(body: SalaryScaleBody) {
  const parts = {
    basicSalary: body.basicSalary,
    housingAllowance: body.housingAllowance,
    transportAllowance: body.transportAllowance,
    otherAllowances: body.otherAllowances,
  }
  return {
    category: body.category,
    position: body.position.trim(),
    grade: body.grade.trim().toUpperCase(),
    ...parts,
    grossSalary: grossOf(parts),
    effectiveDate: body.effectiveDate,
    notes: empty(body.notes),
  }
}

export async function createSalaryScale(
  session: SessionContext,
  body: SalaryScaleBody,
  requestId?: string,
): Promise<SalaryScaleVersion> {
  requirePermission(session, 'hr.manage')
  const id = newId('ssv')
  const row: SalaryScaleVersion = clean({
    ...scaleFields(body),
    id,
    scaleId: await nextSequenceCode('salary-scale', 'SS'),
    version: 1,
    status: 'ACTIVE',
    current: true,
    createdAt: nowIso(),
    createdByName: actorName(session),
  })
  await getAdminDb().collection(HR.scales).doc(id).set(row)
  await audit(session, 'hr.salary_scale_create', HR.scales, row.scaleId, requestId, {
    grossSalary: row.grossSalary,
  })
  return row
}

/** Revising adds a new version; status changes apply to every version of the scale. */
export async function updateSalaryScale(
  session: SessionContext,
  scaleId: string,
  body: SalaryScaleUpdateBody,
  requestId?: string,
): Promise<SalaryScaleVersion[]> {
  requirePermission(session, 'hr.manage')
  const versions = await readScaleVersions(scaleId)
  const current = currentScaleVersion(versions, scaleId)
  if (!current) throw notFound('Salary scale not found')
  const db = getAdminDb()
  const batch = db.batch()

  if (body.action === 'status') {
    for (const v of versions) {
      batch.update(db.collection(HR.scales).doc(v.id), { status: body.status })
    }
    await batch.commit()
    await audit(session, 'hr.salary_scale_status', HR.scales, scaleId, requestId, {
      status: body.status,
    })
    return versions.map((v) => ({ ...v, status: body.status }))
  }

  if (body.effectiveDate < current.effectiveDate) {
    throw badRequest(
      `The new effective date must be on or after ${current.effectiveDate}, when version ${current.version} took effect.`,
    )
  }
  const id = newId('ssv')
  const next: SalaryScaleVersion = clean({
    ...scaleFields(body),
    id,
    scaleId,
    version: current.version + 1,
    status: current.status,
    current: true,
    createdAt: nowIso(),
    createdByName: actorName(session),
  })
  batch.update(db.collection(HR.scales).doc(current.id), { current: false })
  batch.set(db.collection(HR.scales).doc(id), next)
  await batch.commit()
  await audit(session, 'hr.salary_scale_revise', HR.scales, scaleId, requestId, {
    version: next.version,
    grossSalary: next.grossSalary,
    effectiveDate: next.effectiveDate,
  })
  return [next, ...versions.map((v) => (v.id === current.id ? { ...v, current: false } : v))]
}
