import { educationBand } from '@/lib/education-levels'
import type {
  FeeAmounts,
  FeeCategory,
  FeeLevel,
  FeeSchedule,
  LegacyFeeCategory,
  PaymentPlan,
  StudentScholarship,
  StudentResidency,
  Term,
} from '@/types'

export const RESIDENCY_OPTIONS: { value: StudentResidency; label: string }[] = [
  { value: 'DAY', label: 'Day scholar' },
  { value: 'BOARDER', label: 'Boarder' },
  { value: 'NON_FORMAL', label: 'Non-formal' },
]

export const PAYMENT_PLANS: { value: PaymentPlan; label: string; hint: string }[] = [
  { value: 'TERMLY', label: 'Termly', hint: 'One invoice per term' },
  { value: 'MONTHLY', label: 'Monthly', hint: 'One invoice per month of the term' },
]

export const FEE_LEVELS: { value: FeeLevel; label: string; classes: string }[] = [
  { value: 'ECD', label: 'ECD', classes: 'ECD A and ECD B' },
  { value: 'PRIMARY', label: 'Primary', classes: 'Grade 1 – 7' },
  { value: 'O_LEVEL', label: 'Secondary', classes: 'Form 1 – 4' },
  { value: 'A_LEVEL', label: 'A-Level', classes: 'Form 5 – 6' },
]

export type FeeCategoryOption = {
  value: FeeCategory
  /** e.g. "Secondary Boarder (Form 1 – 4)". */
  label: string
  /** e.g. "Boarder" — used under a level heading. */
  short: string
  level: FeeLevel | null
}

export const FEE_CATEGORIES: FeeCategoryOption[] = [
  ...FEE_LEVELS.flatMap((level) =>
    (['DAY', 'BOARDER'] as const).map((residency) => {
      const short = residency === 'DAY' ? 'Day Scholar' : 'Boarder'
      return {
        value: `${level.value}_${residency}` as FeeCategory,
        label: `${level.label} ${short} (${level.classes})`,
        short,
        level: level.value,
      }
    }),
  ),
  { value: 'NON_FORMAL', label: 'Non-formal learner', short: 'Non-formal', level: null },
]

const LEGACY_CATEGORY_LABELS: Record<LegacyFeeCategory, string> = {
  BOARDING: 'Boarding fee',
  DAY: 'Day scholar fee',
  PRIMARY: 'Primary learner fee',
}

export const DEFAULT_MONTHS_PER_TERM = 3

export const DEFAULT_FEE_SCHEDULE: FeeSchedule = Object.fromEntries(
  FEE_CATEGORIES.map((c) => [c.value, { termly: 0, monthly: 0 }]),
) as FeeSchedule

export function residencyLabel(residency: StudentResidency | undefined | null) {
  return RESIDENCY_OPTIONS.find((o) => o.value === (residency ?? 'DAY'))?.label ?? 'Day scholar'
}

export function paymentPlanLabel(plan: PaymentPlan | undefined | null) {
  return plan === 'MONTHLY' ? 'Monthly' : 'Termly'
}

/** Match invoice billing: the active term, otherwise the next upcoming term, otherwise the latest term. */
export function currentBillingTerm<T extends Pick<Term, 'id' | 'startDate' | 'endDate'>>(
  terms: T[],
  today = new Date().toISOString().slice(0, 10),
) {
  const ordered = [...terms].sort((a, b) => a.startDate.localeCompare(b.startDate))
  return (
    ordered.find((term) => term.startDate <= today && today <= term.endDate) ??
    ordered.find((term) => term.startDate > today) ??
    ordered[ordered.length - 1]
  )
}

