import { describe, expect, it } from 'vitest'
import { feeCategoryFor, normalizeTermFees, termInvoiceId } from '@/lib/fees'

describe('feeCategoryFor', () => {
  it('bills non-formal learners the non-formal fee at any level', () => {
    expect(feeCategoryFor('NON_FORMAL', 'grade-3')).toBe('NON_FORMAL')
    expect(feeCategoryFor('NON_FORMAL', 'form-2')).toBe('NON_FORMAL')
  })

  it('bills ECD and primary learners the primary fee, day or boarder', () => {
    expect(feeCategoryFor('DAY', 'ecd')).toBe('PRIMARY')
    expect(feeCategoryFor('BOARDER', 'grade-7')).toBe('PRIMARY')
  })

  it('bills secondary learners by residency, defaulting to day', () => {
    expect(feeCategoryFor('BOARDER', 'form-4')).toBe('BOARDING')
    expect(feeCategoryFor('DAY', 'form-1')).toBe('DAY')
    expect(feeCategoryFor(undefined, 'form-6')).toBe('DAY')
  })
})

describe('normalizeTermFees', () => {
  it('fills missing amounts with zero and rounds to cents', () => {
    expect(normalizeTermFees({ BOARDING: 350.456, DAY: -5 })).toEqual({
      BOARDING: 350.46,
      DAY: 0,
      PRIMARY: 0,
      NON_FORMAL: 0,
    })
  })
})

describe('termInvoiceId', () => {
  it('is stable per student and term', () => {
    expect(termInvoiceId('term-2026-1', 'stu_1')).toBe('inv_term-2026-1_stu_1')
  })
})
