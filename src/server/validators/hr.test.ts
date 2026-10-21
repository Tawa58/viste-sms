import { describe, expect, it } from 'vitest'
import { hrStaffSchema } from './hr'

const employee = {
  fullName: 'Alex Staff',
  nationalId: 'ID-12345',
  gender: 'UNSPECIFIED',
  dateOfBirth: '',
  phone: '+263 771 123456',
  email: 'alex@example.com',
  address: '',
  emergencyContact: { name: '', relationship: '', phone: '' },
  position: 'Teacher',
  department: 'Primary',
  category: 'TEACHER',
  dateEmployed: '2026-01-10',
  employmentType: 'PERMANENT',
  status: 'ACTIVE',
  salaryScaleId: 'SS-0001',
  bank: { bankName: '', accountNumber: '', branch: '' },
  linkedUid: 'user-123',
  directoryStaffId: 'staff-123',
  notes: '',
}

describe('hrStaffSchema', () => {
  it('accepts imported directory profiles with unspecified gender', () => {
    expect(hrStaffSchema.safeParse(employee).success).toBe(true)
  })

  it('requires verified national ID for a payroll profile', () => {
    expect(hrStaffSchema.safeParse({ ...employee, nationalId: '' }).success).toBe(false)
  })
})
