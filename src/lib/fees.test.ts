import { describe, expect, it } from 'vitest'
import {
  currentBillingTerm,
  feeAmountFor,
  feeCategoryFor,
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
