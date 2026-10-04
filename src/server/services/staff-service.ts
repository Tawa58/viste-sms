import 'server-only'

import { randomBytes } from 'node:crypto'
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
import { defaultAccountRoleForCategory } from '@/lib/staff-categories'
import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission, sessionHasPermission } from '@/server/authorization/permissions'
import { badRequest, conflict, notFound, accountSuspended } from '@/server/errors'
import { getDoc, newId, queryCollection, setDoc, deleteDoc } from '@/server/repositories/firestore-repo'
import type { StaffCreateInput, StaffSuspendInput } from '@/server/validators/school'
import type { SchoolClass, Staff, StaffAccountRole, StaffLoginCredential, StaffSuspension } from '@/types'
import type { PermissionOverrides } from '@/server/authorization/rbac-map'
import type { z } from 'zod'
import type { staffUpdateSchema } from '@/server/validators/school'

export type StaffDto = Staff

/** Admin-only credential sheet row (includes issued temporary password). */
export type StaffCredentialDto = StaffLoginCredential & {
  hasAuthAccount: boolean
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function suspensionMessage(suspension: StaffSuspension): string {
  const until =
    suspension.endsAt != null
      ? ` until ${suspension.endsAt}`
      : ' until an administrator reactivates your account'
  const reason = suspension.reason?.trim()
  return reason
    ? `Your account is currently suspended${until}. Reason: ${reason}`
    : `Your account is currently suspended${until}.`
}

/**
 * If the staff member is suspended, throw ACCOUNT_SUSPENDED.
 * Auto-reactivates when the suspension end date has passed.
 */
export async function assertStaffAccountActive(staffId: string): Promise<Staff | null> {
  const staff = await getDoc<Staff>('staff', staffId)
  if (!staff) return null

  if (staff.status !== 'INACTIVE' && !staff.suspension) return staff

  const suspension = staff.suspension
  if (suspension?.endsAt && suspension.endsAt < todayIsoDate()) {
    const cleared: Staff = {
      ...staff,
      status: 'ACTIVE',
      suspension: null,
    }
    await setDoc('staff', staffId, cleared)
    return cleared
  }

  if (staff.status === 'INACTIVE' || suspension) {
    const activeSuspension: StaffSuspension = suspension ?? {
      reason: 'Account inactivated by administrator',
      startsAt: todayIsoDate(),
      endsAt: null,
      suspendedAt: new Date().toISOString(),
      suspendedBy: 'system',
    }
    throw accountSuspended(suspensionMessage(activeSuspension), {
      endsAt: activeSuspension.endsAt,
      reason: activeSuspension.reason,
      startsAt: activeSuspension.startsAt,
    })
  }

  return staff
}

function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = randomBytes(10)
  let out = ''
  for (let i = 0; i < bytes.length; i += 1) {
    out += alphabet[bytes[i]! % alphabet.length]
  }
  return `${out}!`
}

/** Keep staff.classIds in sync with classes where they are class teacher. */
export async function syncStaffClassIdsFromClasses(staffId?: string): Promise<void> {
  const classes = await queryCollection<SchoolClass>('classes', { limit: 200 })
  const byTeacher = new Map<string, string[]>()
  for (const cls of classes) {
    if ((cls.status ?? 'ACTIVE') === 'ARCHIVED') continue
    const tid = cls.classTeacherId
    if (!tid) continue
    const list = byTeacher.get(tid) ?? []
    list.push(cls.id)
    byTeacher.set(tid, list)
  }

  const staffRows = staffId
    ? [await getDoc<Staff>('staff', staffId)].filter(Boolean) as Staff[]
    : await queryCollection<Staff>('staff', { limit: 200 })

  await Promise.all(
    staffRows.map(async (row) => {
      const teacherClassIds = byTeacher.get(row.id) ?? []
      // Merge class-teacher classes into teaching classIds — never wipe subject teaching assignments.
      const nextIds = [...new Set([...(row.classIds ?? []), ...teacherClassIds])]
      const prev = [...(row.classIds ?? [])].sort().join(',')
      const next = [...nextIds].sort().join(',')
      if (prev === next) return
      await setDoc('staff', row.id, { ...row, classIds: nextIds })
    }),
  )
}

