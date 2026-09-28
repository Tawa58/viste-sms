import type {
  CheckinMessageKind,
  CheckinMessageStatus,
  CheckinSettings,
  CheckinTermRange,
  StaffCheckin,
  StaffCheckinMessage,
} from '@/types'
import type { GeofenceSite } from '@/lib/geofence'

/** Staff check-in dates and times are always shown in school time (Zimbabwe, no DST). */
export const SCHOOL_TIME_ZONE = 'Africa/Harare'

export const EXIT_REASONS = [
  'Work assignment',
  'Lunch',
  'Meeting',
  'Personal',
  'Emergency',
  'Other',
] as const

export const ABSENCE_CATEGORIES = [
  'Sick',
  'Family emergency',
  'Transport delay',
  'Approved leave',
  'School trip / official duty',
  'Personal matter',
  'Other',
] as const

export const ISSUE_CATEGORIES = [
  'Check-in failed',
  'GPS / location',
  'Wrong check-in time',
  'Forgot to check out',
  'App not loading',
  'Other',
] as const

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const MESSAGE_KIND_LABEL: Record<CheckinMessageKind, string> = {
  ABSENCE: 'Absence notice',
  ISSUE: 'System issue',
}

export const MESSAGE_STATUS_LABEL: Record<CheckinMessageStatus, string> = {
  OPEN: 'Open',
  SEEN: 'Seen',
  RESOLVED: 'Resolved',
}

export const DEFAULT_CHECKIN_SETTINGS: CheckinSettings = {
  id: 'checkin',
  siteName: 'School premises',
  latitude: null,
  longitude: null,
  radiusMeters: 150,
  requireInside: true,
  lateAfter: '07:30',
  workingDays: [1, 2, 3, 4, 5],
}

export function siteFromSettings(settings: CheckinSettings | null | undefined): GeofenceSite | null {
  if (!settings || settings.latitude == null || settings.longitude == null) return null
  return {
    name: settings.siteName || DEFAULT_CHECKIN_SETTINGS.siteName,
    latitude: settings.latitude,
    longitude: settings.longitude,
    radiusMeters: settings.radiusMeters,
  }
}

const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SCHOOL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const clockFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: SCHOOL_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** YYYY-MM-DD in school time. */
export function schoolDate(at: Date | string | number = new Date()): string {
  return dateFormatter.format(new Date(at))
}

/** HH:mm (24-hour) in school time. */
export function schoolClock(at: Date | string | number | null | undefined): string {
  if (at == null || at === '') return '—'
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? '—' : clockFormatter.format(d)
}

export function currentMonth(at: Date | string | number = new Date()): string {
  return schoolDate(at).slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(year!, m! - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function formatMonthLabel(month: string): string {
  const [year, m] = month.split('-').map(Number)
  return new Date(Date.UTC(year!, m! - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatDayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay()
}

export function datesInMonth(month: string): string[] {
  const [year, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(year!, m!, 0)).getUTCDate()
  return Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

/** True when a check-in at `at` is after the school's late cut-off (HH:mm). */
export function isLateCheckIn(at: Date | string | number, lateAfter: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(lateAfter)) return false
  return schoolClock(at) > lateAfter
}

/** Days staff are expected at school: working weekdays inside a school term, up to `through`. */
export function expectedWorkDays(
  month: string,
  opts: { workingDays: number[]; terms: CheckinTermRange[]; through: string },
): string[] {
  const terms = opts.terms.map((t) => ({
    start: t.startDate.slice(0, 10),
    end: t.endDate.slice(0, 10),
  }))
  return datesInMonth(month).filter((date) => {
    if (date > opts.through) return false
    if (!opts.workingDays.includes(weekdayOf(date))) return false
    if (terms.length > 0 && !terms.some((t) => t.start <= date && date <= t.end)) return false
    return true
  })
}

/** Seconds on the premises between check-in and check-out (or now, while still checked in). */
export function secondsWorked(record: StaffCheckin, nowMs = Date.now()): number {
  const start = Date.parse(record.checkInAt)
  const end = record.checkOutAt ? Date.parse(record.checkOutAt) : nowMs
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, Math.floor((end - start) / 1000))
}

export type CheckinDayStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'NOTIFIED'

export type CheckinDay = {
  date: string
  status: CheckinDayStatus
  /** False when the person checked in on a day that isn't a school working day. */
  expected: boolean
  record?: StaffCheckin
  notice?: StaffCheckinMessage
}

export type CheckinMonthReport = {
  month: string
  label: string
  workingDays: number
  present: number
  late: number
  absent: number
  notified: number
  rate: number
  exits: number
  secondsOutside: number
  days: CheckinDay[]
}

export const DAY_STATUS_LABEL: Record<CheckinDayStatus, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  ABSENT: 'Absent',
  NOTIFIED: 'Absent · notice given',
}

/** One person's month: expected days, which they attended, and absences with a notice. */
export function buildMonthReport(input: {
  month: string
  records: StaffCheckin[]
  notices: StaffCheckinMessage[]
  settings: Pick<CheckinSettings, 'workingDays'>
  terms: CheckinTermRange[]
  today: string
}): CheckinMonthReport {
  const records = new Map(
    input.records.filter((r) => r.date.startsWith(input.month)).map((r) => [r.date, r]),
  )
  const notices = new Map<string, StaffCheckinMessage>()
  for (const n of input.notices) {
    if (n.kind === 'ABSENCE' && n.absenceDate?.startsWith(input.month)) {
      notices.set(n.absenceDate.slice(0, 10), n)
    }
  }
  const expected = new Set(
    expectedWorkDays(input.month, {
      workingDays: input.settings.workingDays,
      terms: input.terms,
      through: input.today,
    }),
  )
  const dates = [...new Set([...expected, ...records.keys()])].sort()

  const days: CheckinDay[] = dates.map((date) => {
    const record = records.get(date)
    const notice = notices.get(date)
    const status: CheckinDayStatus = record
      ? record.late
        ? 'LATE'
        : 'PRESENT'
      : notice
        ? 'NOTIFIED'
        : 'ABSENT'
    return { date, status, expected: expected.has(date), record, notice }
  })

  const onExpected = days.filter((d) => d.expected)
  const present = onExpected.filter((d) => d.status === 'PRESENT' || d.status === 'LATE').length
  let exits = 0
  let secondsOutside = 0
  for (const r of records.values()) {
    exits += r.exitCount ?? 0
    secondsOutside += r.secondsOutside ?? 0
  }

  return {
    month: input.month,
    label: formatMonthLabel(input.month),
    workingDays: expected.size,
    present,
    late: onExpected.filter((d) => d.status === 'LATE').length,
    absent: onExpected.filter((d) => d.status === 'ABSENT').length,
    notified: onExpected.filter((d) => d.status === 'NOTIFIED').length,
    rate: expected.size === 0 ? 0 : Math.round((present / expected.size) * 100),
    exits,
    secondsOutside,
    days,
  }
}
