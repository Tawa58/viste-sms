import { describe, expect, it } from 'vitest'
import { gradingTrackForLevel } from '@/lib/education-levels'

describe('gradingTrackForLevel', () => {
  it('uses the ECD scale for ECD', () => {
    expect(gradingTrackForLevel('ecd')).toBe('ECD')
  })

  it('uses the primary scale for Grades 1 through 7', () => {
    for (let grade = 1; grade <= 7; grade += 1) {
      expect(gradingTrackForLevel(`grade-${grade}`)).toBe('PRIMARY')
      expect(gradingTrackForLevel(`Grade ${grade}`)).toBe('PRIMARY')
    }
  })

  it('preserves the existing secondary grading tracks', () => {
    expect(gradingTrackForLevel('form-4')).toBe('FORM_1_4')
    expect(gradingTrackForLevel('form-5')).toBe('FORM_5_6')
  })
})
