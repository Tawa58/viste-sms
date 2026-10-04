/** Human labels for console permission checkboxes (mirrors server RBAC). */
export const PERMISSION_GROUPS: { label: string; permissions: string[] }[] = [
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
    label: 'Parents',
    permissions: ['parents.read', 'parents.manage'],
  },
  {
    label: 'Staff & teachers',
    permissions: ['teachers.read', 'teachers.manage', 'staff.read', 'staff.manage'],
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
    label: 'Library',
    permissions: ['library.manage'],
  },
  {
    label: 'Attendance',
    permissions: ['attendance.read', 'attendance.create', 'attendance.update'],
  },
  {
    label: 'Fees & payments',
    permissions: [
      'fees.read',
      'fees.create',
      'fees.update',
      'payments.read',
      'payments.create',
      'payments.reverse',
    ],
  },
  {
    label: 'Exams & results',
    permissions: [
      'results.read',
      'results.enter',
      'results.update',
      'results.approve',
      'results.publish',
      'results.lock',
    ],
  },
  {
    label: 'HR & payroll',
    permissions: ['hr.read', 'hr.manage', 'payroll.read', 'payroll.manage', 'payroll.approve'],
  },
  {
    label: 'School finance',
    permissions: ['finance.read', 'finance.manage'],
  },
  {
    label: 'Administration',
    permissions: ['users.manage', 'roles.manage', 'settings.manage', 'audit.read'],
  },
]

export function permissionLabel(permission: string): string {
  const [area, action] = permission.split('.')
  const areaLabel = (area || '').replaceAll('_', ' ')
  const actionLabel = (action || '').replaceAll('_', ' ')
  return `${areaLabel}: ${actionLabel}`
}

export const ASSIGNABLE_CONSOLE_ROLES = [
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
] as const

export function roleLabel(role: string): string {
  return role.replaceAll('_', ' ')
}
