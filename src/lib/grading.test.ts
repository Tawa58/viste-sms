import { describe, expect, it } from 'vitest'
import {
  autoCommentForGrade,
  formatUnitGrade,
  gradeFromScore,
  unitsFromScore,
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
