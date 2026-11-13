import { describe, expect, it } from 'vitest'
import {
  autoCommentForGrade,
  DEFAULT_PRIMARY_UNIT_BANDS,
  formatUnitGrade,
  gradeFromScore,
  unitsFromScore,
  validatePrimaryUnitBands,
} from '@/lib/grading'

const unitsScale = {
  scheme: 'UNITS' as const,
  marksPerUnit: 10,
  bands: [{ grade: 'A', minPercent: 80, maxPercent: 100 }],
}

describe('primary units grading', () => {
  it('counts whole units from a mark out of 100', () => {
    expect(unitsFromScore(35, 10)).toBe(3)
    expect(unitsFromScore(20, 10)).toBe(2)
    expect(unitsFromScore(9, 10)).toBe(0)
    expect(formatUnitGrade(1)).toBe('1 unit')
    expect(formatUnitGrade(2)).toBe('2 units')
  })

  it('scales the mark to the maximum before counting units', () => {
    expect(unitsFromScore(9, 10, 10)).toBe(9)
    expect(unitsFromScore(10, 10, 10)).toBe(10)
    expect(gradeFromScore(9, 10, unitsScale)).toBe('9 units')
    expect(gradeFromScore(10, 10, unitsScale)).toBe('10 units')
    expect(autoCommentForGrade(gradeFromScore(9, 10, unitsScale))).toMatch(/Excellent/)
    expect(autoCommentForGrade(gradeFromScore(10, 10, unitsScale))).toMatch(/Excellent/)
    expect(autoCommentForGrade(gradeFromScore(1, 10, unitsScale))).toMatch(/Below expected/)
  })

  it('uses units instead of letter grades when the scale is UNITS', () => {
    expect(gradeFromScore(45, 50, unitsScale)).toBe('9 units')
  })

  it('keeps letter grades for percent-band scales', () => {
    expect(
      gradeFromScore(82, 100, {
        bands: [
          { grade: 'A', minPercent: 80, maxPercent: 100 },
          { grade: 'U', minPercent: 0, maxPercent: 79 },
        ],
      }),
    ).toBe('A')
  })

  it('writes auto comments for unit grades', () => {
    expect(autoCommentForGrade('8 units')).toMatch(/Excellent/)
    expect(autoCommentForGrade('3 units')).toMatch(/Fair/)
  })
})

const primaryUnits = {
  scheme: 'UNITS' as const,
  bands: DEFAULT_PRIMARY_UNIT_BANDS,
}

describe('configurable 1 to 9 unit bands', () => {
  it('turns 9 out of 10 into 9 units and an excellent comment', () => {
    expect(gradeFromScore(9, 10, primaryUnits)).toBe('9 units')
    expect(gradeFromScore(10, 10, primaryUnits)).toBe('9 units')
    expect(autoCommentForGrade(gradeFromScore(9, 10, primaryUnits), primaryUnits.bands)).toMatch(
      /Excellent/,
    )
  })

  it('turns 5 out of 10 into the unit whose range contains 50%', () => {
    expect(gradeFromScore(5, 10, primaryUnits)).toBe('5 units')
    const moved = DEFAULT_PRIMARY_UNIT_BANDS.map((band) => {
      if (band.grade === '4') return { ...band, minPercent: 40, maxPercent: 50 }
      if (band.grade === '5') return { ...band, minPercent: 51, maxPercent: 59 }
      return band
    })
    expect(validatePrimaryUnitBands(moved).ok).toBe(true)
    expect(gradeFromScore(5, 10, { scheme: 'UNITS', bands: moved })).toBe('4 units')
    expect(gradeFromScore(6, 10, { scheme: 'UNITS', bands: moved })).toBe('6 units')
  })

  it('keeps every percentage inside units 1 to 9', () => {
    expect(gradeFromScore(0, 100, primaryUnits)).toBe('1 unit')
    expect(gradeFromScore(9, 100, primaryUnits)).toBe('1 unit')
    expect(gradeFromScore(19, 100, primaryUnits)).toBe('1 unit')
    expect(gradeFromScore(35, 100, primaryUnits)).toBe('3 units')
    expect(gradeFromScore(100, 100, primaryUnits)).toBe('9 units')
  })

  it('uses the comment written on that unit', () => {
    const bands = DEFAULT_PRIMARY_UNIT_BANDS.map((band) =>
      band.grade === '5' ? { ...band, comment: 'Halfway there. Keep revising.' } : band,
    )
    expect(autoCommentForGrade('5 units', bands)).toBe('Halfway there. Keep revising.')
  })

  it('rejects a gap between unit ranges', () => {
    const gapped = DEFAULT_PRIMARY_UNIT_BANDS.map((band) =>
      band.grade === '5' ? { ...band, minPercent: 51 } : band,
    )
    const result = validatePrimaryUnitBands(gapped)
    expect(result.ok).toBe(false)
  })
})
