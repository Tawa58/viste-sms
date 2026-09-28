import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  MESSAGE_KIND_LABEL,
  MESSAGE_STATUS_LABEL,
  formatDayLabel,
  schoolClock,
  schoolDate,
  shiftMonth,
  type CheckinDayStatus,
} from '@/lib/checkin'
import { formatDurationHuman, formatMeters } from '@/lib/geofence'
import type { CheckinMessageStatus, StaffBoundaryEvent, StaffCheckinMessage } from '@/types'

export const DAY_BADGE: Record<CheckinDayStatus, 'success' | 'warning' | 'danger' | 'outline'> = {
  PRESENT: 'success',
  LATE: 'warning',
  ABSENT: 'danger',
  NOTIFIED: 'outline',
}

export const MESSAGE_BADGE: Record<CheckinMessageStatus, 'warning' | 'accent' | 'success'> = {
  OPEN: 'warning',
  SEEN: 'accent',
  RESOLVED: 'success',
}

export function MonthPicker({
  month,
  max,
  onChange,
}: {
  month: string
  max: string
  onChange: (month: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        size="icon"
        variant="outline"
        aria-label="Previous month"
        onClick={() => onChange(shiftMonth(month, -1))}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Input
        type="month"
        className="w-44"
        value={month}
        max={max}
        onChange={(e) => e.target.value && e.target.value <= max && onChange(e.target.value)}
        aria-label="Month"
      />
      <Button
        size="icon"
        variant="outline"
        aria-label="Next month"
        disabled={month >= max}
        onClick={() => onChange(shiftMonth(month, 1))}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

/** One premises exit: when, how long, how far, and why. */
export function ExitRow({
  event,
  showName,
  onAddReason,
}: {
  event: StaffBoundaryEvent
  showName?: boolean
  onAddReason?: () => void
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium tabular-nums">
          {showName ? <span className="mr-1">{event.name} ·</span> : null}
          {schoolClock(event.exitAt)} → {event.returnAt ? schoolClock(event.returnAt) : 'still out'}
          <span className="font-normal text-muted-foreground">
            {' · '}
            {event.status === 'OPEN' ? 'in progress' : formatDurationHuman(event.durationSeconds ?? 0)}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          Up to {formatMeters(event.maxDistanceFromBoundary)} beyond the boundary
          {event.closedBy === 'CHECK_OUT' ? ' · ended at check-out' : ''}
          {event.reason ? (
            <>
              {' · '}
              <span className="font-medium text-foreground">{event.reason}</span>
              {event.reasonNote ? ` — ${event.reasonNote}` : ''}
            </>
          ) : (
            ' · no reason given'
          )}
        </p>
      </div>
      {!event.reason && onAddReason ? (
        <Button size="sm" variant="ghost" onClick={onAddReason}>
          Add reason
        </Button>
      ) : null}
    </div>
  )
}

/** Absence notice / issue report with its status and the administration's reply. */
export function MessageCard({
  message,
  showName,
  children,
}: {
  message: StaffCheckinMessage
  showName?: boolean
  children?: ReactNode
}) {
  return (
    <div className="rounded-lg border border-border px-3 py-2.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">
            {showName ? `${message.name} · ` : ''}
            {MESSAGE_KIND_LABEL[message.kind]} · {message.category}
          </p>
          <p className="text-xs text-muted-foreground">
            {message.absenceDate ? `For ${formatDayLabel(message.absenceDate)} · ` : ''}
            Sent {formatDayLabel(schoolDate(message.createdAt))} {schoolClock(message.createdAt)}
          </p>
        </div>
        <Badge variant={MESSAGE_BADGE[message.status]}>{MESSAGE_STATUS_LABEL[message.status]}</Badge>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words">{message.details}</p>
      {message.adminReply ? (
        <p className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs">
          <span className="font-semibold">
            Reply{message.repliedByName ? ` from ${message.repliedByName}` : ''}:
          </span>{' '}
          {message.adminReply}
        </p>
      ) : null}
      {children}
    </div>
  )
}
