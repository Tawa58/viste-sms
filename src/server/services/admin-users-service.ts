import 'server-only'

import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { omitUndefined } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import {
  listPermissions,
  resolveEffectivePermissions,
  type Permission,
  type PermissionOverrides,
} from '@/server/authorization/rbac-map'
import { badRequest, conflict, forbidden, notFound } from '@/server/errors'
import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
import type { UserCreateInput, UserUpdateInput, RoleMatrixUpdateInput } from '@/server/validators/admin'
import type { AppUser, AuditLog, RolePermission, UserRole } from '@/types'

const MANAGEABLE_ROLES: UserRole[] = [
  'SCHOOL_ADMIN',
  'PRINCIPAL',
  'ACCOUNTANT',
  'FINANCE_OFFICER',
  'FINANCE_VIEWER',
  'HR_ADMIN',
  'REGISTRAR',
  'RECEPTIONIST',
  'LIBRARIAN',
  'TRANSPORT_MANAGER',
  'TEACHER',
]

const DISPLAY_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  ...MANAGEABLE_ROLES,
  'PARENT',
  'STUDENT',
]

export async function getRoleOverrides(role: UserRole): Promise<PermissionOverrides | null> {
  const snap = await getAdminDb().collection('rolePermissions').doc(role).get()
  if (!snap.exists) return null
  const data = snap.data() as { grant?: string[]; deny?: string[] }
  return {
    grant: data.grant ?? [],
    deny: data.deny ?? [],
  }
}

