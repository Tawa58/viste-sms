import { educationBand } from '@/lib/education-levels'
import type { FeeCategory, StudentResidency, TermFeeAmounts } from '@/types'

export const RESIDENCY_OPTIONS: { value: StudentResidency; label: string }[] = [
  { value: 'DAY', label: 'Day scholar' },
  { value: 'BOARDER', label: 'Boarder' },
  { value: 'NON_FORMAL', label: 'Non-formal' },
]

export const FEE_CATEGORIES: { value: FeeCategory; label: string; hint: string }[] = [
  { value: 'BOARDING', label: 'Boarding fee', hint: 'Secondary boarders' },
  { value: 'DAY', label: 'Day scholar fee', hint: 'Secondary day scholars' },
  { value: 'PRIMARY', label: 'Primary learner fee', hint: 'ECD to Grade 7, day or boarding' },
  { value: 'NON_FORMAL', label: 'Non-formal fee', hint: 'Non-formal learners at any level' },
]

export const DEFAULT_TERM_FEES: TermFeeAmounts = {
  BOARDING: 0,
  DAY: 0,
  PRIMARY: 0,
  NON_FORMAL: 0,
}

export function residencyLabel(residency: StudentResidency | undefined | null) {
  return RESIDENCY_OPTIONS.find((o) => o.value === (residency ?? 'DAY'))?.label ?? 'Day scholar'
}

export function feeCategoryLabel(category: FeeCategory | undefined | null) {
  return FEE_CATEGORIES.find((c) => c.value === category)?.label ?? '—'
}

/** Non-formal always wins; ECD–Grade 7 pay the primary fee; secondary pays boarding or day. */
export function feeCategoryFor(
  residency: StudentResidency | undefined | null,
  educationLevelId: string | undefined | null,
): FeeCategory {
  if (residency === 'NON_FORMAL') return 'NON_FORMAL'
  const band = educationBand(educationLevelId)
  if (band === 'ECD' || band === 'PRIMARY') return 'PRIMARY'
  return residency === 'BOARDER' ? 'BOARDING' : 'DAY'
}

export function normalizeTermFees(raw: Partial<TermFeeAmounts> | undefined | null): TermFeeAmounts {
  const out = { ...DEFAULT_TERM_FEES }
  for (const key of Object.keys(out) as FeeCategory[]) {
    const value = Number(raw?.[key])
    out[key] = Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0
  }
  return out
}

/** One term fee invoice per student per term, so re-billing updates instead of duplicating. */
export function termInvoiceId(termId: string, studentId: string) {
  return `inv_${termId}_${studentId}`
}