export async function assignClassTeacher(
  classId: string,
  previousTeacherId: string | undefined,
  nextTeacherId: string | undefined,
): Promise<void> {
  // Access for class teachers is resolved via classes.classTeacherId.
  // Only ensure the new class teacher also has the class on staff.classIds
  // so teaching + homeroom assignments stay aligned. Do not strip the previous
  // teacher's classIds — they may still teach subjects in that class.
  void previousTeacherId
  if (nextTeacherId) {
    const next = await getDoc<Staff>('staff', nextTeacherId)
    if (next) {
      const ids = new Set(next.classIds ?? [])
      ids.add(classId)
      await setDoc('staff', nextTeacherId, { ...next, classIds: [...ids] })
    }
  }
}

export async function listStaff(session: SessionContext): Promise<StaffDto[]> {
  // Teachers lack teachers.read; return [] instead of 403 so class/exam UIs
  // that hydrate staff catalogs don't crash on Forbidden.
  if (!sessionHasPermission(session, 'teachers.read')) {
    if (session.role === 'TEACHER') return []
    requirePermission(session, 'teachers.read')
  }
  // Ensure class-teacher assignments show on staff profiles
  await syncStaffClassIdsFromClasses().catch(() => undefined)
  return queryCollection<Staff>('staff', { limit: 100 })
}

export async function getStaff(session: SessionContext, id: string): Promise<StaffDto> {
  const isSelf = Boolean(session.profile.staffId && session.profile.staffId === id)
  if (!isSelf) {
    requirePermission(session, 'teachers.read')
  }
  await syncStaffClassIdsFromClasses(id).catch(() => undefined)
  const row = await getDoc<Staff>('staff', id)
  if (!row) throw notFound('Staff not found')
  return row
}

export async function createStaff(
  session: SessionContext,
  input: StaffCreateInput,
  requestId?: string,
): Promise<StaffDto> {
  requirePermission(session, 'teachers.manage')
  const password = input.password?.trim() || generateTemporaryPassword()
  if (password.length < 8) throw badRequest('Password must be at least 8 characters')
  const { password: _ignored, profilePhotoId, ...rest } = input
  const id = newId('st')
  const accountRole = input.accountRole ?? defaultAccountRoleForCategory(input.category)
  const row: Staff = {
    ...rest,
    id,
    category: rest.category ?? 'TEACHER',
    accountRole,
    classIds: rest.classIds ?? [],
    subjectIds: rest.subjectIds ?? [],
    ...(profilePhotoId ? { profilePhotoId } : {}),
  }

  let authUid: string
  try {
    const user = await getAdminAuth().createUser({
      email: input.email.toLowerCase(),
      password,
      displayName: `${input.firstName} ${input.lastName}`,
      emailVerified: false,
    })
    authUid = user.uid
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'auth/email-already-exists') throw conflict('Email already registered')
    throw err
  }

  await setDoc('staff', id, { ...row })
  await getAdminDb().collection('users').doc(authUid).set({
    id: authUid,
    name: `${input.firstName} ${input.lastName}`,
    email: input.email.toLowerCase(),
    role: accountRole,
    staffId: id,
    title: input.title,
    department: input.department,
    employeeNumber: input.employeeNumber,
    preferredLanguage: 'en',
    timezone: 'Africa/Harare',
    notificationPrefs: { email: true, sms: false, inApp: true },
  })

  // Store admin-issued temporary password for the credentials sheet
  await setDoc('staffCredentials', id, {
    staffId: id,
    email: input.email.toLowerCase(),
    password,
    role: accountRole,
    temporaryPassword: true,
    lastResetAt: new Date().toISOString().slice(0, 10),
    authUid,
  })

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'staff.create',
    entityType: 'staff',
    entityId: id,
    requestId,
    metadata: { authUid },
  })

  return row
}

type StaffCredRow = StaffLoginCredential & { id: string; authUid?: string }

