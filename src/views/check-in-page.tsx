import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarCheck,
  Clock,
  Footprints,
  LocateFixed,
  LogIn,
  LogOut,
  MapPinOff,
  RefreshCw,
  Send,
  Timer,
  UserCheck,
  UserX,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { StatCard } from '@/components/shared/stat-card'
import { Alert } from '@/components/shared/alert'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { VicinityMap } from '@/components/checkin/vicinity-map'
import { ExitReasonDialog } from '@/components/checkin/exit-reason-dialog'
import { DAY_BADGE, ExitRow, MessageCard, MonthPicker } from '@/components/checkin/checkin-ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { useGeofenceMonitor } from '@/hooks/use-geofence-monitor'
import {
  ABSENCE_CATEGORIES,
  DAY_STATUS_LABEL,
  ISSUE_CATEGORIES,
  SCHOOL_TIME_ZONE,
  buildMonthReport,
  formatDayLabel,
  schoolClock,
  secondsWorked,
  siteFromSettings,
} from '@/lib/checkin'
import { formatDurationClock, formatDurationShort, formatMeters } from '@/lib/geofence'
import { impreciseLocationMessage } from '@/lib/location'
import { notify } from '@/lib/notify'
import { hasAppPermission } from '@/lib/roles'
import { checkinService } from '@/services/checkin'
import type {
  CheckinMessageKind,
  CheckinSelfBundle,
  StaffBoundaryEvent,
  StaffCheckin,
  StaffCheckinMessage,
} from '@/types'

function errorText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback
}

function firstName(name?: string) {
  return name?.trim().split(/\s+/)[0] || 'there'
}