export async function listUsers(session: SessionContext): Promise<AppUser[]> {
  requirePermission(session, 'users.manage')
  const snap = await getAdminDb().collection('users').limit(200).get()
  const rows: AppUser[] = []
  for (const doc of snap.docs) {
    const data = doc.data() as Partial<AppUser> & { disabled?: boolean }
    rows.push({
      id: doc.id,
      name: data.name || data.email || doc.id,
      email: (data.email || '').toLowerCase(),
      role: (data.role as UserRole) || 'STUDENT',
      status: data.status === 'DISABLED' || data.disabled ? 'DISABLED' : 'ACTIVE',
      lastLogin: data.lastLogin,
      title: data.title,
      staffId: data.staffId,
      createdAt: data.createdAt,
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export async function createUser(
  session: SessionContext,
  input: UserCreateInput,
  requestId?: string,
): Promise<AppUser> {
  requirePermission(session, 'users.manage')
  if (!MANAGEABLE_ROLES.includes(input.role)) throw badRequest('Role cannot be assigned here')
  if (input.role === 'SCHOOL_ADMIN' && session.role !== 'SUPER_ADMIN' && session.role !== 'SCHOOL_ADMIN') {
    throw forbidden('Only school admins can create school admin accounts')
  }

  const email = input.email.trim().toLowerCase()
  let authUid: string
  try {
    const user = await getAdminAuth().createUser({
      email,
      password: input.password,
      displayName: input.name.trim(),
      emailVerified: false,
      disabled: false,
    })
    authUid = user.uid
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'auth/email-already-exists') throw conflict('Email already registered')
    throw err
  }

  const now = new Date().toISOString()
  const row: AppUser = {
    id: authUid,
    name: input.name.trim(),
    email,
    role: input.role,
    status: 'ACTIVE',
    title: input.title?.trim() || undefined,
    createdAt: now,
  }
  await getAdminDb()
    .collection('users')
    .doc(authUid)
    .set(
      omitUndefined({
        ...row,
        preferredLanguage: 'en',
        timezone: 'Africa/Harare',
        notificationPrefs: { email: true, sms: false, inApp: true },
      }),
    )

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    actorName: session.profile.name,
    actorEmail: session.email,
    action: 'users.create',
    entityType: 'users',
    entityId: authUid,
    requestId,
    metadata: { email, role: input.role },
    summary: `${session.profile.name} created user ${row.name} (${input.role})`,
  })

  return row
}

export async function updateUser(
  session: SessionContext,
  id: string,
  patch: UserUpdateInput,
  requestId?: string,
): Promise<AppUser> {
  requirePermission(session, 'users.manage')
  if (id === session.uid && patch.status === 'DISABLED') {
    throw badRequest('You cannot disable your own account')
  }
  if (id === session.uid && patch.role && patch.role !== session.role) {
    throw badRequest('You cannot change your own role')
  }

  const ref = getAdminDb().collection('users').doc(id)
  const snap = await ref.get()
  if (!snap.exists) throw notFound('User not found')
  const current = snap.data() as Partial<AppUser>

  if (current.role === 'SUPER_ADMIN' && session.role !== 'SUPER_ADMIN') {
    throw forbidden('Only a super admin can change another super admin')
  }
  if (patch.role && !MANAGEABLE_ROLES.includes(patch.role) && patch.role !== current.role) {
    throw badRequest('Role cannot be assigned here')
  }

  const nextRole = patch.role ?? (current.role as UserRole) ?? 'STUDENT'
  const nextStatus = patch.status ?? (current.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE')
  const nextName = patch.name?.trim() ?? current.name ?? current.email ?? id
  const nextTitle =
    patch.title !== undefined ? patch.title.trim() || undefined : current.title

  await ref.set(
    omitUndefined({
      name: nextName,
      role: nextRole,
      status: nextStatus,
      title: nextTitle,
      updatedAt: new Date().toISOString(),
    }),
    { merge: true },
  )

  try {
    await getAdminAuth().updateUser(id, {
      displayName: nextName,
      disabled: nextStatus === 'DISABLED',
    })
  } catch {
    /* Auth user may be missing for legacy rows */
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    actorName: session.profile.name,
    actorEmail: session.email,
    action: 'users.update',
    entityType: 'users',
    entityId: id,
    requestId,
    metadata: { patch },
    summary: `${session.profile.name} updated ${nextName} (${nextRole}, ${nextStatus})`,
  })

  return {
    id,
    name: nextName,
    email: (current.email || '').toLowerCase(),
    role: nextRole,
    status: nextStatus,
    lastLogin: current.lastLogin,
    title: nextTitle,
    staffId: current.staffId,
    createdAt: current.createdAt,
  }
}

export async function listRoleMatrices(session: SessionContext): Promise<RolePermission[]> {
  requirePermission(session, 'users.manage')
  const out: RolePermission[] = []
  for (const role of DISPLAY_ROLES) {
    const overrides = role === 'SUPER_ADMIN' ? null : await getRoleOverrides(role)
    const permissions = resolveEffectivePermissions(role, overrides)
    out.push({
      role,
      permissions,
      grant: overrides?.grant ?? [],
      deny: overrides?.deny ?? [],
      locked: role === 'SUPER_ADMIN' || role === 'PARENT' || role === 'STUDENT',
    })
  }
  return out
}

export async function updateRoleMatrix(
  session: SessionContext,
  input: RoleMatrixUpdateInput,
  requestId?: string,
): Promise<RolePermission> {
  requirePermission(session, 'roles.manage')
  if (!MANAGEABLE_ROLES.includes(input.role)) {
    throw badRequest('This role matrix cannot be edited')
  }

  const baseline = new Set(listPermissions(input.role))
  const chosen = new Set(input.permissions.filter((p) => typeof p === 'string'))
  const cleanGrant = [...chosen].filter((p) => !baseline.has(p as Permission)) as Permission[]
  const cleanDeny = [...baseline].filter((p) => !chosen.has(p)) as Permission[]

  await getAdminDb()
    .collection('rolePermissions')
    .doc(input.role)
    .set({
      role: input.role,
      grant: cleanGrant,
      deny: cleanDeny,
      updatedAt: new Date().toISOString(),
      updatedBy: session.uid,
    })

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    actorName: session.profile.name,
    actorEmail: session.email,
    action: 'roles.update',
    entityType: 'rolePermissions',
    entityId: input.role,
    requestId,
    metadata: { grant: cleanGrant, deny: cleanDeny },
    summary: `${session.profile.name} updated permissions for ${input.role}`,
  })

  const permissions = resolveEffectivePermissions(input.role, {
    grant: cleanGrant,
    deny: cleanDeny,
  })
  return {
    role: input.role,
    permissions,
    grant: cleanGrant,
    deny: cleanDeny,
    locked: false,
  }
}

