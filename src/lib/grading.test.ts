import { describe, expect, it } from 'vitest'
import {
  autoCommentForGrade,
  formatUnitGrade,
  gradeFromScore,
  unitsFromScore,
} from '@/lib/grading'

describe('primary units grading', () => {
  it('counts whole units from marksPerUnit', () => {
    expect(unitsFromScore(35, 10)).toBe(3)
    expect(unitsFromScore(20, 10)).toBe(2)
    expect(unitsFromScore(9, 10)).toBe(0)
    expect(formatUnitGrade(1)).toBe('1 unit')
    expect(formatUnitGrade(2)).toBe('2 units')
  })

  it('uses units instead of letter grades when the scale is UNITS', () => {
    expect(
      gradeFromScore(45, 50, {
        scheme: 'UNITS',
        marksPerUnit: 10,
        bands: [{ grade: 'A', minPercent: 80, maxPercent: 100 }],
      }),
    ).toBe('4 units')
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
