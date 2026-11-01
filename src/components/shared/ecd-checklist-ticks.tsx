import {
  ECD_CHECKLIST_SECTIONS,
  ECD_OVERALL_LABELS,
  ECD_RATING_LABELS,
  ECD_RATINGS,
  ecdStageLabel,
  summariseEcdRatings,
  type EcdRating,
} from '@/lib/ecd-checklist'
import { cn } from '@/lib/utils'
import type { EcdChecklist } from '@/types'

export function EcdTickBox({
  checked,
  label,
  disabled,
  onClick,
}: {
  checked: boolean
  label: string
  disabled?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled || !onClick}
      onClick={onClick}
      className={cn(
        'mx-auto flex h-8 w-8 items-center justify-center rounded-sm border border-foreground/50 bg-background text-lg font-bold leading-none',
        checked && 'border-foreground text-foreground',
        onClick && !disabled && 'hover:bg-muted',
        disabled && 'cursor-default',
      )}
    >
      {checked ? '✓' : ''}
    </button>
  )
}

export function EcdChecklistTicks({
  ratings,
  readOnly,
  onChange,
}: {
  ratings: Record<string, EcdRating | ''>
  readOnly?: boolean
  onChange?: (indicatorId: string, rating: EcdRating | '') => void
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Tick one box per skill: <strong>A</strong> achieved independently, <strong>D</strong>{' '}
        developing with help, <strong>NY</strong> not yet, <strong>NA</strong> not assessed.
      </p>
      {ECD_CHECKLIST_SECTIONS.map((section) => (
        <div key={section.id} className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th colSpan={2} className="px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {section.part}
                  </p>
                  <p className="font-semibold">{section.title}</p>
                </th>
                {ECD_RATINGS.map((rating) => (
                  <th key={rating} className="w-14 px-1 py-2 text-center font-semibold">
                    {rating}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {section.indicators.map((indicator) => (
                <tr key={indicator.id} className="border-t border-border">
                  <td className="w-10 px-3 py-2 align-top text-muted-foreground">
                    {indicator.number}
                  </td>
                  <td className="px-2 py-2">{indicator.text}</td>
                  {ECD_RATINGS.map((rating) => (
                    <td key={rating} className="px-1 py-1.5 text-center align-middle">
                      <EcdTickBox
                        checked={ratings[indicator.id] === rating}
                        label={`${indicator.text} — ${ECD_RATING_LABELS[rating]}`}
                        disabled={readOnly}
                        onClick={
                          readOnly
                            ? undefined
                            : () =>
                                onChange?.(
                                  indicator.id,
                                  ratings[indicator.id] === rating ? '' : rating,
                                )
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

export function EcdResultsSheet({
  sheet,
  learnerName,
  className,
  termName,
}: {
  sheet: EcdChecklist
  learnerName: string
  className?: string
  termName?: string
}) {
  const summary = summariseEcdRatings(sheet.ratings)
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
        <p className="font-display text-lg font-semibold">{learnerName}</p>
        <p className="text-sm text-muted-foreground">
          {className ? `${className} · ` : ''}
          {ecdStageLabel(sheet.stage)}
          {termName ? ` · ${termName}` : ''}
          {sheet.assessedAt ? ` · ${sheet.assessedAt}` : ''}
          {sheet.status === 'COMPLETED' ? ' · Completed' : ' · Draft'}
        </p>
        <p className="mt-1 text-sm">
          ✓ Achieved {summary.A} · Developing {summary.D} · Not yet {summary.NY}
          {sheet.overall ? ` · ${ECD_OVERALL_LABELS[sheet.overall]}` : ''}
        </p>
      </div>
      <EcdChecklistTicks ratings={sheet.ratings} readOnly />
      {(sheet.strengths || sheet.improvements || sheet.interventions || sheet.comments) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {sheet.strengths ? (
            <CommentBlock title="Strengths" text={sheet.strengths} />
          ) : null}
          {sheet.improvements ? (
            <CommentBlock title="Areas requiring improvement" text={sheet.improvements} />
          ) : null}
          {sheet.interventions ? (
            <CommentBlock title="Intervention / remedial activities" text={sheet.interventions} />
          ) : null}
          {sheet.comments ? (
            <CommentBlock title="Teacher comments" text={sheet.comments} />
          ) : null}
        </div>
      )}
    </div>
  )
}

function CommentBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{text}</p>
    </div>
  )
}