export async function listStaffCredentials(
  session: SessionContext,
): Promise<StaffCredentialDto[]> {
  requirePermission(session, 'teachers.manage')
  const [rows, staffRows] = await Promise.all([
    queryCollection<StaffCredRow>('staffCredentials', { limit: 100 }),
    queryCollection<Staff>('staff', { limit: 500 }),
  ])
  const staffById = new Map(staffRows.map((staff) => [staff.id, staff]))
  return rows.map((row) => {
    const staff = staffById.get(row.staffId || row.id)
    return {
      staffId: row.staffId || row.id,
      email: row.email,
      password: row.password || '',
      role: staff ? accountRoleForStaff(staff) : row.role,
      temporaryPassword: row.temporaryPassword ?? Boolean(row.password),
      lastResetAt: row.lastResetAt,
      hasAuthAccount: Boolean(row.authUid),
    }
  })
}

function accountRoleForStaff(staff: Staff) {
  return staff.accountRole ?? defaultAccountRoleForCategory(staff.category)
}

export async function resetStaffPassword(
  session: SessionContext,
  staffId: string,
  password: string | undefined,
  requestId?: string,
): Promise<StaffCredentialDto> {
  requirePermission(session, 'teachers.manage')
  const nextPassword = password?.trim() || generateTemporaryPassword()
  if (nextPassword.length < 8) throw badRequest('Password must be at least 8 characters')

  const cred = await getDoc<StaffCredRow>('staffCredentials', staffId)
  if (!cred?.authUid) throw notFound('Staff auth account not found')
  const staff = await getDoc<Staff>('staff', staffId)
  if (!staff) throw notFound('Staff not found')
  const role = accountRoleForStaff(staff)

  await getAdminAuth().updateUser(cred.authUid, { password: nextPassword })
  const lastResetAt = new Date().toISOString().slice(0, 10)
  await setDoc('staffCredentials', staffId, {
    staffId,
    email: cred.email,
    password: nextPassword,
    role,
    temporaryPassword: true,
    lastResetAt,
    authUid: cred.authUid,
  })

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'staff.password_reset',
    entityType: 'staff',
    entityId: staffId,
    requestId,
  })

  return {
    staffId,
    email: cred.email,
    password: nextPassword,
    role,
    temporaryPassword: true,
    lastResetAt,
    hasAuthAccount: true,
  }
}

export type StaffAccessDto = {
  staffId: string
  role: StaffAccountRole
  roleDefaults: string[]
  assignable: string[]
  groups: { label: string; permissions: string[] }[]
  overrides: PermissionOverrides
  effective: string[]
  selected: string[]
}

export async function getStaffAccess(
  session: SessionContext,
  staffId: string,
): Promise<StaffAccessDto> {
  requirePermission(session, 'teachers.manage')
  const row = await getDoc<Staff>('staff', staffId)
  if (!row) throw notFound('Staff not found')

  const {
    listPermissions,
    STAFF_ASSIGNABLE_PERMISSIONS,
    STAFF_PERMISSION_GROUPS,
    resolveEffectivePermissions,
  } = await import('@/server/authorization/rbac-map')

  const role = accountRoleForStaff(row)
  const overrides = row.permissionOverrides ?? {}
  const effective = resolveEffectivePermissions(role, overrides)
  const assignable = [...STAFF_ASSIGNABLE_PERMISSIONS]
  const selected = assignable.filter((p) => effective.includes(p))

  return {
    staffId,
    role,
    roleDefaults: listPermissions(role),
    assignable,
    groups: STAFF_PERMISSION_GROUPS.map((g) => ({
      label: g.label,
      permissions: [...g.permissions],
    })),
    overrides,
    effective,
    selected,
  }
}

