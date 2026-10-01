import type { UserRole } from '@/types'

/** Canonical permission strings — enforced server-side only. */
export const PERMISSIONS = [
  'students.read',
  'students.create',
  'students.update',
  'students.archive',
  'students.transfer',
  'students.exempt',
  'parents.read',
  'parents.manage',
  'teachers.read',
  'teachers.manage',
  'staff.read',
  'staff.manage',
  'classes.read',
  'classes.manage',
  'subjects.read',
  'subjects.manage',
  'extracurricular.read',
  'extracurricular.manage',
  'attendance.read',
  'attendance.create',
  'attendance.update',
  'fees.read',
  'fees.create',
  'fees.update',
  'payments.read',
  'payments.create',
  'payments.reverse',
  'results.read',
  'results.enter',
  'results.update',
  'results.approve',
  'results.publish',
  'results.lock',
  'users.manage',
  'roles.manage',
  'settings.manage',
  'audit.read',
  'checkin.self',
  'checkin.manage',
  'hr.read',
  'hr.manage',
  'payroll.read',
  'payroll.manage',
  'payroll.approve',
  'finance.read',
  'finance.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const ALL: Permission[] = [...PERMISSIONS]

const FINANCE: Permission[] = [
  'students.read',
  'parents.read',
  'fees.read',
  'fees.create',
  'fees.update',
  'payments.read',
  'payments.create',
  'payments.reverse',
  'checkin.self',
]

/** Finance administrators run payroll and keep the expense / revenue books. */
const FINANCE_ADMIN: Permission[] = [
  ...FINANCE,
  'hr.read',
  'payroll.read',
  'payroll.manage',
  'payroll.approve',
  'finance.read',
  'finance.manage',
]

/** Principals see HR, payroll and the books but only the finance/HR roles change them. */
const HR_FINANCE_MANAGE: Permission[] = [
  'hr.manage',
  'payroll.manage',
  'payroll.approve',
  'finance.manage',
]

const TEACHER: Permission[] = [
  'checkin.self',
  'students.read',
  'students.update',
  'classes.read',
  'subjects.read',
  'extracurricular.read',
  'attendance.read',
  'attendance.create',
  'attendance.update',
  'results.read',
  'results.enter',
  'results.update',
]

const PARENT: Permission[] = [
  'students.read',
  'parents.read',
  'fees.read',
  'payments.read',
  'attendance.read',
  'results.read',
]

const STUDENT: Permission[] = [
  'students.read',
  'attendance.read',
  'results.read',
  'fees.read',
  'payments.read',
]

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  SUPER_ADMIN: ALL,
  SCHOOL_ADMIN: ALL,
  PRINCIPAL: ALL.filter((p) => p !== 'roles.manage' && !HR_FINANCE_MANAGE.includes(p)),
  TEACHER,
  ACCOUNTANT: FINANCE_ADMIN,
  FINANCE_OFFICER: FINANCE_ADMIN,
  HR_ADMIN: ['hr.read', 'hr.manage', 'checkin.self'],
  FINANCE_VIEWER: ['finance.read', 'checkin.self'],
  REGISTRAR: [
    'students.read',
    'students.create',
    'students.update',
    'students.archive',
    'students.transfer',
    'students.exempt',
    'parents.read',
    'parents.manage',
    'teachers.read',
    'staff.read',
    'classes.read',
    'classes.manage',
    'subjects.read',
    'subjects.manage',
    'extracurricular.read',
    'extracurricular.manage',
    'attendance.read',
    'attendance.create',
    'attendance.update',
    'checkin.self',
  ],
  RECEPTIONIST: ['students.read', 'parents.read', 'checkin.self'],
  LIBRARIAN: ['students.read', 'checkin.self'],
  TRANSPORT_MANAGER: ['students.read', 'checkin.self'],
  PARENT,
  STUDENT,
}

/**
 * Permissions an admin may grant/deny on an individual teacher.
 * Excludes school-wide admin controls (users/roles/settings/audit).
 */
export const TEACHER_ASSIGNABLE_PERMISSIONS: readonly Permission[] = [
  'students.read',
  'students.create',
  'students.update',
  'students.archive',
  'students.transfer',
  'students.exempt',
  'parents.read',
  'parents.manage',
  'classes.read',
  'classes.manage',
  'subjects.read',
  'subjects.manage',
  'extracurricular.read',
  'extracurricular.manage',
  'attendance.read',
  'attendance.create',
  'attendance.update',
  'fees.read',
  'fees.create',
  'fees.update',
  'payments.read',
  'payments.create',
  'results.read',
  'results.enter',
  'results.update',
  'results.approve',
  'results.publish',
]

