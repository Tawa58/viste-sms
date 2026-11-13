import type { GradeBand, GradingScale } from '@/types'

/**
 * Whole units from a single step size.
 * Kept for scales that have not been given explicit 1–9 bands. A mark is scaled
 * to a percentage of `maxScore` first, so 9 out of 10 is 90%, not 9%.
 */
export function unitsFromScore(score: number, marksPerUnit: number, maxScore = 100): number {
  if (!(marksPerUnit > 0)) return 0
  const max = maxScore > 0 ? maxScore : 100
  const normalized = (Math.max(0, score) / max) * 100
  return Math.floor(normalized / marksPerUnit)
}

/** Nearest whole percentage of the test maximum, clamped to 0–100. */
export function wholePercent(score: number, maxScore: number): number {
  const max = maxScore > 0 ? maxScore : 100
  const raw = (Math.max(0, score) / max) * 100
  return Math.max(0, Math.min(100, Math.round(raw)))
}

function countedUnits(grade: string | undefined | null): number | null {
  const match = grade?.trim().match(/^(\d+)\s*(?:units?)?$/i)
  if (!match) return null
  const unit = Number(match[1])
  return Number.isFinite(unit) ? unit : null
}

/** Unit number from "9", "9 units", or "9 unit". Only 1–9 count as a primary band. */
export function unitNumberFromLabel(grade: string | undefined | null): number | null {
  const unit = countedUnits(grade)
  return unit != null && unit >= 1 && unit <= 9 ? unit : null
}

export function defaultCommentForUnit(unit: number): string {
  if (unit >= 8) return 'Excellent work. Keep up this outstanding standard.'
  if (unit >= 6) return 'Very good performance. Continue to aim higher.'
  if (unit >= 4) return 'Satisfactory progress. Focus on consistency and revision.'
  if (unit >= 2) return 'Fair effort. Extra practice is needed to improve.'
  return 'Below expected standard. Seek support and revise regularly.'
}

/**
 * Grades 1–7 default: nine units, highest first.
 * 90–100% is 9 units. 0–19% is 1 unit, so the scale never awards 0 or 10.
 */
export const DEFAULT_PRIMARY_UNIT_BANDS: GradeBand[] = [9, 8, 7, 6, 5, 4, 3, 2, 1].map((unit) => ({
  grade: String(unit),
  minPercent: unit === 1 ? 0 : unit * 10,
  maxPercent: unit === 9 ? 100 : unit * 10 + 9,
  comment: defaultCommentForUnit(unit),
}))

export function isPrimaryUnitBands(bands: GradeBand[] | undefined | null): boolean {
  if (!bands || bands.length !== 9) return false
  const units = bands.map((band) => unitNumberFromLabel(band.grade))
  return units.every((unit) => unit != null) && new Set(units).size === 9
}

export type UnitBandCheck =
  | { ok: true; bands: GradeBand[] }
  | { ok: false; message: string }

/** Grades 1–7 units must be 1 through 9, covering every whole percent from 0 to 100 once. */
export function validatePrimaryUnitBands(bands: GradeBand[]): UnitBandCheck {
  if (bands.length !== 9) {
    return { ok: false, message: 'Grades 1–7 need one band for each unit from 1 to 9' }
  }
  const parsed: { unit: number; minPercent: number; maxPercent: number; comment?: string }[] = []
  for (const band of bands) {
    const unit = unitNumberFromLabel(band.grade)
    if (unit == null) {
      return { ok: false, message: 'Each band must be a unit from 1 to 9' }
    }
    if (!Number.isInteger(band.minPercent) || !Number.isInteger(band.maxPercent)) {
      return { ok: false, message: 'Unit ranges use whole percentages' }
    }
    if (band.minPercent < 0 || band.maxPercent > 100 || band.minPercent > band.maxPercent) {
      return {
        ok: false,
        message: `Unit ${unit} must run from a lower percentage to a higher one, inside 0–100`,
      }
    }
    const comment = band.comment?.trim()
    if (comment && comment.length > 300) {
      return { ok: false, message: `Unit ${unit} comment must be 300 characters or fewer` }
    }
    parsed.push({
      unit,
      minPercent: band.minPercent,
      maxPercent: band.maxPercent,
      comment: comment || undefined,
    })
  }
  if (new Set(parsed.map((band) => band.unit)).size !== 9) {
    return { ok: false, message: 'Include each unit from 1 to 9 once' }
  }
  const ordered = [...parsed].sort((a, b) => a.minPercent - b.minPercent)
  if (ordered[0]?.minPercent !== 0 || ordered[ordered.length - 1]?.maxPercent !== 100) {
    return { ok: false, message: 'The unit bands must start at 0% and finish at 100%' }
  }
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const current = ordered[i]
    const next = ordered[i + 1]
    if (!current || !next) continue
    if (current.maxPercent + 1 !== next.minPercent) {
      return {
        ok: false,
        message: `Unit ${current.unit} ends at ${current.maxPercent}% and the next band starts at ${next.minPercent}%. Make the ranges meet, with no gap or overlap.`,
      }
    }
  }
  return {
    ok: true,
    bands: [...parsed]
      .sort((a, b) => b.unit - a.unit)
      .map((band) => ({
        grade: String(band.unit),
        minPercent: band.minPercent,
        maxPercent: band.maxPercent,
        ...(band.comment ? { comment: band.comment } : {}),
      })),
  }
}

/** Map a whole percentage onto the 1–9 bands. Scores outside every band use the nearest unit. */
export function unitFromPercent(percent: number, bands: GradeBand[]): number {
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  const usable = bands
    .map((band) => ({ band, unit: unitNumberFromLabel(band.grade) }))
    .filter((row): row is { band: GradeBand; unit: number } => row.unit != null)
    .sort((a, b) => b.band.minPercent - a.band.minPercent)
  for (const row of usable) {
    if (p >= row.band.minPercent && p <= row.band.maxPercent) return row.unit
  }
  const above = usable.find((row) => p > row.band.maxPercent)
  if (above) return above.unit
  return usable[usable.length - 1]?.unit ?? 1
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
  if (scale?.scheme === 'UNITS' && isPrimaryUnitBands(scale.bands)) {
    return formatUnitGrade(unitFromPercent(wholePercent(score, maxScore), scale.bands))
  }
  if (isUnitsScale(scale)) {
    return formatUnitGrade(unitsFromScore(score, scale.marksPerUnit, maxScore))
  }
  const max = maxScore > 0 ? maxScore : 100
  const percent = (score / max) * 100
  return gradeFromPercent(percent, scale?.bands?.length ? scale.bands : PREVIEW_FORM_1_4_BANDS)
}

export type CommentMode = 'NONE' | 'AUTO' | 'CUSTOM'

/** Remark for a grade. A band comment set by the school replaces the default line. */
export function autoCommentForGrade(grade: string, bands?: GradeBand[]): string {
  const g = grade.trim().toUpperCase()
  const unit = unitNumberFromLabel(grade)
  if (bands?.length) {
    const band = bands.find((row) => {
      if (unit != null && unitNumberFromLabel(row.grade) === unit) return true
      return row.grade.trim().toUpperCase() === g
    })
    if (band?.comment?.trim()) return band.comment.trim()
  }
  const counted = countedUnits(grade)
  if (counted != null) return defaultCommentForUnit(counted)
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
  bands?: GradeBand[]
}): string | undefined {
  if (opts.mode === 'NONE') return undefined
  if (opts.mode === 'AUTO') return autoCommentForGrade(opts.grade, opts.bands)
  const custom = opts.customComment?.trim()
  return custom || undefined
}
