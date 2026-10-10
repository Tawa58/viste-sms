import { describe, expect, it } from 'vitest'
import {
  currentBillingTerm,
  balanceForBillingPeriod,
  allocateMonthlyPayment,
  feeAmountFor,
  feeCategoryFor,
  invoicesForBillingPeriod,
  invoiceBalance,
  invoiceBlocksPortal,
  monthlyInstalments,
  monthlyInvoiceId,
  normalizeFeeSchedule,
  normalizeMonthsPerTerm,
  scholarshipAdjustedFeeAmount,
  termInvoiceId,
} from '@/lib/fees'

describe('currentBillingTerm', () => {
  const terms = [
    { id: 'term-1', startDate: '2026-01-01', endDate: '2026-03-31' },
    { id: 'term-2', startDate: '2026-05-01', endDate: '2026-08-31' },
    { id: 'term-3', startDate: '2026-09-01', endDate: '2026-12-31' },
  ]

  it('selects the term containing today', () => {
    expect(currentBillingTerm(terms, '2026-06-15')?.id).toBe('term-2')
  })

  it('selects the next term during a break', () => {
    expect(currentBillingTerm(terms, '2026-04-15')?.id).toBe('term-2')
  })

  it('falls back to the latest term after the calendar ends', () => {
    expect(currentBillingTerm(terms, '2027-01-01')?.id).toBe('term-3')
  })

  it('returns no term when the calendar is empty', () => {
    expect(currentBillingTerm([], '2026-01-01')).toBeUndefined()
  })
})

describe('invoicesForBillingPeriod', () => {
  const invoices = [
    { id: 'current-term', termId: 'term-2', plan: 'TERMLY' as const },
    { id: 'current-month', termId: 'term-2', plan: 'MONTHLY' as const, period: 'June 2026' },
    { id: 'next-month', termId: 'term-2', plan: 'MONTHLY' as const, period: 'July 2026' },
    { id: 'past-term', termId: 'term-1', plan: 'TERMLY' as const },
    { id: 'legacy', plan: 'TERMLY' as const },
  ]

  it('includes current-term billing and only the current monthly invoice', () => {
    expect(invoicesForBillingPeriod(invoices, 'term-2', 'June 2026').map((row) => row.id)).toEqual([
      'current-term',
      'current-month',
    ])
  })

  it('does not treat invoices from another term or without a term as current debt', () => {
    expect(invoicesForBillingPeriod(invoices, 'term-3', 'June 2026')).toEqual([])
    expect(invoicesForBillingPeriod(invoices, undefined, 'June 2026')).toEqual([])
  })

  it('includes all monthly invoices when reviewing a past term', () => {
    expect(invoicesForBillingPeriod(invoices, 'term-2', null).map((row) => row.id)).toEqual([
      'current-term',
      'current-month',
      'next-month',
    ])
  })

  it('reports the remainder for one term without adding another term invoice', () => {
    expect(
      balanceForBillingPeriod(
        [
          { termId: 'term-2', plan: 'TERMLY' as const, total: 456, paid: 300 },
          { termId: 'term-1', plan: 'TERMLY' as const, total: 684, paid: 0 },
        ],
        'term-2',
        'June 2026',
      ),
    ).toBe(156)
  })

  it('deducts scholarship credit from the remaining invoice balance', () => {
    expect(invoiceBalance({ total: 456, paid: 300, scholarshipAmount: 100 })).toBe(56)
    expect(invoiceBalance({ total: 456, paid: 0, scholarshipAmount: 456 })).toBe(0)
  })

  it('allocates monthly payments from the selected month forward within its term', () => {
    const invoices = [
      { id: 'oct', termId: 'term-2', plan: 'MONTHLY' as const, dueDate: '2026-10-01', total: 45, paid: 0 },
      { id: 'sep', termId: 'term-2', plan: 'MONTHLY' as const, dueDate: '2026-09-01', total: 45, paid: 0 },
      { id: 'nov', termId: 'term-2', plan: 'MONTHLY' as const, dueDate: '2026-11-01', total: 45, paid: 0 },
      { id: 'dec', termId: 'term-3', plan: 'MONTHLY' as const, dueDate: '2026-12-01', total: 45, paid: 0 },
    ]

    expect(allocateMonthlyPayment(invoices, 'sep', 90)).toEqual([
      { invoiceId: 'sep', amount: 45 },
      { invoiceId: 'oct', amount: 45 },
    ])
  })
})

describe('feeCategoryFor', () => {
  it('bills non-formal learners the non-formal fee at any level', () => {
    expect(feeCategoryFor('NON_FORMAL', 'grade-3')).toBe('NON_FORMAL')
    expect(feeCategoryFor('NON_FORMAL', 'form-2')).toBe('NON_FORMAL')
  })

  it('splits ECD and primary learners into day scholars and boarders', () => {
    expect(feeCategoryFor('DAY', 'ecd')).toBe('ECD_DAY')
    expect(feeCategoryFor('BOARDER', 'ecd')).toBe('ECD_BOARDER')
    expect(feeCategoryFor('DAY', 'grade-1')).toBe('PRIMARY_DAY')
    expect(feeCategoryFor('BOARDER', 'grade-7')).toBe('PRIMARY_BOARDER')
  })

  it('separates Form 1–4 from Form 5–6, defaulting to day scholar', () => {
    expect(feeCategoryFor('BOARDER', 'form-4')).toBe('O_LEVEL_BOARDER')
    expect(feeCategoryFor('DAY', 'form-1')).toBe('O_LEVEL_DAY')
    expect(feeCategoryFor('BOARDER', 'form-5')).toBe('A_LEVEL_BOARDER')
    expect(feeCategoryFor(undefined, 'form-6')).toBe('A_LEVEL_DAY')
  })
})

