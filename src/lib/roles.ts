import type { UserRole } from '@/types'

/** Path → permission required for teachers with custom access (null = always). */
const PATH_PERMISSION: Record<string, string | null> = {
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
}

function pathAllowedByPermissions(pathname: string, permissions: readonly string[]) {
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

const SCHOOL_SETTINGS_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'SCHOOL_ADMIN',
  'PRINCIPAL',
]

const STAFF_ROLES: UserRole[] = [
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
]

/** Routes each role may open. `*` = full school console. */
export const ROLE_ROUTES: Record<UserRole, '*' | string[]> = {
  SUPER_ADMIN: '*',
  SCHOOL_ADMIN: '*',
  PRINCIPAL: '*',
  TEACHER: [
    '/dashboard',
    '/students',
    '/classes',
    '/subjects',
    '/sports',
    '/clubs',
    '/attendance',
    '/examinations',
    '/results',
    '/announcements',
    '/reports',
    '/check-in',
    '/settings',
  ],
  ACCOUNTANT: [
    '/dashboard',
    '/students',
    '/fees',
    '/parents',
    '/reports',
    '/announcements',
    '/check-in',
    '/settings',
  ],
  FINANCE_OFFICER: [
    '/dashboard',
    '/students',
    '/fees',
    '/parents',
    '/reports',
    '/announcements',
    '/check-in',
    '/settings',
  ],
  REGISTRAR: [
    '/dashboard',
    '/students',
    '/parents',
    '/classes',
    '/subjects',
    '/sports',
    '/clubs',
    '/attendance',
    '/announcements',
    '/reports',
    '/check-in',
    '/settings',
  ],
  RECEPTIONIST: [
    '/dashboard',
    '/students',
    '/parents',
    '/announcements',
    '/check-in',
    '/settings',
  ],
  LIBRARIAN: ['/dashboard', '/library', '/students', '/announcements', '/check-in', '/settings'],
  TRANSPORT_MANAGER: [
    '/dashboard',
    '/transport',
    '/students',
    '/announcements',
    '/check-in',
    '/settings',
  ],
  PARENT: [
    '/dashboard',
    '/students',
    '/fees',
    '/attendance',
    '/results',
    '/announcements',
    '/settings',
  ],
  STUDENT: ['/dashboard', '/my', '/settings'],
}

export function isStaffRole(role: UserRole) {
  return STAFF_ROLES.includes(role)
}

export function canManageSchoolSettings(role: UserRole) {
  return SCHOOL_SETTINGS_ROLES.includes(role)
}

/** Admin-level student registration, guardian edits, and full profile control. */
export function canManageStudents(role: UserRole) {
  return (
    role === 'SUPER_ADMIN' ||
    role === 'SCHOOL_ADMIN' ||
    role === 'PRINCIPAL' ||
    role === 'REGISTRAR'
  )
}

/** Create/edit/archive classes and manage class membership. */
export function canManageClasses(role: UserRole) {
  return canManageStudents(role)
}

/** Manage subjects, sports, clubs, and houses. */
export function canManageAcademics(role: UserRole) {
  return canManageStudents(role)
}

/** Teachers may update limited contact fields only. */
export function canEditStudentLimited(role: UserRole) {
  return role === 'TEACHER' || canManageStudents(role)
}

export function canViewStaffCredentials(role: UserRole) {
  return role === 'SUPER_ADMIN' || role === 'SCHOOL_ADMIN' || role === 'PRINCIPAL'
}

export function hasFullConsoleAccess(role: UserRole) {
  return ROLE_ROUTES[role] === '*'
}

export function canAccessPath(
  role: UserRole,
  pathname: string,
  permissions?: readonly string[] | null,
) {
  const allowed = ROLE_ROUTES[role]
  if (allowed === '*') return true

  // Per-user permission overrides (teachers) further restrict/expand within role routes
  if (permissions && permissions.length > 0 && role === 'TEACHER') {
    const inRoleRoutes = allowed.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`),
    )
    if (!inRoleRoutes) return false
    return pathAllowedByPermissions(pathname, permissions)
  }

  return allowed.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  )
}

export function hasAppPermission(
  permissions: readonly string[] | null | undefined,
  permission: string,
) {
  return Boolean(permissions?.includes(permission))
}

export function formatRoleLabel(role: UserRole) {
  return role.replaceAll('_', ' ')
}

export function defaultTitleForRole(role: UserRole) {
  switch (role) {
    case 'SUPER_ADMIN':
      return 'Super Administrator'
    case 'SCHOOL_ADMIN':
      return 'School Administrator'
    case 'PRINCIPAL':
      return 'Principal'
    case 'TEACHER':
      return 'Teacher'
    case 'ACCOUNTANT':
      return 'Accountant'
    case 'FINANCE_OFFICER':
      return 'Finance Officer'
    case 'REGISTRAR':
      return 'Registrar'
    case 'RECEPTIONIST':
      return 'Receptionist'
    case 'LIBRARIAN':
      return 'Librarian'
    case 'TRANSPORT_MANAGER':
      return 'Transport Manager'
    case 'PARENT':
      return 'Parent / Guardian'
    case 'STUDENT':
      return 'Student'
    default:
      return formatRoleLabel(role)
  }
}
