import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadingState } from '@/components/shared/loading-state'
import { PageHeader } from '@/components/shared/page-header'
import { Badge } from '@/components/ui/badge'
import { useStudentPortal } from '@/contexts/student-portal-context'
import { cn } from '@/lib/utils'
import type { AttendanceStatus, ResultPortalView, StudentPortalBundle } from '@/types'

export type ResultRow = { subject: string; pct: number; score: number; maxScore: number; grade: string; comment?: string }

/** The most recent published result set (latest monthly test, else latest term, else loose marks). */
export function latestResults(results: ResultPortalView): { label: string; rows: ResultRow[]; average?: number } | null {
  if (results.accessState !== 'RESULTS_AVAILABLE') return null
  const block = results.monthly?.[0] ?? null
  const term = results.termly?.[0] ?? null
  const source = block
    ? { label: block.label, rows: block.rows, average: block.average }
    : term
      ? { label: term.termName, rows: term.rows, average: term.average }
      : null
  if (source) {
    return {
      label: source.label,
      average: source.average,
      rows: source.rows.map((r) => ({
        subject: r.subject,
        score: r.score,
        maxScore: r.maxScore,
        pct: r.maxScore > 0 ? (r.score / r.maxScore) * 100 : r.score,
        grade: r.grade,
        comment: r.comment,
      })),
    }
  }
  if (results.subjects.length === 0) return null
  const rows = results.subjects.map((s) => ({
    subject: s.name,
    score: s.score,
    maxScore: 100,
    pct: s.score,
    grade: s.grade,
    comment: s.comment,
  }))
  return {
    label: results.term || 'Latest results',
    rows,
    average: rows.reduce((sum, r) => sum + r.pct, 0) / rows.length,
  }
}

export function averageScore(results: ResultPortalView) {
  if (results.accessState !== 'RESULTS_AVAILABLE') return null
  return results.overallAverage ?? latestResults(results)?.average ?? null
}

export function money(amount: number, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toLocaleString('en-US')}`
  }
}

export function percent(value: number | null | undefined, digits = 0) {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(digits)}%`
}

export function shortDate(value: string | undefined) {
  if (!value) return '—'
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function greeting(now = new Date()) {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/** Colour for a percentage score: strong, fair, or needs attention. */
export function scoreTone(pct: number) {
  if (pct >= 75) return 'success' as const
  if (pct >= 50) return 'accent' as const
  return 'warning' as const
}

export function ProgressBar({
  value,
  tone = 'primary',
  className,
}: {
  value: number
  tone?: 'primary' | 'success' | 'accent' | 'warning'
  className?: string
}) {
  const clamped = Math.max(0, Math.min(100, value))
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-700 ease-out',
          tone === 'primary' && 'bg-primary',
          tone === 'success' && 'bg-success',
          tone === 'accent' && 'bg-accent',
          tone === 'warning' && 'bg-warning',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  ABSENT: 'Absent',
  EXCUSED: 'Excused',
  AUTHORIZED_ABSENCE: 'Authorised absence',
}

export function AttendanceBadge({ status }: { status: AttendanceStatus }) {
  const variant =
    status === 'PRESENT'
      ? 'success'
      : status === 'LATE'
        ? 'warning'
        : status === 'ABSENT'
          ? 'danger'
          : 'secondary'
  return <Badge variant={variant}>{ATTENDANCE_LABEL[status]}</Badge>
}

/**
 * Standard student portal page: header plus the shared portal data,
 * with loading and retry states handled in one place.
 */
export function PortalPage({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: (data: StudentPortalBundle) => ReactNode
}) {
  const { data, loading, error, reload } = useStudentPortal()
  return (
    <div className="space-y-5">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: title }]}
        actions={actions}
      />
      {data ? (
        children(data)
      ) : loading ? (
        <LoadingState message="Loading your portal…" />
      ) : (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load your portal"
          description={error ?? 'Check your connection and try again.'}
          actionLabel="Try again"
          onAction={() => void reload()}
        />
      )}
    </div>
  )
}