export function CheckInPage() {
  const { user, permissions } = useAuth()
  const canManage = hasAppPermission(permissions, 'checkin.manage')
  const [bundle, setBundle] = useState<CheckinSelfBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [month, setMonth] = useState<string | undefined>(undefined)
  const [tab, setTab] = useState('today')

  const load = useCallback(async (target?: string) => {
    try {
      const data = await checkinService.getMine(target)
      setBundle(data)
      setLoadError('')
    } catch (err) {
      setLoadError(errorText(err, 'Could not load your check-in.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(month)
  }, [load, month])

  const setTodayRecord = useCallback((record: StaffCheckin) => {
    setBundle((prev) => {
      if (!prev) return prev
      const inMonth = record.date.startsWith(prev.month)
      return {
        ...prev,
        todayRecord: record,
        records: inMonth
          ? [record, ...prev.records.filter((r) => r.id !== record.id)]
          : prev.records,
      }
    })
  }, [])

  if (loading) return <LoadingState message="Loading your check-in…" />

  if (!bundle) {
    return (
      <div>
        <PageHeader title="Daily check-in" />
        <Alert title="Check-in is unavailable" tone="danger">
          {loadError || 'Please try again.'}{' '}
          <button type="button" className="font-medium underline" onClick={() => void load(month)}>
            Retry
          </button>
        </Alert>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Daily check-in"
        description="Check in when you arrive at school and check out when you leave. Your location is verified against the school boundary."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Daily check-in' }]}
        actions={
          canManage ? (
            <Button asChild variant="outline">
              <Link to="/staff-attendance">
                <UserCheck className="h-4 w-4" />
                Staff attendance
              </Link>
            </Button>
          ) : null
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="today">Today</TabsTrigger>
          <TabsTrigger value="attendance">My attendance</TabsTrigger>
          <TabsTrigger value="report">Report to admin</TabsTrigger>
        </TabsList>
        <TabsContent value="today">
          <TodayPanel
            bundle={bundle}
            userName={user?.name}
            canManage={canManage}
            onRecord={setTodayRecord}
          />
        </TabsContent>
        <TabsContent value="attendance">
          <MyAttendancePanel bundle={bundle} onMonth={setMonth} />
        </TabsContent>
        <TabsContent value="report">
          <ReportPanel
            bundle={bundle}
            onSent={(message) =>
              setBundle((prev) => (prev ? { ...prev, messages: [message, ...prev.messages] } : prev))
            }
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function TodayPanel({
  bundle,
  userName,
  canManage,
  onRecord,
}: {
  bundle: CheckinSelfBundle
  userName?: string
  canManage: boolean
  onRecord: (record: StaffCheckin) => void
}) {
  const site = useMemo(() => siteFromSettings(bundle.settings), [bundle.settings])
  const record = bundle.todayRecord
  const onDuty = Boolean(record && !record.checkOutAt)
  const monitor = useGeofenceMonitor({
    site,
    tracking: onDuty,
    initialEvents: bundle.todayEvents,
    onRecord,
  })
  const [punching, setPunching] = useState(false)
  const [dismissedExit, setDismissedExit] = useState<string | null>(null)
  const [reasonFor, setReasonFor] = useState<StaffBoundaryEvent | null>(null)
  const [confirmOut, setConfirmOut] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!onDuty) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [onDuty])

  const { openEvent } = monitor
  const promptEvent =
    reasonFor ?? (openEvent && !openEvent.reason && dismissedExit !== openEvent.id ? openEvent : null)

  const outside = monitor.zone === 'outside'
  const { imprecise } = monitor
  const blockedOutside = bundle.settings.requireInside && outside && !imprecise
  const blocked = bundle.settings.requireInside && (outside || imprecise)
  const todayLabel = new Date(bundle.serverTime).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: SCHOOL_TIME_ZONE,
  })

  async function punch(action: 'CHECK_IN' | 'CHECK_OUT') {
    setPunching(true)
    try {
      const gps = await monitor.refresh()
      if (!gps.ok) {
        notify.error('Location needed', gps.message)
        return
      }
      const saved = await checkinService.punch({ action, ...gps.fix })
      onRecord(saved)
      notify.success(
        action === 'CHECK_IN'
          ? `Checked in at ${schoolClock(saved.checkInAt)}`
          : `Checked out at ${schoolClock(saved.checkOutAt)}`,
        action === 'CHECK_IN' && saved.late ? 'This check-in is marked late.' : undefined,
      )
    } catch (err) {
      notify.error(
        action === 'CHECK_IN' ? 'Could not check in' : 'Could not check out',
        errorText(err, 'Please try again.'),
      )
    } finally {
      setPunching(false)
    }
  }

  const gps = monitor.gps
  const statusBadge = !record ? (
    <Badge variant="outline">Not checked in</Badge>
  ) : record.checkOutAt ? (
    <Badge variant="secondary">Checked out</Badge>
  ) : (
    <Badge variant="success">On duty</Badge>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-4 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">{todayLabel}</p>
                <p className="mt-1 text-lg font-semibold">Hello, {firstName(userName)}</p>
              </div>
              {statusBadge}
            </div>

            {!site ? (
              <Alert title="School location not set" tone="warning">
                {canManage ? (
                  <>
                    Set the school’s location and boundary in{' '}
                    <Link to="/staff-attendance?tab=location" className="font-medium underline">
                      Staff attendance → School location
                    </Link>{' '}
                    before staff can check in.
                  </>
                ) : (
                  'An administrator needs to set the school’s location before you can check in.'
                )}
              </Alert>
            ) : null}

            <div className="rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {gps?.ok && !imprecise ? (
                    <LocateFixed className="h-4 w-4 text-success" />
                  ) : (
                    <MapPinOff className="h-4 w-4 text-warning" />
                  )}
                  {monitor.gpsLoading && !gps
                    ? 'Finding your location…'
                    : gps?.ok
                      ? imprecise
                        ? 'Location not precise enough'
                        : 'GPS location verified'
                      : 'GPS location required'}
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={monitor.gpsLoading && !!gps}
                  onClick={() => void monitor.refresh()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>
              {gps?.ok ? (
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {gps.fix.latitude.toFixed(5)}, {gps.fix.longitude.toFixed(5)}
                  {gps.fix.accuracy != null ? ` · ±${Math.round(gps.fix.accuracy)} m` : ''}
                </p>
              ) : gps && !gps.ok ? (
                <p className="mt-1 text-xs text-warning">{gps.message}</p>
              ) : null}
              {gps?.ok && imprecise && gps.fix.accuracy != null ? (
                <p className="mt-1.5 text-xs text-warning">
                  {impreciseLocationMessage(`±${formatMeters(gps.fix.accuracy)}`)}
                </p>
              ) : site && monitor.reading ? (
                <p className="mt-1.5 text-xs">
                  {outside ? (
                    <span className="font-medium text-destructive">
                      Outside the school boundary · {formatMeters(monitor.reading.fromBoundary)} away
                    </span>
                  ) : (
                    <span className="font-medium text-success">
                      Inside the school boundary · {formatMeters(monitor.reading.fromCentre)} from the
                      centre
                    </span>
                  )}
                </p>
              ) : null}
            </div>

            {!record ? (
              <div className="space-y-2">
                <Button
                  className="h-12 w-full text-base"
                  loading={punching}
                  disabled={!site || !gps?.ok || blocked}
                  onClick={() => void punch('CHECK_IN')}
                >
                  <LogIn className="h-5 w-5" />
                  Check in now
                </Button>
                {blockedOutside ? (
                  <p className="text-center text-xs text-muted-foreground">
                    Move onto the school premises to check in.
                  </p>
                ) : null}
              </div>
            ) : !record.checkOutAt ? (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="h-12 w-full text-base"
                  loading={punching}
                  disabled={!site || !gps?.ok || blocked}
                  onClick={() => setConfirmOut(true)}
                >
                  <LogOut className="h-5 w-5" />
                  Check out
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Keep this page open while on duty so time off the premises is recorded.
                </p>
              </div>
            ) : null}

            {record ? (
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                {openEvent ? (
                  <>
                    <StatCard
                      label="Time out"
                      value={formatDurationClock(monitor.secondsOutside)}
                      icon={Timer}
                      tone="warning"
                    />
                    <StatCard label="Left at" value={schoolClock(openEvent.exitAt)} icon={Footprints} />
                  </>
                ) : (
                  <>
                    <StatCard
                      label="Checked in at"
                      value={schoolClock(record.checkInAt)}
                      hint={record.late ? 'Late' : undefined}
                      icon={CalendarCheck}
                      tone={record.late ? 'warning' : 'success'}
                    />
                    {record.checkOutAt ? (
                      <StatCard label="Checked out at" value={schoolClock(record.checkOutAt)} icon={LogOut} />
                    ) : (
                      <StatCard
                        label="Time on duty"
                        value={formatDurationShort(secondsWorked(record, now))}
                        icon={Clock}
                      />
                    )}
                  </>
                )}
              </div>
            ) : null}

            {record?.checkOutAt ? (
              <p className="text-sm text-muted-foreground">
                On duty for {formatDurationShort(secondsWorked(record))}
                {record.exitCount > 0
                  ? ` · ${record.exitCount} exit${record.exitCount === 1 ? '' : 's'}, ${formatDurationShort(record.secondsOutside)} off the premises`
                  : ''}
                . See you tomorrow.
              </p>
            ) : null}

            {monitor.syncError ? (
              <Alert title="Premises tracking" tone="warning">
                {monitor.syncError}
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {site ? (
          <VicinityMap
            site={site}
            location={monitor.fix}
            outside={outside}
            muted={monitor.zone === null}
          />
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Time off the premises today</CardTitle>
            <CardDescription>
              While you are checked in, leaving the school boundary is recorded automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {monitor.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No exits recorded today.</p>
            ) : (
              monitor.events.map((event) => (
                <ExitRow
                  key={event.id}
                  event={event}
                  onAddReason={() => setReasonFor(event)}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOut}
        onOpenChange={setConfirmOut}
        title="Check out for today?"
        description="You cannot check in again until tomorrow."
        confirmLabel="Check out"
        onConfirm={() => void punch('CHECK_OUT')}
      />
      <ExitReasonDialog
        open={promptEvent !== null}
        firstName={firstName(userName)}
        timeOut={
          promptEvent?.status === 'OPEN'
            ? formatDurationClock(monitor.secondsOutside)
            : formatDurationClock(promptEvent?.durationSeconds ?? 0)
        }
        leftAt={schoolClock(promptEvent?.exitAt)}
        saving={monitor.reasonSaving}
        onSubmit={async (reason, note) => {
          if (!promptEvent) return
          await monitor.submitReason(promptEvent.id, reason, note)
          notify.success('Reason saved')
          setReasonFor(null)
          setDismissedExit(promptEvent.id)
        }}
        onClose={() => {
          if (promptEvent) setDismissedExit(promptEvent.id)
          setReasonFor(null)
        }}
      />
    </div>
  )
}

function MyAttendancePanel({
  bundle,
  onMonth,
}: {
  bundle: CheckinSelfBundle
  onMonth: (month: string) => void
}) {
  const report = useMemo(
    () =>
      buildMonthReport({
        month: bundle.month,
        records: bundle.records,
        notices: bundle.messages,
        settings: bundle.settings,
        terms: bundle.terms,
        today: bundle.today,
      }),
    [bundle],
  )
  const currentMonth = bundle.today.slice(0, 7)
  const days = [...report.days].reverse()

  return (
    <div className="space-y-4">
      <MonthPicker month={bundle.month} max={currentMonth} onChange={onMonth} />

      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Attendance rate"
          value={`${report.rate}%`}
          hint={`${report.present} of ${report.workingDays} school days`}
          icon={UserCheck}
          tone="success"
        />
        <StatCard label="Late" value={String(report.late)} icon={Clock} tone="warning" />
        <StatCard
          label="Absent"
          value={String(report.absent)}
          hint={report.notified ? `+${report.notified} with notice` : undefined}
          icon={UserX}
          tone="warning"
        />
        <StatCard
          label="Time off premises"
          value={formatDurationShort(report.secondsOutside)}
          hint={`${report.exits} exit${report.exits === 1 ? '' : 's'}`}
          icon={Footprints}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{report.label}</CardTitle>
          <CardDescription>
            School days are your working weekdays during term. Days you checked in outside term are
            listed too.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {days.length === 0 ? (
            <p className="text-sm text-muted-foreground">No school days in this month yet.</p>
          ) : (
            days.map((day) => (
              <div
                key={day.date}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">{formatDayLabel(day.date)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {day.record
                      ? `${schoolClock(day.record.checkInAt)} → ${day.record.checkOutAt ? schoolClock(day.record.checkOutAt) : day.date === bundle.today ? 'on duty' : 'no check-out'} · ${formatDurationShort(secondsWorked(day.record))}`
                      : day.notice
                        ? `${day.notice.category}`
                        : 'No check-in'}
                    {!day.expected ? ' · not a school day' : ''}
                  </p>
                </div>
                <Badge variant={DAY_BADGE[day.status]}>{DAY_STATUS_LABEL[day.status]}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {bundle.events.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Premises exits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {bundle.events.map((event) => (
              <div key={event.id}>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {formatDayLabel(event.date)}
                </p>
                <ExitRow event={event} />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

function ReportPanel({
  bundle,
  onSent,
}: {
  bundle: CheckinSelfBundle
  onSent: (message: StaffCheckinMessage) => void
}) {
  const [kind, setKind] = useState<CheckinMessageKind>('ABSENCE')
  const [category, setCategory] = useState('')
  const [absenceDate, setAbsenceDate] = useState(bundle.today)
  const [details, setDetails] = useState('')
  const [sending, setSending] = useState(false)
  const categories: readonly string[] = kind === 'ABSENCE' ? ABSENCE_CATEGORIES : ISSUE_CATEGORIES

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!category) return notify.error('Choose a category')
    if (details.trim().length < 8) return notify.error('Add a few more details')
    setSending(true)
    try {
      const message = await checkinService.sendMessage({
        kind,
        category,
        details: details.trim(),
        absenceDate: kind === 'ABSENCE' ? absenceDate : undefined,
      })
      onSent(message)
      setCategory('')
      setDetails('')
      notify.success('Sent to the school administration')
    } catch (err) {
      notify.error('Could not send', errorText(err, 'Please try again.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Tell the administration</CardTitle>
          <CardDescription>
            Give notice of an absence, or report a problem with checking in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Tabs
              value={kind}
              onValueChange={(v) => {
                setKind(v as CheckinMessageKind)
                setCategory('')
              }}
            >
              <TabsList>
                <TabsTrigger value="ABSENCE">Absence notice</TabsTrigger>
                <TabsTrigger value="ISSUE">System issue</TabsTrigger>
              </TabsList>
            </Tabs>
            {kind === 'ABSENCE' ? (
              <Field>
                <Label htmlFor="absence-date">Date you will be / were away</Label>
                <Input
                  id="absence-date"
                  type="date"
                  value={absenceDate}
                  onChange={(e) => setAbsenceDate(e.target.value)}
                  required
                />
              </Field>
            ) : null}
            <Field>
              <Label htmlFor="report-category">Category</Label>
              <Select
                id="report-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Choose…</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label htmlFor="report-details">Details</Label>
              <Textarea
                id="report-details"
                rows={4}
                maxLength={1000}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder={
                  kind === 'ABSENCE'
                    ? 'e.g. Doctor’s appointment in the morning, back by 11:00'
                    : 'What happened when you tried to check in?'
                }
              />
            </Field>
            <Button type="submit" loading={sending} className="w-full sm:w-auto">
              <Send className="h-4 w-4" />
              Send
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My reports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {bundle.messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">You haven’t sent any reports yet.</p>
          ) : (
            bundle.messages.map((m) => <MessageCard key={m.id} message={m} />)
          )}
        </CardContent>
      </Card>
    </div>
  )
}