describe('normalizeFeeSchedule', () => {
  it('fills missing amounts with zero and rounds to cents', () => {
    const schedule = normalizeFeeSchedule({ ECD_DAY: { termly: 120.456, monthly: -5 } })
    expect(schedule.ECD_DAY).toEqual({ termly: 120.46, monthly: 0 })
    expect(schedule.A_LEVEL_BOARDER).toEqual({ termly: 0, monthly: 0 })
  })

  it('carries old term fees over as termly amounts', () => {
    const schedule = normalizeFeeSchedule(undefined, {
      BOARDING: 600,
      DAY: 300,
      PRIMARY: 200,
      NON_FORMAL: 90,
    })
    expect(schedule.ECD_BOARDER.termly).toBe(200)
    expect(schedule.PRIMARY_DAY.termly).toBe(200)
    expect(schedule.O_LEVEL_BOARDER.termly).toBe(600)
    expect(schedule.A_LEVEL_DAY.termly).toBe(300)
    expect(schedule.NON_FORMAL).toEqual({ termly: 90, monthly: 0 })
  })
})

describe('feeAmountFor', () => {
  it('picks the amount for the payment plan', () => {
    const schedule = normalizeFeeSchedule({ PRIMARY_DAY: { termly: 300, monthly: 110 } })
    expect(feeAmountFor(schedule, 'PRIMARY_DAY', 'TERMLY')).toBe(300)
    expect(feeAmountFor(schedule, 'PRIMARY_DAY', 'MONTHLY')).toBe(110)
  })
})

describe('scholarshipAdjustedFeeAmount', () => {
  it('applies the grant percentage for the covered invoice period', () => {
    expect(
      scholarshipAdjustedFeeAmount(300, '2027-01-01', '2027-01-31', [
        { startDate: '2027-01-01', endDate: '2027-01-31', feeCoveragePercent: 50 },
      ]),
    ).toBe(150)
  })

  it('prorates a scholarship by the dates it overlaps the billing period', () => {
    expect(
      scholarshipAdjustedFeeAmount(310, '2027-01-01', '2027-01-31', [
        { startDate: '2027-01-17', endDate: '2027-01-31', feeCoveragePercent: 100 },
      ]),
    ).toBe(160)
  })

  it('caps overlapping grants at full fee coverage and ignores out-of-period grants', () => {
    expect(
      scholarshipAdjustedFeeAmount(100, '2027-01-01', '2027-01-31', [
        { startDate: '2027-01-01', feeCoveragePercent: 70 },
        { startDate: '2027-01-01', feeCoveragePercent: 60 },
        { startDate: '2026-12-01', endDate: '2026-12-31', feeCoveragePercent: 100 },
      ]),
    ).toBe(0)
  })

  it('applies a term-assigned grant only to the selected term', () => {
    const grant = {
      termId: 'term-2',
      startDate: '2026-05-01',
      endDate: '2026-08-31',
      feeCoveragePercent: 100,
    }

    expect(
      scholarshipAdjustedFeeAmount(456, '2026-05-01', '2026-08-31', [grant], 'term-2'),
    ).toBe(0)
    expect(
      scholarshipAdjustedFeeAmount(456, '2026-01-01', '2026-03-31', [grant], 'term-1'),
    ).toBe(456)
  })
})

describe('invoiceBlocksPortal', () => {
  it('does not block a portal code for a future monthly instalment', () => {
    expect(
      invoiceBlocksPortal(
        { dueDate: '2026-11-14', plan: 'MONTHLY', period: 'November 2026' },
        '2026-10-04',
      ),
    ).toBe(false)
  })

  it('still requires the current monthly instalment to be paid', () => {
    expect(
      invoiceBlocksPortal(
        { dueDate: '2026-10-14', plan: 'MONTHLY', period: 'October 2026' },
        '2026-10-04',
      ),
    ).toBe(true)
  })

  it('blocks portal access for an unpaid invoice that is due', () => {
    expect(invoiceBlocksPortal({ dueDate: '2026-10-01', plan: 'TERMLY' }, '2026-10-04')).toBe(
      true,
    )
    expect(invoiceBlocksPortal({ dueDate: '2026-11-01', plan: 'TERMLY' }, '2026-10-04')).toBe(
      false,
    )
  })
})

describe('monthlyInstalments', () => {
  it('raises one invoice per month from the term start', () => {
    const months = monthlyInstalments('2027-01-31', 3, 7)
    expect(months.map((m) => m.issueDate)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
    expect(months[1]).toMatchObject({ instalment: 2, dueDate: '2027-03-07', period: 'February 2027' })
  })

  it('keeps months per term between 1 and 6', () => {
    expect(normalizeMonthsPerTerm(0)).toBe(3)
    expect(normalizeMonthsPerTerm(9)).toBe(6)
    expect(normalizeMonthsPerTerm('4')).toBe(4)
  })
})

describe('invoice ids', () => {
  it('are stable per student, term and month', () => {
    expect(termInvoiceId('term-2026-1', 'stu_1')).toBe('inv_term-2026-1_stu_1')
    expect(monthlyInvoiceId('term-2026-1', 'stu_1', 2)).toBe('inv_term-2026-1_stu_1_m2')
  })
})