export async function updateStaffAccess(
  session: SessionContext,
  staffId: string,
  selectedPermissions: string[],
  requestId?: string,
): Promise<StaffAccessDto> {
  requirePermission(session, 'teachers.manage')
  const row = await getDoc<Staff>('staff', staffId)
  if (!row) throw notFound('Staff not found')

  const { overridesFromStaffSelection } = await import('@/server/authorization/rbac-map')
  const role = accountRoleForStaff(row)
  const overrides = overridesFromStaffSelection(role, selectedPermissions)

  await setDoc('staff', staffId, {
    ...row,
    permissionOverrides: {
      grant: overrides.grant ?? [],
      deny: overrides.deny ?? [],
    },
  })

  // Drop cached sessions so the teacher picks up access changes quickly
  try {
    const { forget } = await import('@/server/http/memo')
    forget('session:')
  } catch {
    /* ignore */
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'staff.access_update',
    entityType: 'staff',
    entityId: staffId,
    requestId,
    metadata: {
      grant: overrides.grant ?? [],
      deny: overrides.deny ?? [],
    },
  })

  return getStaffAccess(session, staffId)
}

export async function updateStaff(
  session: SessionContext,
  staffId: string,
  input: z.infer<typeof staffUpdateSchema>,
  requestId?: string,
): Promise<StaffDto> {
  requirePermission(session, 'teachers.manage')
  const current = await getDoc<Staff>('staff', staffId)
  if (!current) throw notFound('Staff not found')

  const { password: _pw, profilePhotoId, ...rest } = input
  const accountRole =
    rest.accountRole ??
    (rest.category && rest.category !== current.category
      ? defaultAccountRoleForCategory(rest.category)
      : accountRoleForStaff(current))
  const row: Staff = {
    ...current,
    ...rest,
    id: staffId,
    accountRole,
    subjectIds: rest.subjectIds ?? current.subjectIds ?? [],
    classIds: rest.classIds ?? current.classIds ?? [],
  }
  if (profilePhotoId === null) {
    delete row.profilePhotoId
    delete row.photoUrl
  } else if (profilePhotoId) {
    row.profilePhotoId = profilePhotoId
  }
  // Keep suspension metadata consistent with status (use dedicated suspend/reactivate APIs for full control).
  if (row.status === 'ACTIVE') {
    row.suspension = null
  }
  await setDoc('staff', staffId, { ...row })

  if (accountRole !== accountRoleForStaff(current)) {
    const cred = await getDoc<StaffCredRow>('staffCredentials', staffId)
    if (cred?.authUid) {
      await getAdminDb().collection('users').doc(cred.authUid).set({ role: accountRole }, { merge: true })
      await setDoc('staffCredentials', staffId, { ...cred, role: accountRole })
      const { forget } = await import('@/server/http/memo')
      forget(`session:${cred.authUid}`)
    }
  }

  if (rest.email && rest.email.toLowerCase() !== current.email.toLowerCase()) {
    const cred = await getDoc<StaffCredRow>('staffCredentials', staffId)
    if (cred?.authUid) {
      await getAdminAuth().updateUser(cred.authUid, { email: rest.email.toLowerCase() })
      await setDoc('staffCredentials', staffId, {
        ...cred,
        email: rest.email.toLowerCase(),
      })
    }
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'staff.update',
    entityType: 'staff',
    entityId: staffId,
    requestId,
  })
  return row
}

export async function deleteStaff(
  session: SessionContext,
  staffId: string,
  requestId?: string,
): Promise<{ deleted: true; id: string }> {
  requirePermission(session, 'teachers.manage')
  const current = await getDoc<Staff>('staff', staffId)
  if (!current) throw notFound('Staff not found')

  const cred = await getDoc<StaffCredRow>('staffCredentials', staffId)
  if (cred?.authUid) {
    try {
      await getAdminAuth().deleteUser(cred.authUid)
    } catch (err) {
      console.error('deleteStaff auth user failed', err)
    }
  }

  // Clear class-teacher links
  const classes = await queryCollection<SchoolClass>('classes', { limit: 100 })
  await Promise.all(
    classes
      .filter((c) => c.classTeacherId === staffId)
      .map((c) => setDoc('classes', c.id, { ...c, classTeacherId: undefined })),
  )

  await deleteDoc('staffCredentials', staffId).catch(() => undefined)
  await deleteDoc('staff', staffId)

  // Also remove users/{uid} profile if linked
  if (cred?.authUid) {
    try {
      await getAdminDb().collection('users').doc(cred.authUid).delete()
    } catch {
      /* ignore */
    }
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'staff.delete',
    entityType: 'staff',
    entityId: staffId,
    requestId,
  })
  return { deleted: true, id: staffId }
}