function humanAction(action: string): string {
  const map: Record<string, string> = {
    'auth.login': 'Signed in',
    'auth.logout': 'Signed out',
    'auth.login_failed': 'Failed sign-in',
    'users.create': 'Created user',
    'users.update': 'Updated user',
    'roles.update': 'Updated role permissions',
  }
  return map[action] || action.replaceAll('.', ' · ')
}

export async function listAuditLogs(session: SessionContext): Promise<AuditLog[]> {
  requirePermission(session, 'audit.read')
  const snap = await getAdminDb()
    .collection('auditLogs')
    .orderBy('at', 'desc')
    .limit(200)
    .get()

  const userCache = new Map<string, { name?: string; email?: string }>()
  async function resolveActor(actorId?: string) {
    if (!actorId) return null
    if (userCache.has(actorId)) return userCache.get(actorId)!
    const doc = await getAdminDb().collection('users').doc(actorId).get()
    const data = doc.exists ? (doc.data() as { name?: string; email?: string }) : {}
    const info = { name: data.name, email: data.email }
    userCache.set(actorId, info)
    return info
  }

  const rows: AuditLog[] = []
  for (const doc of snap.docs) {
    const raw = doc.data() as AuditLog & { entityType?: string }
    const actorId = raw.actorId || (raw.user?.startsWith('aud_') ? undefined : raw.user)
    const resolved = actorId && !raw.actorName ? await resolveActor(actorId) : null
    const actorName = raw.actorName || resolved?.name || raw.user
    const actorEmail = raw.actorEmail || resolved?.email
    rows.push({
      id: raw.id || doc.id,
      user: actorName || actorId || 'Unknown',
      actorId,
      actorName: actorName || undefined,
      actorEmail: actorEmail || undefined,
      actorRole: raw.actorRole,
      action: raw.action,
      module: raw.module || raw.entityType || 'system',
      record: raw.record,
      entityId: raw.entityId,
      status: raw.status || 'SUCCESS',
      at: raw.at,
      metadata: raw.metadata,
      summary:
        raw.summary ||
        `${actorName || 'Someone'} · ${humanAction(raw.action)}${
          raw.record ? ` · ${raw.record}` : ''
        }`,
    })
  }
  return rows
}

export async function recordAuthActivity(
  session: SessionContext,
  event: 'login' | 'logout',
  requestId?: string,
): Promise<{ ok: true }> {
  const now = new Date().toISOString()
  if (event === 'login') {
    await getAdminDb()
      .collection('users')
      .doc(session.uid)
      .set({ lastLogin: now }, { merge: true })
  }
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    actorName: session.profile.name,
    actorEmail: session.email,
    action: event === 'login' ? 'auth.login' : 'auth.logout',
    entityType: 'auth',
    entityId: session.uid,
    requestId,
    metadata: { authTime: session.token.authTime },
    summary:
      event === 'login'
        ? `${session.profile.name} signed in (${session.role.replaceAll('_', ' ')})`
        : `${session.profile.name} signed out`,
  })
  return { ok: true }
}

export const listUsersService = listUsers
export const createUserService = createUser
export const updateUserService = updateUser
export const listRoleMatricesService = listRoleMatrices
export const updateRoleMatrixService = updateRoleMatrix
export const listAuditLogsDetailedService = listAuditLogs
export const recordAuthActivityService = recordAuthActivity
export const getRoleOverridesService = getRoleOverrides