export function currentMonthPeriod(date = new Date()) {
  return date.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Invoices that make up the current payable balance, excluding other terms and months. */
export function invoicesForBillingPeriod<T extends Pick<
  import('@/types').Invoice,
  'termId' | 'plan' | 'period'
>>(
  invoices: T[],
  termId: string | undefined,
  month: string | null = currentMonthPeriod(),
): T[] {
  if (!termId) return []
  return invoices.filter(
    (invoice) =>
      invoice.termId === termId &&
      (invoice.plan !== 'MONTHLY' || month === null || invoice.period === month),
  )
}

export function balanceForBillingPeriod(
  invoices: Pick<
    import('@/types').Invoice,
    'termId' | 'plan' | 'period' | 'total' | 'paid' | 'scholarshipAmount'
  >[],
  termId: string | undefined,
  month: string | null = currentMonthPeriod(),
) {
  return invoicesForBillingPeriod(invoices, termId, month).reduce(
    (balance, invoice) => balance + invoiceBalance(invoice),
    0,
  )
}

export function invoiceBalance(
  invoice: Pick<import('@/types').Invoice, 'total' | 'paid' | 'scholarshipAmount'>,
) {
  return Math.max(
    0,
    Math.round((invoice.total - invoice.paid - (invoice.scholarshipAmount ?? 0)) * 100) / 100,
  )
}

export function allocateMonthlyPayment(
  invoices: Pick<
    import('@/types').Invoice,
    'id' | 'termId' | 'plan' | 'dueDate' | 'total' | 'paid' | 'scholarshipAmount'
  >[],
  startInvoiceId: string,
  amount: number,
) {
  const ordered = invoices
    .filter((invoice) => invoice.plan === 'MONTHLY')
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id))
  const startIndex = ordered.findIndex((invoice) => invoice.id === startInvoiceId)
  if (startIndex < 0 || !(amount > 0)) return []

  const termId = ordered[startIndex]!.termId
  let remaining = Math.round(amount * 100) / 100
  const allocations: { invoiceId: string; amount: number }[] = []
  for (const invoice of ordered.slice(startIndex)) {
    if (invoice.termId !== termId || remaining <= 0) break
    const balance = invoiceBalance(invoice)
    const allocated = Math.min(balance, remaining)
    if (allocated <= 0) continue
    allocations.push({
      invoiceId: invoice.id,
      amount: Math.round(allocated * 100) / 100,
    })
    remaining = Math.round((remaining - allocated) * 100) / 100
  }
  return allocations
}

export function feeCategoryLabel(category: FeeCategory | LegacyFeeCategory | undefined | null) {
  if (!category) return '—'
  return (
    FEE_CATEGORIES.find((c) => c.value === category)?.label ??
    LEGACY_CATEGORY_LABELS[category as LegacyFeeCategory] ??
    '—'
  )
}

/** ECD; Grade 1–7; Form 5–6; anything else (Form 1–4 or unknown) is Form 1–4. */
export function feeLevelFor(educationLevelId: string | undefined | null): FeeLevel {
  const band = educationBand(educationLevelId)
  if (band === 'ECD') return 'ECD'
  if (band === 'PRIMARY') return 'PRIMARY'
  if (educationLevelId === 'form-5' || educationLevelId === 'form-6') return 'A_LEVEL'
  return 'O_LEVEL'
}

/** Non-formal always wins; otherwise the student's level and day scholar / boarder status. */
export function feeCategoryFor(
  residency: StudentResidency | undefined | null,
  educationLevelId: string | undefined | null,
): FeeCategory {
  if (residency === 'NON_FORMAL') return 'NON_FORMAL'
  const level = feeLevelFor(educationLevelId)
  return `${level}_${residency === 'BOARDER' ? 'BOARDER' : 'DAY'}` as FeeCategory
}

function money(value: unknown) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0
}

/**
 * Clean stored amounts. Policies saved before the level split only have `termFees`
 * (BOARDING / DAY / PRIMARY / NON_FORMAL); those carry over as the termly amounts.
 */
export function normalizeFeeSchedule(
  raw: Partial<Record<FeeCategory, Partial<FeeAmounts>>> | undefined | null,
  legacyTermFees?: Partial<Record<LegacyFeeCategory | 'NON_FORMAL', number>> | null,
): FeeSchedule {
  const out = {} as FeeSchedule
  for (const { value } of FEE_CATEGORIES) {
    out[value] = { termly: money(raw?.[value]?.termly), monthly: money(raw?.[value]?.monthly) }
  }
  if (!raw && legacyTermFees) {
    const legacy: Record<FeeCategory, unknown> = {
      ECD_DAY: legacyTermFees.PRIMARY,
      ECD_BOARDER: legacyTermFees.PRIMARY,
      PRIMARY_DAY: legacyTermFees.PRIMARY,
      PRIMARY_BOARDER: legacyTermFees.PRIMARY,
      O_LEVEL_DAY: legacyTermFees.DAY,
      O_LEVEL_BOARDER: legacyTermFees.BOARDING,
      A_LEVEL_DAY: legacyTermFees.DAY,
      A_LEVEL_BOARDER: legacyTermFees.BOARDING,
      NON_FORMAL: legacyTermFees.NON_FORMAL,
    }
    for (const key of Object.keys(out) as FeeCategory[]) out[key].termly = money(legacy[key])
  }
  return out
}

