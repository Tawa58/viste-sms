import 'server-only'

import { getAdminAuth, getAdminDb } from '@/lib/firebase/admin'
import { forbidden, unauthorized } from '@/server/errors'
import {
  hasPermission,
  requirePermission as assertPermission,
  resolveEffectivePermissions,
  type Permission,
  type PermissionOverrides,
} from '@/server/authorization/permissions'
import type { AuthUser, UserRole } from '@/types'

export type SessionContext = {
  uid: string
  email: string
  role: UserRole
  profile: AuthUser
  /** Effective permissions for this session (role + staff overrides). */
  permissions: import('@/server/authorization/rbac-map').Permission[]
  token: { authTime?: number }
}

const ALL_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'SCHOOL_ADMIN',
  'PRINCIPAL',
  'TEACHER',
  'ACCOUNTANT',
  'FINANCE_OFFICER',
  'REGISTRAR',
  'RECEPTIONIST',
  'LIBRARIAN',
  'TRANSPORT_MANAGER',
  'HR_ADMIN',
  'FINANCE_VIEWER',
  'PARENT',
  'STUDENT',
]

function bootstrapEmails(): Set<string> {
  return new Set(
    (process.env.BOOTSTRAP_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

function sanitizeRole(role: unknown): UserRole | null {
  return typeof role === 'string' && (ALL_ROLES as string[]).includes(role)
    ? (role as UserRole)
    : null
}

export function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value
  }
  return out as T
}

async function loadOrCreateProfile(
  uid: string,
  email: string,
  displayName?: string | null,
): Promise<AuthUser> {
  const db = getAdminDb()
  const ref = db.collection('users').doc(uid)
  const snap = await ref.get()

  if (snap.exists) {
    const data = snap.data() as Partial<AuthUser>
    const isBootstrap = bootstrapEmails().has(email.toLowerCase())
    let role = sanitizeRole(data.role) ?? 'STUDENT'
    // Elevate bootstrap admins even if profile was created earlier as STUDENT
    if (isBootstrap && (role === 'STUDENT' || !sanitizeRole(data.role))) {
      role = 'SUPER_ADMIN'
      await ref.set(
        omitUndefined({
          role: 'SUPER_ADMIN',
          title: data.title ?? 'Super Administrator',
        }),
        { merge: true },
      )
    }
    const profile: AuthUser = {
      id: uid,
      name: data.name ?? displayName ?? email.split('@')[0] ?? 'User',
      email: (data.email ?? email).toLowerCase(),
      role,
      avatarUrl: data.avatarUrl,
      avatarFileId: data.avatarFileId,
      phone: data.phone,
      title: isBootstrap ? data.title ?? 'Super Administrator' : data.title,
      department: data.department,
      employeeNumber: data.employeeNumber,
      staffId: data.staffId,
      studentId: data.studentId,
      guardianId: data.guardianId,
      bio: data.bio,
      preferredLanguage: data.preferredLanguage ?? 'en',
      timezone: data.timezone ?? 'Africa/Harare',
      notificationPrefs: {
        email: data.notificationPrefs?.email ?? true,
        sms: data.notificationPrefs?.sms ?? false,
        inApp: data.notificationPrefs?.inApp ?? true,
      },
      securityPrefs: {
        requireReauthForFees: data.securityPrefs?.requireReauthForFees ?? false,
      },
    }
    if (!isBootstrap && !sanitizeRole(data.role)) {
      await ref.set({ role: 'STUDENT' }, { merge: true })
    }
    return profile
  }

  const isBootstrap = bootstrapEmails().has(email.toLowerCase())
  const created: AuthUser = {
    id: uid,
    name: displayName ?? email.split('@')[0] ?? 'User',
    email: email.toLowerCase(),
    role: isBootstrap ? 'SUPER_ADMIN' : 'STUDENT',
    preferredLanguage: 'en',
    timezone: 'Africa/Harare',
    notificationPrefs: { email: true, sms: false, inApp: true },
    ...(isBootstrap ? { title: 'Super Administrator' } : {}),
  }
  await ref.set(omitUndefined({ ...created }))
  return created
}

/**
 * Verify Firebase ID token from Authorization: Bearer <token>,
 * load/create Firestore users/{uid}, reject anonymous.
 * New profiles default to STUDENT unless email is in BOOTSTRAP_ADMIN_EMAILS → SUPER_ADMIN.
 * NEVER defaults to SCHOOL_ADMIN.
 */
export async function verifyBearerToken(request: Request): Promise<SessionContext> {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) throw unauthorized()

  let decoded
  try {
    // checkRevoked=false avoids an extra Firebase round-trip on every API call
    decoded = await getAdminAuth().verifyIdToken(match[1], false)
  } catch {
    throw unauthorized('Invalid or expired token')
  }

  if (decoded.firebase?.sign_in_provider === 'anonymous') {
    throw unauthorized('Anonymous sessions are not allowed for API access')
  }

  const email = (decoded.email ?? '').toLowerCase()
  if (!email) throw unauthorized('Authenticated user has no email')

  const cacheKey = `session:${decoded.uid}`
  const { remember } = await import('@/server/http/memo')
  return remember(cacheKey, 20_000, async () => {
    let profile = await loadOrCreateProfile(decoded.uid, email, decoded.name)
    let overrides: PermissionOverrides | null = null
    try {
      const { getRoleOverrides } = await import('@/server/services/admin-users-service')
      const schoolOverrides = await getRoleOverrides(profile.role)
      if (schoolOverrides) overrides = schoolOverrides
    } catch {
      overrides = null
    }
    if (profile.staffId) {
      try {
        const { assertStaffAccountActive } = await import('@/server/services/staff-service')
        const staff = await assertStaffAccountActive(profile.staffId)
        if (staff) {
          // Keep HR fields from the staff directory (admin-managed) on the session profile.
          profile = {
            ...profile,
            title: staff.title || profile.title,
            department: staff.department || profile.department,
            employeeNumber: staff.employeeNumber || profile.employeeNumber,
            phone: profile.phone || staff.phone,
          }
        }
        if (staff && profile.role === 'TEACHER') {
          const staffOverrides = staff.permissionOverrides ?? null
          overrides = {
            grant: [...(overrides?.grant ?? []), ...(staffOverrides?.grant ?? [])],
            deny: [...(overrides?.deny ?? []), ...(staffOverrides?.deny ?? [])],
          }
        }
      } catch (err) {
        // Re-throw AppError (e.g. ACCOUNT_SUSPENDED); ignore soft lookup failures
        if (err && typeof err === 'object' && 'statusCode' in err) throw err
      }
    }
    if (profile.role === 'STUDENT' && profile.studentId) {
      const { assertStudentPortalActive } = await import(
        '@/server/services/student-portal-service'
      )
      await assertStudentPortalActive(profile.studentId)
    }
    const permissions = resolveEffectivePermissions(profile.role, overrides)
    return {
      uid: decoded.uid,
      email,
      role: profile.role,
      profile,
      permissions,
      token: { authTime: decoded.auth_time },
    }
  })
}

/** Alias for verifyBearerToken */
export const requireSession = verifyBearerToken

export function requirePerm(session: SessionContext, permission: Permission) {
  assertPermission(session, permission)
}

export function requirePermission(session: SessionContext, permission: Permission) {
  assertPermission(session, permission)
}

export function sessionHasPermission(session: SessionContext, permission: Permission) {
  return session.permissions?.includes(permission) ?? hasPermission(session.role, permission)
}

/** Strip privileged fields from client profile patches. */
export function sanitizeProfilePatch(
  patch: Partial<AuthUser>,
  opts?: { role?: string },
): Partial<AuthUser> {
  const {
    id: _id,
    role: _role,
    staffId: _staffId,
    studentId: _studentId,
    guardianId: _guardianId,
    email: _email,
    ...safe
  } = patch

  // Title / department / employee number are admin-managed for teachers.
  if (opts?.role === 'TEACHER') {
    delete (safe as Partial<AuthUser>).title
    delete (safe as Partial<AuthUser>).department
    delete (safe as Partial<AuthUser>).employeeNumber
  }

  return omitUndefined(safe as Record<string, unknown>) as Partial<AuthUser>
}