/** Clears the admin “Temp password” tag after the teacher changes their own password. */
export async function clearTemporaryPasswordFlag(
  session: SessionContext,
): Promise<{ cleared: boolean }> {
  const staffId = session.profile.staffId
  if (!staffId) return { cleared: false }

  const cred = await getDoc<StaffCredRow>('staffCredentials', staffId)
  if (!cred) return { cleared: false }

  await setDoc('staffCredentials', staffId, {
    ...cred,
    temporaryPassword: false,
    // Stop showing the old admin-issued secret on the login sheet
    password: '',
  })
  return { cleared: true }
}

/**
 * Clear temp-password sheet fields after a forgot-password email is sent
 * (admin must not keep showing a password the teacher is about to replace).
 */
export async function clearTemporaryPasswordForEmail(
  email: string,
): Promise<{ cleared: boolean }> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return { cleared: false }
  const rows = await queryCollection<StaffCredRow>('staffCredentials', { limit: 200 })
  const match = rows.find((r) => r.email?.toLowerCase() === normalized)
  if (!match) return { cleared: false }
  const id = match.staffId || match.id
  await setDoc('staffCredentials', id, {
    ...match,
    temporaryPassword: false,
    password: '',
  })
  return { cleared: true }
}

export async function suspendStaff(
  session: SessionContext,
  staffId: string,
  input: StaffSuspendInput,
  requestId?: string,
): Promise<StaffDto> {
  requirePermission(session, 'teachers.manage')
  const current = await getDoc<Staff>('staff', staffId)
  if (!current) throw notFound('Staff not found')

  const startsAt = todayIsoDate()
  const endsAt = input.endsAt === undefined ? null : input.endsAt
  if (endsAt && endsAt < startsAt) {
    throw badRequest('Suspension end date cannot be before today')
  }

  const suspension: StaffSuspension = {
    reason: input.reason.trim(),
    startsAt,
    endsAt,
    suspendedAt: new Date().toISOString(),
    suspendedBy: session.uid,
    suspendedByName: session.profile.name,
  }

  const row: Staff = {
    ...current,
    status: 'INACTIVE',
    suspension,
  }
  await setDoc('staff', staffId, row)

  // Drop cached sessions so an open browser loses API access quickly
  try {
    const { forget } = await import('@/server/http/memo')
    forget('session:')
  } catch {
    /* ignore */
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'staff.suspend',
    entityType: 'staff',
    entityId: staffId,
    requestId,
    metadata: { endsAt, reason: suspension.reason },
  })

  return row
}

export async function reactivateStaff(
  session: SessionContext,
  staffId: string,
  requestId?: string,
): Promise<StaffDto> {
  requirePermission(session, 'teachers.manage')
  const current = await getDoc<Staff>('staff', staffId)
  if (!current) throw notFound('Staff not found')

  const row: Staff = {
    ...current,
    status: 'ACTIVE',
    suspension: null,
  }
  await setDoc('staff', staffId, row)

  try {
    const { forget } = await import('@/server/http/memo')
    forget('session:')
  } catch {
    /* ignore */
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'staff.reactivate',
    entityType: 'staff',
    entityId: staffId,
    requestId,
  })

  return row
}

export const listStaffService = listStaff
export const createStaffService = createStaff
export const updateStaffService = updateStaff
export const deleteStaffService = deleteStaff
export const listStaffCredentialsService = listStaffCredentials
export const resetStaffPasswordService = resetStaffPassword
export const getStaffAccessService = getStaffAccess
export const updateStaffAccessService = updateStaffAccess
export const clearTemporaryPasswordFlagService = clearTemporaryPasswordFlag
export const clearTemporaryPasswordForEmailService = clearTemporaryPasswordForEmail
export const suspendStaffService = suspendStaff
export const reactivateStaffService = reactivateStaff
export const assertStaffAccountActiveService = assertStaffAccountActive

// Guardians lived here briefly — re-export for API routes that still import from staff-service
export {
  listGuardiansService,
  createGuardianService,
  updateGuardianService,
} from '@/server/services/guardians-service'
