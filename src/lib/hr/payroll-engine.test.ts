import { describe, expect, it } from 'vitest'
import { DEFAULT_ATTENDANCE_RULES } from '@/lib/hr/constants'
import { buildFinanceSummary } from '@/lib/hr/finance-summary'
import {
  buildPayrollItem,
  deductionAmount,
  finalizeItem,
  grossOf,
  nextCode,
  payrollExclusion,
  periodEnd,
  resolveScaleVersion,
  summarizeItems,
} from '@/lib/hr/payroll-engine'
import type { HrEmployee, PayrollDeduction, SalaryScaleVersion } from '@/types'

const employee: HrEmployee = {
  id: 'e1',
  employeeNumber: 'EMP-0001',
  fullName: 'Rudo Chikore',
  nationalId: '63-123456A63',
  gender: 'FEMALE',
  dateOfBirth: '1988-02-01',
  phone: '+263 77 000 0000',
  email: '',
  address: '',
  emergencyContact: { name: '', relationship: '', phone: '' },
  position: 'Teacher',
  department: 'Sciences',
  category: 'TEACHER',
  dateEmployed: '2020-01-10',
  employmentType: 'PERMANENT',
  status: 'ACTIVE',
  salaryScaleId: 'SS-0001',
  bank: { bankName: 'CBZ', accountNumber: '123', branch: 'Harare' },
  createdAt: '',
  updatedAt: '',
}

function version(partial: Partial<SalaryScaleVersion>): SalaryScaleVersion {
  const base = {
    id: 'v',
    scaleId: 'SS-0001',
    version: 1,
    category: 'TEACHER' as const,
    position: 'Teacher',
    grade: 'A',
    basicSalary: 800,
    housingAllowance: 50,
    transportAllowance: 30,
    otherAllowances: 0,
    effectiveDate: '2026-01-01',
    status: 'ACTIVE' as const,
    current: true,
    createdAt: '',
    ...partial,
  }
  return { ...base, grossSalary: grossOf(base) }
}

const noAttendance = { tracked: false, absentDays: 0, lateDays: 0, overridden: false }

function deduction(partial: Partial<PayrollDeduction>): PayrollDeduction {
  return {
    id: 'd1',
    deductionNo: 'DED-0001',
    employeeId: 'e1',
    employeeName: 'Rudo Chikore',
    employeeNumber: 'EMP-0001',
    reason: 'UNAUTHORIZED_ABSENCE',
    percentage: null,
    fixedAmount: null,
    date: '2026-09-10',
    period: '2026-09',
    addedBy: 'u',
    addedByName: 'Admin',
    status: 'PENDING',
    createdAt: '',
    updatedAt: '',
    ...partial,
  }
}

