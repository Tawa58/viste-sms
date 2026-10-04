import type { StaffAccountRole, StaffCategory } from '@/types'

export const STAFF_ACCOUNT_ROLES: { value: StaffAccountRole; label: string }[] = [
  { value: 'TEACHER', label: 'Teacher' },
  { value: 'ACCOUNTANT', label: 'Accountant' },
  { value: 'FINANCE_OFFICER', label: 'Finance officer' },
  { value: 'REGISTRAR', label: 'Registrar' },
  { value: 'RECEPTIONIST', label: 'Receptionist' },
  { value: 'LIBRARIAN', label: 'Librarian' },
  { value: 'TRANSPORT_MANAGER', label: 'Transport manager' },
  { value: 'HR_ADMIN', label: 'HR administrator' },
  { value: 'FINANCE_VIEWER', label: 'Finance viewer' },
]

export const STAFF_CATEGORIES: {
  value: StaffCategory
  label: string
}[] = [
  { value: 'TEACHER', label: 'Teacher' },
  { value: 'COACH', label: 'Sports coach' },
  { value: 'SPORTS_OFFICIAL', label: 'Sports official / leadership' },
  { value: 'MEDIC', label: 'Medic / first aider' },
  { value: 'ADMINISTRATION', label: 'Administration' },
  { value: 'SUPPORT_STAFF', label: 'Support staff' },
  { value: 'ACCOUNTANT', label: 'Accounts / finance' },
  { value: 'LIBRARIAN', label: 'Librarian' },
  { value: 'OTHER', label: 'Other' },
]

export function staffCategoryLabel(category?: StaffCategory | null): string {
  if (!category) return 'Teacher'
  return STAFF_CATEGORIES.find((c) => c.value === category)?.label ?? category
}

export function normalizeStaffCategory(value: unknown): StaffCategory {
  if (
    typeof value === 'string' &&
    STAFF_CATEGORIES.some((c) => c.value === value)
  ) {
    return value as StaffCategory
  }
  return 'TEACHER'
}

export function defaultAccountRoleForCategory(
  category?: StaffCategory | null,
): StaffAccountRole {
  switch (category) {
    case 'TEACHER':
    case 'COACH':
    case 'SPORTS_OFFICIAL':
      return 'TEACHER'
    case 'ACCOUNTANT':
      return 'ACCOUNTANT'
    case 'LIBRARIAN':
      return 'LIBRARIAN'
    case 'ADMINISTRATION':
      return 'REGISTRAR'
    case 'MEDIC':
    case 'SUPPORT_STAFF':
    case 'OTHER':
      return 'RECEPTIONIST'
    default:
      return 'TEACHER'
  }
}
