import type { GradeBand, GradingScale } from '@/types'

/**
 * Whole units for ECD and primary.
 * The raw mark is first scaled to a percentage of `maxScore`, then divided by
 * how many of those points make one unit. A mark of 9 out of 10 is 90%, which
 * is 9 units when 10 points make 1 unit — not 0 units from the raw 9.
 */
export function unitsFromScore(score: number, marksPerUnit: number, maxScore = 100): number {
  if (!(marksPerUnit > 0)) return 0
  const max = maxScore > 0 ? maxScore : 100
  const normalized = (Math.max(0, score) / max) * 100
  return Math.floor(normalized / marksPerUnit)
}

export function formatUnitGrade(units: number): string {
  return units === 1 ? '1 unit' : `${units} units`
}

export function isUnitsScale(
  scale?: Pick<GradingScale, 'scheme' | 'marksPerUnit'> | null,
): scale is Pick<GradingScale, 'scheme' | 'marksPerUnit'> & { marksPerUnit: number } {
  return scale?.scheme === 'UNITS' && typeof scale.marksPerUnit === 'number' && scale.marksPerUnit > 0
}

/** Default O-Level bands for live mark-entry preview when scales are not loaded yet. */
export const PREVIEW_FORM_1_4_BANDS: GradeBand[] = [
  { grade: 'A', minPercent: 80, maxPercent: 100 },
  { grade: 'B', minPercent: 70, maxPercent: 79 },
  { grade: 'C', minPercent: 60, maxPercent: 69 },
  { grade: 'D', minPercent: 50, maxPercent: 59 },
  { grade: 'E', minPercent: 40, maxPercent: 49 },
  { grade: 'U', minPercent: 0, maxPercent: 39 },
]

export const PREVIEW_FORM_5_6_BANDS: GradeBand[] = [
  { grade: 'A', minPercent: 75, maxPercent: 100 },
  { grade: 'B', minPercent: 65, maxPercent: 74 },
  { grade: 'C', minPercent: 55, maxPercent: 64 },
  { grade: 'D', minPercent: 45, maxPercent: 54 },
  { grade: 'E', minPercent: 35, maxPercent: 44 },
  { grade: 'U', minPercent: 0, maxPercent: 34 },
]

/** Pure grading helper safe for client and server. */
export function gradeFromPercent(percent: number, bands: GradeBand[]): string {
  const p = Math.max(0, Math.min(100, percent))
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent)
  for (const band of sorted) {
    if (p >= band.minPercent && p <= band.maxPercent) return band.grade
  }
  return sorted[sorted.length - 1]?.grade ?? 'U'
}

export function gradeFromScore(
  score: number,
  maxScore: number,
  scale?: Pick<GradingScale, 'bands' | 'scheme' | 'marksPerUnit'> | null,
): string {
  if (isUnitsScale(scale)) {
    return formatUnitGrade(unitsFromScore(score, scale.marksPerUnit, maxScore))
  }
  const max = maxScore > 0 ? maxScore : 100
  const percent = (score / max) * 100
  return gradeFromPercent(percent, scale?.bands?.length ? scale.bands : PREVIEW_FORM_1_4_BANDS)
}

export type CommentMode = 'NONE' | 'AUTO' | 'CUSTOM'

/** Short professional remark derived from letter grade. */
export function autoCommentForGrade(grade: string): string {
  const g = grade.trim().toUpperCase()
  const unitsMatch = g.match(/^(\d+)\s*UNITS?$/)
  if (unitsMatch) {
    const units = Number(unitsMatch[1])
    if (units >= 8) return 'Excellent work. Keep up this outstanding standard.'
    if (units >= 6) return 'Very good performance. Continue to aim higher.'
    if (units >= 4) return 'Satisfactory progress. Focus on consistency and revision.'
    if (units >= 2) return 'Fair effort. Extra practice is needed to improve.'
    return 'Below expected standard. Seek support and revise regularly.'
  }
  switch (g) {
    case 'A':
      return 'Excellent work. Keep up this outstanding standard.'
    case 'B':
      return 'Very good performance. Continue to aim higher.'
    case 'C':
      return 'Satisfactory progress. Focus on consistency and revision.'
    case 'D':
      return 'Fair effort. Extra practice is needed to improve.'
    case 'E':
      return 'Below expected standard. Seek support and revise regularly.'
    case 'U':
      return 'Unsatisfactory. Immediate improvement and remedial work required.'
    default:
      return 'Keep working hard and seek guidance where needed.'
  }
}

export function resolveMarkComment(opts: {
  mode: CommentMode
  grade: string
  customComment?: string
}): string | undefined {
  if (opts.mode === 'NONE') return undefined
  if (opts.mode === 'AUTO') return autoCommentForGrade(opts.grade)
  const custom = opts.customComment?.trim()
  return custom || undefined
}
