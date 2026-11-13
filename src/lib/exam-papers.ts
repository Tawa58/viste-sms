/** Multi-paper and practical marks for mock and end-of-term exams. */

export const EXAM_PAPER_KEYS = ['paper1', 'paper2', 'paper3', 'paper4'] as const
export const EXAM_PRACTICAL_KEY = 'practical' as const

export type ExamComponentKey = (typeof EXAM_PAPER_KEYS)[number] | typeof EXAM_PRACTICAL_KEY

export interface ExamComponent {
  key: ExamComponentKey
  label: string
  maxScore: number
  /** Share of the final mark. Ratios are normalized, so 2:1 and 40:20 match. */
  weight: number
}

export interface MarkComponentScore {
  key: ExamComponentKey
  label: string
  score: number
  maxScore: number
  weight: number
}

export function isExamPaperPeriod(periodType: string) {
  return periodType === 'MOCK' || periodType === 'TERMLY'
}

export function examComponentLabel(key: ExamComponentKey) {
  if (key === EXAM_PRACTICAL_KEY) return 'Practical'
  const index = EXAM_PAPER_KEYS.indexOf(key as (typeof EXAM_PAPER_KEYS)[number])
  return index >= 0 ? `Paper ${index + 1}` : key
}

export function examComponentShortLabel(key: ExamComponentKey) {
  if (key === EXAM_PRACTICAL_KEY) return 'Prac'
  const index = EXAM_PAPER_KEYS.indexOf(key as (typeof EXAM_PAPER_KEYS)[number])
  return index >= 0 ? `P${index + 1}` : key
}

export function defaultExamScheme(maxScore = 100): ExamComponent[] {
  return [{ key: 'paper1', label: 'Paper 1', maxScore, weight: 1 }]
}

export type SchemeResult =
  | { ok: true; components: ExamComponent[] }
  | { ok: false; message: string }

/** Papers must run Paper 1…n without gaps. Practical is optional and last. */
export function normalizeExamScheme(input: ExamComponent[]): SchemeResult {
  if (input.length < 1 || input.length > 5) {
    return { ok: false, message: 'Choose between 1 and 4 papers' }
  }
  const keys = input.map((c) => c.key)
  if (new Set(keys).size !== keys.length) {
    return { ok: false, message: 'Each paper can only be listed once' }
  }
  const papers = input.filter((c) => c.key !== EXAM_PRACTICAL_KEY)
  const practicals = input.filter((c) => c.key === EXAM_PRACTICAL_KEY)
  if (papers.length < 1 || papers.length > 4) {
    return { ok: false, message: 'Choose between 1 and 4 papers' }
  }
  if (practicals.length > 1) {
    return { ok: false, message: 'Only one practical assessment is allowed' }
  }
  for (let i = 0; i < papers.length; i++) {
    if (papers[i]?.key !== EXAM_PAPER_KEYS[i]) {
      return { ok: false, message: 'Number papers from Paper 1 without skipping one' }
    }
  }
  const ordered = [...papers, ...practicals]
  const components: ExamComponent[] = []
  for (const component of ordered) {
    if (!(component.maxScore >= 1 && component.maxScore <= 1000)) {
      return {
        ok: false,
        message: `${examComponentLabel(component.key)} maximum must be between 1 and 1000`,
      }
    }
    if (!(component.weight > 0 && component.weight <= 1000)) {
      return {
        ok: false,
        message: `${examComponentLabel(component.key)} ratio must be greater than 0`,
      }
    }
    components.push({
      key: component.key,
      label: examComponentLabel(component.key),
      maxScore: component.maxScore,
      weight: component.weight,
    })
  }
  return { ok: true, components }
}

export function ratioPercents(components: Pick<ExamComponent, 'weight'>[]) {
  const total = components.reduce((sum, component) => sum + component.weight, 0)
  if (!(total > 0)) return components.map(() => 0)
  return components.map((component) => (component.weight / total) * 100)
}

export function describeExamRatio(components: ExamComponent[]) {
  const ratio = components
    .map((component) =>
      Number.isInteger(component.weight)
        ? String(component.weight)
        : String(Math.round(component.weight * 100) / 100),
    )
    .join(' : ')
  const shares = ratioPercents(components)
  const parts = components.map(
    (component, index) => `${component.label} ${Math.round(shares[index] ?? 0)}%`,
  )
  return `Ratio ${ratio} (${parts.join(' · ')})`
}

export type PaperFinal =
  | { complete: true; invalid: false; percent: number }
  | { complete: false; invalid: false; percent: number }
  | { complete: false; invalid: true; percent: number; message: string }

/** Weighted percentage. Incomplete rows stay unmarked; a mark over the maximum is invalid. */
export function paperFinalPercent(
  scheme: ExamComponent[],
  scores: { key: string; score: number }[],
): PaperFinal {
  const totalWeight = scheme.reduce((sum, component) => sum + component.weight, 0)
  if (!(totalWeight > 0) || scheme.length === 0) {
    return { complete: false, invalid: true, percent: 0, message: 'Set a ratio for each paper' }
  }
  let weighted = 0
  let complete = true
  for (const component of scheme) {
    const found = scores.find((score) => score.key === component.key)
    if (!found || !Number.isFinite(found.score)) {
      complete = false
      continue
    }
    if (found.score < 0 || found.score > component.maxScore) {
      return {
        complete: false,
        invalid: true,
        percent: 0,
        message: `${component.label} cannot exceed ${component.maxScore}`,
      }
    }
    weighted += (found.score / component.maxScore) * component.weight
  }
  const percent = (weighted / totalWeight) * 100
  if (!complete) return { complete: false, invalid: false, percent }
  return { complete: true, invalid: false, percent }
}

export function roundExamPercent(percent: number) {
  return Math.round(percent * 10) / 10
}

export function snapshotPaperMarks(
  scheme: ExamComponent[],
  scores: { key: string; score: number }[],
): MarkComponentScore[] {
  return scheme.map((component) => {
    const found = scores.find((score) => score.key === component.key)
    return {
      key: component.key,
      label: component.label,
      score: found?.score ?? 0,
      maxScore: component.maxScore,
      weight: component.weight,
    }
  })
}

export function formatMarkComponents(
  components: Pick<MarkComponentScore, 'key' | 'label' | 'score' | 'maxScore'>[] | undefined,
) {
  if (!components?.length) return ''
  return components
    .map((component) => {
      const score = Number.isInteger(component.score)
        ? String(component.score)
        : String(Math.round(component.score * 10) / 10)
      const max = Number.isInteger(component.maxScore)
        ? String(component.maxScore)
        : String(component.maxScore)
      return `${examComponentShortLabel(component.key)} ${score}/${max}`
    })
    .join(' · ')
}
