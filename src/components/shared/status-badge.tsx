import { cn } from '@/lib/utils'

export function StatusBadge({ status }: { status?: string | null }) {
  const value = typeof status === 'string' ? status : ''
  const normalized = value ? value.replaceAll('_', ' ') : 'Unknown'
  const tone =
    /active|paid|present|published|confirmed|success|available|approved/i.test(value)
      ? 'success'
      : /pending|draft|late|partial|submitted|review|open/i.test(value)
        ? 'warning'
        : /absent|overdue|failed|locked|disabled|cancelled|reversed|rejected|outstanding|inactive|suspended/i.test(
              value,
            )
          ? 'danger'
          : 'secondary'

  const classes =
    tone === 'success'
      ? 'bg-success/12 text-success ring-success/20'
      : tone === 'warning'
        ? 'bg-warning/12 text-warning ring-warning/20'
        : tone === 'danger'
          ? 'bg-destructive/12 text-destructive ring-destructive/20'
          : 'bg-secondary text-secondary-foreground ring-border'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset',
        classes,
      )}
    >
      {normalized.toLowerCase()}
    </span>
  )
}