export function normalizeMonthsPerTerm(value: unknown) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n >= 1 ? Math.min(6, n) : DEFAULT_MONTHS_PER_TERM
}

export function feeAmountFor(schedule: FeeSchedule, category: FeeCategory, plan: PaymentPlan) {
  const amounts = schedule[category]
  return (plan === 'MONTHLY' ? amounts?.monthly : amounts?.termly) ?? 0
}

export function scholarshipAdjustedFeeAmount(
  amount: number,
  periodStart: string,
  periodEnd: string,
  scholarships: Pick<
    StudentScholarship,
    'startDate' | 'endDate' | 'feeCoveragePercent' | 'termId'
  >[],
  termId?: string,
) {
  if (amount <= 0 || scholarships.length === 0) return amount
  const start = new Date(`${periodStart.slice(0, 10)}T00:00:00Z`)
  const end = new Date(`${periodEnd.slice(0, 10)}T00:00:00Z`)
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1
  if (days <= 0) return amount
  let coveredPercentDays = 0
  for (let day = start.getTime(); day <= end.getTime(); day += 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10)
    const coverage = scholarships
      .filter((grant) =>
        grant.termId
          ? grant.termId === termId &&
            grant.startDate <= date &&
            (!grant.endDate || grant.endDate >= date)
          : grant.startDate <= date && (!grant.endDate || grant.endDate >= date),
      )
      .reduce((total, grant) => total + grant.feeCoveragePercent, 0)
    coveredPercentDays += Math.min(100, coverage)
  }
  return Math.round(amount * (1 - coveredPercentDays / (days * 100)) * 100) / 100
}

/** Future monthly instalments don't block access; current instalments and due invoices do. */
export function invoiceBlocksPortal(
  invoice: { dueDate: string; plan?: PaymentPlan; period?: string },
  today = new Date().toISOString().slice(0, 10),
) {
  if (invoice.plan === 'MONTHLY' && invoice.period) {
    const invoiceMonth = Date.parse(`1 ${invoice.period} UTC`)
    const [year, month] = today.slice(0, 7).split('-').map(Number)
    const currentMonth = Date.UTC(year!, month! - 1, 1)
    if (Number.isFinite(invoiceMonth)) return invoiceMonth <= currentMonth
  }
  return invoice.dueDate <= today
}

export function hasAnyFee(schedule: FeeSchedule | undefined | null) {
  return schedule ? Object.values(schedule).some((a) => a.termly > 0 || a.monthly > 0) : false
}

/** One term fee invoice per student per term, so re-billing updates instead of duplicating. */
export function termInvoiceId(termId: string, studentId: string) {
  return `inv_${termId}_${studentId}`
}

export function monthlyInvoiceId(termId: string, studentId: string, instalment: number) {
  return `inv_${termId}_${studentId}_m${instalment}`
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

function addMonths(isoStart: string, months: number) {
  const start = new Date(`${isoStart.slice(0, 10)}T00:00:00Z`)
  const day = start.getUTCDate()
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return isoDate(d)
}

function addDays(isoStart: string, days: number) {
  const d = new Date(`${isoStart.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return isoDate(d)
}

export type MonthlyInstalment = {
  instalment: number
  /** When the invoice is raised: the term start, then the same day each following month. */
  issueDate: string
  dueDate: string
  /** e.g. "February 2027". */
  period: string
}

export function monthlyInstalments(
  termStartDate: string,
  monthsPerTerm: number,
  graceDays: number,
): MonthlyInstalment[] {
  return Array.from({ length: normalizeMonthsPerTerm(monthsPerTerm) }, (_, i) => {
    const issueDate = addMonths(termStartDate, i)
    return {
      instalment: i + 1,
      issueDate,
      dueDate: addDays(issueDate, graceDays),
      period: new Date(`${issueDate}T00:00:00Z`).toLocaleDateString('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }),
    }
  })
}
