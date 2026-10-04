import { describe, expect, it } from 'vitest'
import { defaultAccountRoleForCategory } from '@/lib/staff-categories'
import { canAccessPath } from '@/lib/roles'

describe('defaultAccountRoleForCategory', () => {
  it('maps finance and library categories to their matching account roles', () => {
    expect(defaultAccountRoleForCategory('ACCOUNTANT')).toBe('ACCOUNTANT')
    expect(defaultAccountRoleForCategory('LIBRARIAN')).toBe('LIBRARIAN')
  })

  it('maps administration and non-teaching support to least-privilege roles', () => {
    expect(defaultAccountRoleForCategory('ADMINISTRATION')).toBe('REGISTRAR')
    expect(defaultAccountRoleForCategory('SUPPORT_STAFF')).toBe('RECEPTIONIST')
    expect(defaultAccountRoleForCategory('OTHER')).toBe('RECEPTIONIST')
  })

  it('lets explicitly granted staff permissions open their assigned modules', () => {
    expect(
      canAccessPath('RECEPTIONIST', '/fees', ['students.read', 'fees.read']),
    ).toBe(true)
    expect(canAccessPath('RECEPTIONIST', '/payroll', ['students.read'])).toBe(false)
  })
})
