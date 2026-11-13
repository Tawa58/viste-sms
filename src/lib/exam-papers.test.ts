import { describe, expect, it } from 'vitest'
import { isFormOneToSixLevel } from '@/lib/education-levels'
import { gradeFromScore } from '@/lib/grading'
import {
  describeExamRatio,
  formatMarkComponents,
  normalizeExamScheme,
  paperFinalPercent,
  roundExamPercent,
  snapshotPaperMarks,
} from '@/lib/exam-papers'

const oLevel = {
  bands: [
    { grade: 'A', minPercent: 75, maxPercent: 100 },
    { grade: 'B', minPercent: 65, maxPercent: 74 },
    { grade: 'C', minPercent: 50, maxPercent: 64 },
    { grade: 'D', minPercent: 40, maxPercent: 49 },
    { grade: 'U', minPercent: 0, maxPercent: 39 },
  ],
}

describe('exam paper scheme', () => {
  it('rejects a gap in the paper numbers', () => {
    const result = normalizeExamScheme([
      { key: 'paper1', label: 'Paper 1', maxScore: 100, weight: 1 },
      { key: 'paper3', label: 'Paper 3', maxScore: 100, weight: 1 },
    ])
    expect(result.ok).toBe(false)
  })

  it('keeps a practical after the written papers', () => {
    const result = normalizeExamScheme([
      { key: 'paper1', label: 'x', maxScore: 40, weight: 2 },
      { key: 'paper2', label: 'y', maxScore: 60, weight: 2 },
      { key: 'practical', label: 'z', maxScore: 20, weight: 1 },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.components.map((c) => c.label)).toEqual(['Paper 1', 'Paper 2', 'Practical'])
    expect(describeExamRatio(result.components)).toBe(
      'Ratio 2 : 2 : 1 (Paper 1 40% · Paper 2 40% · Practical 20%)',
    )
  })
})

describe('final symbol from paper ratios', () => {
  const scheme = normalizeExamScheme([
    { key: 'paper1', label: 'Paper 1', maxScore: 50, weight: 2 },
    { key: 'paper2', label: 'Paper 2', maxScore: 100, weight: 2 },
    { key: 'practical', label: 'Practical', maxScore: 40, weight: 1 },
  ])

  it('weights each paper by its ratio and grades the percentage', () => {
    expect(scheme.ok).toBe(true)
    if (!scheme.ok) return
    const final = paperFinalPercent(scheme.components, [
      { key: 'paper1', score: 40 },
      { key: 'paper2', score: 70 },
      { key: 'practical', score: 30 },
    ])
    expect(final.complete).toBe(true)
    expect(final.invalid).toBe(false)
    // (40/50)*2 + (70/100)*2 + (30/40)*1 = 1.6 + 1.4 + 0.75 = 3.75; / 5 = 75%
    expect(roundExamPercent(final.percent)).toBe(75)
    expect(gradeFromScore(roundExamPercent(final.percent), 100, oLevel)).toBe('A')
    expect(formatMarkComponents(snapshotPaperMarks(scheme.components, [
      { key: 'paper1', score: 40 },
      { key: 'paper2', score: 70 },
      { key: 'practical', score: 30 },
    ]))).toBe('P1 40/50 · P2 70/100 · Prac 30/40')
  })

  it('does not award a symbol until every paper is entered', () => {
    expect(scheme.ok).toBe(true)
    if (!scheme.ok) return
    const final = paperFinalPercent(scheme.components, [
      { key: 'paper1', score: 40 },
      { key: 'paper2', score: 70 },
    ])
    expect(final.complete).toBe(false)
    expect(final.invalid).toBe(false)
  })

  it('rejects a paper mark above its maximum', () => {
    expect(scheme.ok).toBe(true)
    if (!scheme.ok) return
    const final = paperFinalPercent(scheme.components, [
      { key: 'paper1', score: 51 },
      { key: 'paper2', score: 70 },
      { key: 'practical', score: 30 },
    ])
    expect(final.invalid).toBe(true)
    if (!final.invalid) return
    expect(final.message).toMatch(/Paper 1/)
  })

  it('treats one paper as that paper’s percentage', () => {
    const single = normalizeExamScheme([
      { key: 'paper1', label: 'Paper 1', maxScore: 50, weight: 1 },
    ])
    expect(single.ok).toBe(true)
    if (!single.ok) return
    const final = paperFinalPercent(single.components, [{ key: 'paper1', score: 40 }])
    expect(roundExamPercent(final.percent)).toBe(80)
    expect(gradeFromScore(roundExamPercent(final.percent), 100, oLevel)).toBe('A')
  })
})

describe('Form 1 to Form 6 classes', () => {
  it('recognises form class names and leaves ECD and primary out', () => {
    expect(isFormOneToSixLevel('form-1')).toBe(true)
    expect(isFormOneToSixLevel('Form 4A')).toBe(true)
    expect(isFormOneToSixLevel('Form 5 ARTS')).toBe(true)
    expect(isFormOneToSixLevel('form-6')).toBe(true)
    expect(isFormOneToSixLevel('ECD A')).toBe(false)
    expect(isFormOneToSixLevel('Grade 7')).toBe(false)
  })
})