export const TEACHER_PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  {
    label: 'Students',
    permissions: [
      'students.read',
      'students.create',
      'students.update',
      'students.archive',
      'students.transfer',
      'students.exempt',
    ],
  },
  {
    label: 'Classes & subjects',
    permissions: [
      'classes.read',
      'classes.manage',
      'subjects.read',
      'subjects.manage',
      'extracurricular.read',
      'extracurricular.manage',
    ],
  },
  {
    label: 'Attendance',
    permissions: ['attendance.read', 'attendance.create', 'attendance.update'],
  },
  {
    label: 'Exams & results',
    permissions: [
      'results.read',
      'results.enter',
      'results.update',
      'results.approve',
      'results.publish',
    ],
  },
  {
    label: 'Parents & fees',
    permissions: [
      'parents.read',
      'parents.manage',
      'fees.read',
      'fees.create',
      'fees.update',
      'payments.read',
      'payments.create',
    ],
  },
]

/** Map app paths → required permission (null = always allowed for signed-in users with route access). */
export const PATH_PERMISSION: Record<string, Permission | null> = {
  '/dashboard': null,
  '/settings': null,
  '/announcements': null,
  '/reports': 'students.read',
  '/students': 'students.read',
  '/classes': 'classes.read',
  '/subjects': 'subjects.read',
  '/sports': 'extracurricular.read',
  '/clubs': 'extracurricular.read',
  '/attendance': 'attendance.read',
  '/examinations': 'results.read',
  '/results': 'results.read',
  '/fees': 'fees.read',
  '/parents': 'parents.read',
  '/teachers': 'teachers.read',
  '/users': 'users.manage',
  '/audit-logs': 'audit.read',
  '/inventory': 'settings.manage',
  '/library': 'students.read',
  '/transport': 'students.read',
  '/check-in': 'checkin.self',
  '/staff-attendance': 'checkin.manage',
  '/hr': 'hr.read',
  '/payroll': 'payroll.read',
  '/finance': 'finance.read',
  '/expenses': 'finance.manage',
  '/revenue': 'finance.manage',
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value)
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

export function listPermissions(role: UserRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])]
}

export type PermissionOverrides = {
  grant?: string[]
  deny?: string[]
}

/** Role baseline ∪ grant − deny, clamped to known permissions. */
export function resolveEffectivePermissions(
  role: UserRole,
  overrides?: PermissionOverrides | null,
): Permission[] {
  const base = new Set(listPermissions(role))
  for (const raw of overrides?.grant ?? []) {
    if (isPermission(raw)) base.add(raw)
  }
  for (const raw of overrides?.deny ?? []) {
    if (isPermission(raw)) base.delete(raw)
  }
  return PERMISSIONS.filter((p) => base.has(p))
}

/**
 * Build grant/deny from an admin checkbox set for a teacher.
 * Only TEACHER_ASSIGNABLE_PERMISSIONS may change; other role perms stay as defaults.
 */
export function overridesFromTeacherSelection(selected: string[]): PermissionOverrides {
  const defaults = new Set(listPermissions('TEACHER'))
  const assignable = new Set(TEACHER_ASSIGNABLE_PERMISSIONS)
  const chosen = new Set(
    selected.filter((p): p is Permission => isPermission(p) && assignable.has(p)),
  )

  const grant: Permission[] = []
  const deny: Permission[] = []
  for (const p of TEACHER_ASSIGNABLE_PERMISSIONS) {
    const on = chosen.has(p)
    const wasDefault = defaults.has(p)
    if (on && !wasDefault) grant.push(p)
    if (!on && wasDefault) deny.push(p)
  }
  return { grant, deny }
}

export function pathAllowedByPermissions(
  pathname: string,
  permissions: readonly string[],
): boolean {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  const match =
    Object.keys(PATH_PERMISSION)
      .sort((a, b) => b.length - a.length)
      .find((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`)) ?? null
  if (!match) return false
  const required = PATH_PERMISSION[match]
  if (required === null) return true
  return permissions.includes(required)
}