describe('payroll engine', () => {
  it('adds allowances to the basic salary for the gross', () => {
    expect(version({}).grossSalary).toBe(880)
  })

  it('applies percentage deductions to the gross salary', () => {
    expect(deductionAmount({ percentage: 5 }, 800)).toBe(40)
    expect(deductionAmount({ percentage: 5, fixedAmount: 10 }, 800)).toBe(50)
  })

  it('computes net salary from gross minus deductions', () => {
    const item = buildPayrollItem({
      payrollId: '2026-09',
      period: '2026-09',
      employee,
      scale: version({ housingAllowance: 0, transportAllowance: 0 }),
      deductions: [deduction({ percentage: 5 })],
      attendance: noAttendance,
      rules: DEFAULT_ATTENDANCE_RULES,
    })
    expect(item.grossSalary).toBe(800)
    expect(item.deductionsTotal).toBe(40)
    expect(item.netSalary).toBe(760)
  })

  it('uses the scale version in force for the payroll month', () => {
    const versions = [
      version({ id: 'v1', version: 1, effectiveDate: '2026-01-01', basicSalary: 800 }),
      version({ id: 'v2', version: 2, effectiveDate: '2026-09-01', basicSalary: 900 }),
    ]
    expect(resolveScaleVersion(versions, 'SS-0001', '2026-08')?.basicSalary).toBe(800)
    expect(resolveScaleVersion(versions, 'SS-0001', '2026-09')?.basicSalary).toBe(900)
    expect(resolveScaleVersion(versions, 'SS-0001', '2025-12')).toBeNull()
  })

  it('adds attendance deductions only when enabled', () => {
    const args = {
      payrollId: '2026-09',
      period: '2026-09',
      employee,
      scale: version({}),
      deductions: [],
      attendance: { tracked: true, absentDays: 2, lateDays: 3, overridden: false },
    }
    const off = buildPayrollItem({ ...args, rules: DEFAULT_ATTENDANCE_RULES })
    expect(off.deductionsTotal).toBe(0)

    const on = buildPayrollItem({
      ...args,
      rules: { ...DEFAULT_ATTENDANCE_RULES, enabled: true },
    })
    // 2 × 5% of 880 + 3 × 2% of 880
    expect(on.deductionsTotal).toBe(88 + 52.8)
    expect(on.netSalary).toBe(739.2)

    const fixed = buildPayrollItem({
      ...args,
      rules: {
        ...DEFAULT_ATTENDANCE_RULES,
        enabled: true,
        absentDay: { mode: 'FIXED', value: 20 },
        lateComing: { mode: 'FIXED', value: 0 },
        percentBase: 'BASIC',
      },
    })
    expect(fixed.deductionsTotal).toBe(40)
  })

  it('re-prices manual lines when attendance counts are overridden', () => {
    const item = buildPayrollItem({
      payrollId: '2026-09',
      period: '2026-09',
      employee,
      scale: version({}),
      deductions: [deduction({ fixedAmount: 100 })],
      attendance: noAttendance,
      rules: { ...DEFAULT_ATTENDANCE_RULES, enabled: true },
    })
    const next = finalizeItem(
      { ...item, attendance: { tracked: false, absentDays: 1, lateDays: 0, overridden: true } },
      { ...DEFAULT_ATTENDANCE_RULES, enabled: true },
    )
    expect(next.deductions).toHaveLength(2)
    expect(next.deductionsTotal).toBe(144)
  })

  it('never pays a negative net salary', () => {
    const item = buildPayrollItem({
      payrollId: '2026-09',
      period: '2026-09',
      employee,
      scale: version({}),
      deductions: [deduction({ fixedAmount: 2000 })],
      attendance: noAttendance,
      rules: DEFAULT_ATTENDANCE_RULES,
    })
    expect(item.netSalary).toBe(0)
  })

  it('skips resigned, suspended and unscaled employees', () => {
    expect(payrollExclusion(employee, '2026-09')).toBeNull()
    expect(payrollExclusion({ ...employee, status: 'RESIGNED' }, '2026-09')).toBe('Resigned')
    expect(payrollExclusion({ ...employee, salaryScaleId: undefined }, '2026-09')).toMatch(/scale/)
    expect(payrollExclusion({ ...employee, dateEmployed: '2026-10-01' }, '2026-09')).toMatch(/after/)
  })

  it('totals a payroll and issues sequential codes', () => {
    const item = buildPayrollItem({
      payrollId: '2026-09',
      period: '2026-09',
      employee,
      scale: version({}),
      deductions: [],
      attendance: noAttendance,
      rules: DEFAULT_ATTENDANCE_RULES,
    })
    expect(summarizeItems([item, item])).toMatchObject({ employees: 2, gross: 1760, net: 1760 })
    expect(nextCode('EMP', ['EMP-0002', 'EMP-0010', undefined])).toBe('EMP-0011')
    expect(periodEnd('2028-02')).toBe('2028-02-29')
  })
})

describe('finance summary', () => {
  it('combines fee payments, revenue and expenses by month', () => {
    const summary = buildFinanceSummary({
      year: 2026,
      feePayments: [
        { amount: 500, paidAt: '2026-02-03T10:00:00Z', status: 'CONFIRMED' },
        { amount: 200, paidAt: '2026-02-04T10:00:00Z', status: 'REVERSED' },
      ],
      revenues: [
        {
          id: 'r',
          revenueNo: 'REV-0001',
          date: '2026-02-10',
          source: 'DONATION',
          description: '',
          amount: 300,
          createdByName: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
      expenses: [
        {
          id: 'x',
          expenseNo: 'EXP-0001',
          date: '2026-02-28',
          category: 'Salaries',
          description: '',
          quantity: 1,
          unitPrice: 600,
          totalAmount: 600,
          supplier: '',
          paymentMethod: 'BANK_TRANSFER',
          source: 'PAYROLL',
          createdByName: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
      outstandingFees: 1200,
    })
    expect(summary.totals).toMatchObject({
      revenue: 800,
      expenses: 600,
      salaries: 600,
      netBalance: 200,
      outstandingFees: 1200,
    })
    expect(summary.months[1]).toMatchObject({ revenue: 800, expenses: 600, net: 200 })
  })
})
