import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Clock,
  Download,
  FileText,
  Footprints,
  Inbox,
  LocateFixed,
  MapPinCheck,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { SearchInput } from '@/components/shared/search-input'
import { StatCard } from '@/components/shared/stat-card'
import { Alert } from '@/components/shared/alert'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  DataTableShell,
} from '@/components/shared/data-table'
import { DAY_BADGE, ExitRow, MessageCard, MonthPicker } from '@/components/checkin/checkin-ui'
import { VicinityMap } from '@/components/checkin/vicinity-map'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  DAY_STATUS_LABEL,
  WEEKDAY_LABELS,
  buildMonthReport,
  datesInMonth,
  formatDayLabel,
  formatMonthLabel,
  schoolClock,
  schoolDate,
  secondsWorked,
  siteFromSettings,
  type CheckinMonthReport,
} from '@/lib/checkin'
import { downloadCsv, downloadTablePdf } from '@/lib/checkin-export'
import {
  MAX_GEOFENCE_RADIUS_M,
  MIN_GEOFENCE_RADIUS_M,
  formatDurationHuman,
  formatDurationShort,
  formatMeters,
  type GeoPoint,
} from '@/lib/geofence'
import { getCurrentLocation } from '@/lib/location'
import { notify } from '@/lib/notify'
import { formatRoleLabel } from '@/lib/roles'
import { checkinService } from '@/services/checkin'
import type {
  CheckinAdminBundle,
  CheckinMessageStatus,
  CheckinRosterEntry,
  CheckinSettings,
  StaffCheckin,
  StaffCheckinMessage,
  UserRole,
} from '@/types'

function errorText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback
}

function rosterLabel(entry: Pick<CheckinRosterEntry, 'role' | 'department'>) {
  return [formatRoleLabel(entry.role), entry.department].filter(Boolean).join(' · ')
}

export function StaffAttendancePage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'register'
  const [month, setMonth] = useState<string | undefined>(undefined)
  const [bundle, setBundle] = useState<CheckinAdminBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const load = useCallback(async (target?: string) => {
    try {
      setBundle(await checkinService.getAdmin(target))
      setLoadError('')
    } catch (err) {
      setLoadError(errorText(err, 'Could not load staff attendance.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(month)
  }, [load, month])

  if (loading) return <LoadingState message="Loading staff attendance…" />

  if (!bundle) {
    return (
      <div>
        <PageHeader title="Staff attendance" />
        <Alert title="Staff attendance is unavailable" tone="danger">
          {loadError || 'Please try again.'}{' '}
          <button type="button" className="font-medium underline" onClick={() => void load(month)}>
            Retry
          </button>
        </Alert>
      </div>
    )
  }

  const openReports = bundle.messages.filter((m) => m.status === 'OPEN').length
  const siteMissing = !siteFromSettings(bundle.settings)

  return (
    <div>
      <PageHeader
        title="Staff attendance"
        description="Daily check-ins, time off the premises, monthly reports, and messages from staff."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Staff attendance' }]}
        actions={
          <Button asChild variant="outline">
            <Link to="/check-in">
              <MapPinCheck className="h-4 w-4" />
              My check-in
            </Link>
          </Button>
        }
      />

      {siteMissing && tab !== 'location' ? (
        <Alert title="Set the school location first" tone="warning" className="mb-4">
          Staff cannot check in until the school’s location and boundary are saved.{' '}
          <button
            type="button"
            className="font-medium underline"
            onClick={() => setParams({ tab: 'location' }, { replace: true })}
          >
            Set school location
          </button>
        </Alert>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'register' ? {} : { tab: v }, { replace: true })}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="register">Daily register</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="inbox">
            Inbox
            {openReports > 0 ? (
              <span className="ml-1.5 rounded-full bg-warning/15 px-1.5 text-[11px] font-semibold text-warning">
                {openReports}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="location">School location</TabsTrigger>
        </TabsList>
        <TabsContent value="register">
          <RegisterPanel bundle={bundle} onMonth={setMonth} />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsPanel bundle={bundle} onMonth={setMonth} />
        </TabsContent>
        <TabsContent value="inbox">
          <InboxPanel
            messages={bundle.messages}
            onUpdated={(message) =>
              setBundle((prev) =>
                prev
                  ? {
                      ...prev,
                      messages: prev.messages.map((m) => (m.id === message.id ? message : m)),
                    }
                  : prev,
              )
            }
          />
        </TabsContent>
        <TabsContent value="location">
          <LocationPanel
            settings={bundle.settings}
            onSaved={(settings) => setBundle((prev) => (prev ? { ...prev, settings } : prev))}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

type RegisterRow = {
  uid: string
  name: string
  role: UserRole
  department?: string
  record: StaffCheckin
}

function recordStatus(record: StaffCheckin, today: string) {
  if (record.openExitId) return { label: 'Off premises', variant: 'danger' as const }
  if (record.checkOutAt) return { label: 'Checked out', variant: 'secondary' as const }
  if (record.date === today) return { label: 'On duty', variant: 'success' as const }
  return { label: 'No check-out', variant: 'outline' as const }
}

function RegisterPanel({
  bundle,
  onMonth,
}: {
  bundle: CheckinAdminBundle
  onMonth: (month: string) => void
}) {
  const [date, setDate] = useState(() =>
    bundle.today.startsWith(bundle.month) ? bundle.today : datesInMonth(bundle.month).at(-1)!,
  )
  const [search, setSearch] = useState('')
  const [role, setRole] = useState<'all' | UserRole>('all')

  function changeDate(next: string) {
    if (!next || next > bundle.today) return
    setDate(next)
    if (next.slice(0, 7) !== bundle.month) onMonth(next.slice(0, 7))
  }

  const rosterByUid = useMemo(
    () => new Map(bundle.roster.map((r) => [r.uid, r])),
    [bundle.roster],
  )
  const roles = useMemo(() => [...new Set(bundle.roster.map((r) => r.role))].sort(), [bundle.roster])

  const matches = useCallback(
    (entry: { name: string; role: UserRole; department?: string; employeeNumber?: string }) => {
      if (role !== 'all' && entry.role !== role) return false
      const q = search.trim().toLowerCase()
      if (!q) return true
      return [entry.name, entry.department, entry.employeeNumber]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    },
    [role, search],
  )

  const dayRecords = useMemo(
    () => bundle.records.filter((r) => r.date === date),
    [bundle.records, date],
  )
  const rows: RegisterRow[] = useMemo(
    () =>
      dayRecords
        .filter(matches)
        .map((record) => ({
          uid: record.uid,
          name: record.name,
          role: record.role,
          department: record.department,
          record,
        }))
        .sort((a, b) => a.record.checkInAt.localeCompare(b.record.checkInAt)),
    [dayRecords, matches],
  )
  const checkedIn = new Set(dayRecords.map((r) => r.uid))
  const notices = new Map(
    bundle.messages
      .filter((m) => m.kind === 'ABSENCE' && m.absenceDate === date)
      .map((m) => [m.uid, m]),
  )
  const missingAll = bundle.roster.filter((r) => !checkedIn.has(r.uid))
  const missing = missingAll.filter(matches)
  const dayEvents = bundle.events.filter((e) => {
    if (e.date !== date) return false
    const entry = rosterByUid.get(e.uid)
    return entry ? matches(entry) : role === 'all' && matches({ ...e, role: 'TEACHER' })
  })

  const lateCount = dayRecords.filter((r) => r.late).length
  const offPremises = dayRecords.filter((r) => r.openExitId).length
  const isToday = date === bundle.today

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <Input
          type="date"
          value={date}
          max={bundle.today}
          onChange={(e) => changeDate(e.target.value)}
          aria-label="Date"
        />
        <SearchInput
          id="staff-attendance-search"
          name="staff-attendance-search"
          value={search}
          onChange={setSearch}
          placeholder="Search by name, department or employee number…"
        />
        <Select value={role} onChange={(e) => setRole(e.target.value as 'all' | UserRole)}>
          <option value="all">All staff</option>
          {roles.map((r) => (
            <option key={r} value={r}>
              {formatRoleLabel(r)}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-5">
        <StatCard label="Staff" value={String(bundle.roster.length)} icon={Users} />
        <StatCard
          label={isToday ? 'Checked in today' : 'Checked in'}
          value={String(dayRecords.length)}
          icon={UserCheck}
          tone="success"
        />
        <StatCard label="Late" value={String(lateCount)} icon={Clock} tone="warning" />
        <StatCard
          label="Not checked in"
          value={String(missingAll.length)}
          icon={UserX}
          tone="warning"
        />
        <StatCard
          label={isToday ? 'Off premises now' : 'Premises exits'}
          value={String(isToday ? offPremises : dayEvents.length)}
          icon={Footprints}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Checked in · {formatDayLabel(date)}</CardTitle>
          <CardDescription>Times are school time. Distances are from the centre of the premises.</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No check-ins match for this date.
            </p>
          ) : (
            <DataTableShell>
              <DataTable>
                <DataTableHead>
                  <tr>
                    <DataTableHeaderCell>Staff member</DataTableHeaderCell>
                    <DataTableHeaderCell>In</DataTableHeaderCell>
                    <DataTableHeaderCell>Out</DataTableHeaderCell>
                    <DataTableHeaderCell>Location</DataTableHeaderCell>
                    <DataTableHeaderCell>Off premises</DataTableHeaderCell>
                    <DataTableHeaderCell>Status</DataTableHeaderCell>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {rows.map(({ record }) => {
                    const status = recordStatus(record, bundle.today)
                    return (
                      <DataTableRow key={record.id}>
                        <DataTableCell>
                          <p className="font-medium">{record.name}</p>
                          <p className="text-[11px] text-muted-foreground">{rosterLabel(record)}</p>
                        </DataTableCell>
                        <DataTableCell className="tabular-nums">
                          {schoolClock(record.checkInAt)}
                          {record.late ? (
                            <Badge variant="warning" className="ml-1.5">
                              Late
                            </Badge>
                          ) : null}
                        </DataTableCell>
                        <DataTableCell className="tabular-nums">
                          {record.checkOutAt ? schoolClock(record.checkOutAt) : '—'}
                          <p className="text-[11px] text-muted-foreground">
                            {formatDurationShort(secondsWorked(record))}
                          </p>
                        </DataTableCell>
                        <DataTableCell className="text-xs">
                          {formatMeters(record.checkInDistance)}
                          {record.checkInInside ? null : (
                            <Badge variant="danger" className="ml-1.5">
                              Outside
                            </Badge>
                          )}
                          {record.checkInAccuracy != null ? (
                            <p className="text-[11px] text-muted-foreground">
                              GPS ±{Math.round(record.checkInAccuracy)} m
                            </p>
                          ) : null}
                        </DataTableCell>
                        <DataTableCell className="text-xs">
                          {record.exitCount > 0
                            ? `${record.exitCount} exit${record.exitCount === 1 ? '' : 's'} · ${formatDurationShort(record.secondsOutside)}`
                            : 'None'}
                        </DataTableCell>
                        <DataTableCell>
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </DataTableCell>
                      </DataTableRow>
                    )
                  })}
                </DataTableBody>
              </DataTable>
            </DataTableShell>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Not checked in ({missing.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {missing.length === 0 ? (
              <p className="text-sm text-muted-foreground">Everyone has checked in.</p>
            ) : (
              missing.map((entry) => {
                const notice = notices.get(entry.uid)
                return (
                  <div
                    key={entry.uid}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{entry.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{rosterLabel(entry)}</p>
                    </div>
                    {notice ? (
                      <Badge variant="outline" title={notice.details}>
                        Notice: {notice.category}
                      </Badge>
                    ) : null}
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Premises exits ({dayEvents.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dayEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one left the premises while checked in.</p>
            ) : (
              dayEvents.map((event) => <ExitRow key={event.id} event={event} showName />)
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

type StaffReport = { entry: CheckinRosterEntry; report: CheckinMonthReport }

function ReportsPanel({
  bundle,
  onMonth,
}: {
  bundle: CheckinAdminBundle
  onMonth: (month: string) => void
}) {
  const [view, setView] = useState<'attendance' | 'exits'>('attendance')
  const [person, setPerson] = useState('all')
  const [search, setSearch] = useState('')

  const roster = useMemo(() => {
    const known = new Map(bundle.roster.map((r) => [r.uid, r]))
    for (const r of bundle.records) {
      if (!known.has(r.uid)) {
        known.set(r.uid, { uid: r.uid, name: r.name, role: r.role, department: r.department })
      }
    }
    return [...known.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [bundle.roster, bundle.records])

  const reports: StaffReport[] = useMemo(
    () =>
      roster.map((entry) => ({
        entry,
        report: buildMonthReport({
          month: bundle.month,
          records: bundle.records.filter((r) => r.uid === entry.uid),
          notices: bundle.messages.filter((m) => m.uid === entry.uid),
          settings: bundle.settings,
          terms: bundle.terms,
          today: bundle.today,
        }),
      })),
    [roster, bundle],
  )

  const q = search.trim().toLowerCase()
  const visible = reports.filter(
    (r) =>
      (person === 'all' || r.entry.uid === person) &&
      (!q || r.entry.name.toLowerCase().includes(q) || r.entry.department?.toLowerCase().includes(q)),
  )
  const selected = person === 'all' ? null : (reports.find((r) => r.entry.uid === person) ?? null)
  const events = bundle.events.filter((e) => person === 'all' || e.uid === person)
  const monthLabel = formatMonthLabel(bundle.month)
  const schoolDays = reports[0]?.report.workingDays ?? 0

  const exitSummary = useMemo(() => {
    const total = events.reduce((s, e) => s + (e.durationSeconds ?? 0), 0)
    const farthest = events.reduce((m, e) => Math.max(m, e.maxDistanceFromBoundary), 0)
    return `Total time outside ${formatDurationHuman(total)} · Exits ${events.length} · Farthest ${formatMeters(farthest)} beyond the boundary`
  }, [events])

  const fileBase = `staff-${view}-${bundle.month}${selected ? `-${selected.entry.name.replace(/\s+/g, '-').toLowerCase()}` : ''}`

  function exportAttendance(format: 'csv' | 'pdf') {
    if (selected) {
      const header = ['Date', 'Status', 'In', 'Out', 'Hours', 'Exits', 'Time outside', 'Note']
      const rows = [...selected.report.days].map((d) => [
        formatDayLabel(d.date),
        DAY_STATUS_LABEL[d.status] + (d.expected ? '' : ' (not a school day)'),
        d.record ? schoolClock(d.record.checkInAt) : '',
        d.record?.checkOutAt ? schoolClock(d.record.checkOutAt) : '',
        d.record ? formatDurationShort(secondsWorked(d.record)) : '',
        d.record?.exitCount ?? '',
        d.record ? formatDurationShort(d.record.secondsOutside) : '',
        d.notice ? `${d.notice.category}: ${d.notice.details}` : '',
      ])
      const r = selected.report
      const summary = `School days ${r.workingDays} · Present ${r.present} · Late ${r.late} · Absent ${r.absent} · With notice ${r.notified} · Rate ${r.rate}%`
      if (format === 'csv') downloadCsv(`${fileBase}.csv`, header, rows)
      else
        downloadTablePdf({
          fileName: `${fileBase}.pdf`,
          title: `Attendance — ${selected.entry.name}`,
          subtitle: `${monthLabel} · ${rosterLabel(selected.entry)}`,
          summary,
          header,
          rows,
          landscape: true,
        })
      return
    }
    const header = ['Staff member', 'Role', 'School days', 'Present', 'Late', 'Absent', 'With notice', 'Rate', 'Exits', 'Time outside']
    const rows = visible.map(({ entry, report }) => [
      entry.name,
      rosterLabel(entry),
      report.workingDays,
      report.present,
      report.late,
      report.absent,
      report.notified,
      `${report.rate}%`,
      report.exits,
      formatDurationShort(report.secondsOutside),
    ])
    if (format === 'csv') downloadCsv(`${fileBase}.csv`, header, rows)
    else
      downloadTablePdf({
        fileName: `${fileBase}.pdf`,
        title: 'Staff attendance report',
        subtitle: `${monthLabel} · ${schoolDays} school days · ${visible.length} staff`,
        header,
        rows,
        landscape: true,
      })
  }

  function exportExits(format: 'csv' | 'pdf') {
    const header = ['Date', 'Staff member', 'Checked in', 'Left', 'Returned', 'Time outside', 'Farthest beyond boundary', 'Reason']
    const checkInByKey = new Map(bundle.records.map((r) => [`${r.uid}_${r.date}`, r]))
    const rows = [...events].reverse().map((e) => [
      formatDayLabel(e.date),
      e.name,
      schoolClock(checkInByKey.get(`${e.uid}_${e.date}`)?.checkInAt),
      schoolClock(e.exitAt),
      e.returnAt ? schoolClock(e.returnAt) : 'Still out',
      e.status === 'OPEN' ? 'In progress' : formatDurationHuman(e.durationSeconds ?? 0),
      formatMeters(e.maxDistanceFromBoundary),
      e.reason ? `${e.reason}${e.reasonNote ? ` — ${e.reasonNote}` : ''}` : 'Not given',
    ])
    if (format === 'csv') downloadCsv(`${fileBase}.csv`, header, rows)
    else
      downloadTablePdf({
        fileName: `${fileBase}.pdf`,
        title: selected ? `Premises report — ${selected.entry.name}` : 'Premises report — all staff',
        subtitle: monthLabel,
        summary: exitSummary,
        header,
        rows,
        landscape: true,
      })
  }

  const exportFn = view === 'attendance' ? exportAttendance : exportExits

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <MonthPicker month={bundle.month} max={bundle.today.slice(0, 7)} onChange={onMonth} />
        <div className="flex flex-wrap gap-2">
          <Select value={view} onChange={(e) => setView(e.target.value as 'attendance' | 'exits')}>
            <option value="attendance">Monthly attendance</option>
            <option value="exits">Premises exits</option>
          </Select>
          <Select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Staff member">
            <option value="all">All staff</option>
            {roster.map((r) => (
              <option key={r.uid} value={r.uid}>
                {r.name}
              </option>
            ))}
          </Select>
          <Button variant="outline" onClick={() => exportFn('csv')}>
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" onClick={() => exportFn('pdf')}>
            <FileText className="h-4 w-4" />
            PDF
          </Button>
        </div>
      </div>

      {view === 'attendance' ? (
        selected ? (
          <PersonReport entry={selected.entry} report={selected.report} today={bundle.today} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{monthLabel}</CardTitle>
              <CardDescription>
                {schoolDays} school day{schoolDays === 1 ? '' : 's'} so far (working weekdays in term).
                Select a staff member for their day-by-day record.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <SearchInput
                id="staff-report-search"
                name="staff-report-search"
                value={search}
                onChange={setSearch}
                placeholder="Search staff…"
              />
              <DataTableShell>
                <DataTable>
                  <DataTableHead>
                    <tr>
                      <DataTableHeaderCell>Staff member</DataTableHeaderCell>
                      <DataTableHeaderCell className="text-right">Present</DataTableHeaderCell>
                      <DataTableHeaderCell className="text-right">Late</DataTableHeaderCell>
                      <DataTableHeaderCell className="text-right">Absent</DataTableHeaderCell>
                      <DataTableHeaderCell className="text-right">Notice</DataTableHeaderCell>
                      <DataTableHeaderCell className="text-right">Rate</DataTableHeaderCell>
                      <DataTableHeaderCell className="text-right">Off premises</DataTableHeaderCell>
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    {visible.map(({ entry, report }) => (
                      <DataTableRow
                        key={entry.uid}
                        className="cursor-pointer"
                        onClick={() => setPerson(entry.uid)}
                      >
                        <DataTableCell>
                          <p className="font-medium text-primary">{entry.name}</p>
                          <p className="text-[11px] text-muted-foreground">{rosterLabel(entry)}</p>
                        </DataTableCell>
                        <DataTableCell className="text-right tabular-nums">
                          {report.present}/{report.workingDays}
                        </DataTableCell>
                        <DataTableCell className="text-right tabular-nums">{report.late}</DataTableCell>
                        <DataTableCell className="text-right tabular-nums">{report.absent}</DataTableCell>
                        <DataTableCell className="text-right tabular-nums">{report.notified}</DataTableCell>
                        <DataTableCell className="text-right font-semibold tabular-nums">
                          {report.rate}%
                        </DataTableCell>
                        <DataTableCell className="text-right text-xs tabular-nums">
                          {report.exits > 0
                            ? `${report.exits} · ${formatDurationShort(report.secondsOutside)}`
                            : '—'}
                        </DataTableCell>
                      </DataTableRow>
                    ))}
                  </DataTableBody>
                </DataTable>
              </DataTableShell>
            </CardContent>
          </Card>
        )
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Premises exits · {monthLabel}</CardTitle>
            <CardDescription>{exitSummary}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No premises exits this month.</p>
            ) : (
              events.map((event) => (
                <div key={event.id}>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {formatDayLabel(event.date)}
                  </p>
                  <ExitRow event={event} showName={person === 'all'} />
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function PersonReport({
  entry,
  report,
  today,
}: {
  entry: CheckinRosterEntry
  report: CheckinMonthReport
  today: string
}) {
  const days = [...report.days].reverse()
  return (
    <div className="space-y-4">
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
          <CardTitle>{entry.name}</CardTitle>
          <CardDescription>
            {rosterLabel(entry)} · {report.label}
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
                      ? `${schoolClock(day.record.checkInAt)} → ${day.record.checkOutAt ? schoolClock(day.record.checkOutAt) : day.date === today ? 'on duty' : 'no check-out'} · ${formatDurationShort(secondsWorked(day.record))}${day.record.exitCount ? ` · ${day.record.exitCount} exit${day.record.exitCount === 1 ? '' : 's'}` : ''}`
                      : day.notice
                        ? `${day.notice.category}: ${day.notice.details}`
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
    </div>
  )
}

function InboxPanel({
  messages,
  onUpdated,
}: {
  messages: StaffCheckinMessage[]
  onUpdated: (message: StaffCheckinMessage) => void
}) {
  const [filter, setFilter] = useState<'active' | CheckinMessageStatus | 'all'>('active')
  const visible = messages.filter((m) =>
    filter === 'all' ? true : filter === 'active' ? m.status !== 'RESOLVED' : m.status === filter,
  )

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle>Messages from staff</CardTitle>
          <CardDescription>Absence notices and check-in problems.</CardDescription>
        </div>
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="sm:w-44"
          aria-label="Filter messages"
        >
          <option value="active">Open & seen</option>
          <option value="OPEN">Open</option>
          <option value="SEEN">Seen</option>
          <option value="RESOLVED">Resolved</option>
          <option value="all">All</option>
        </Select>
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
            <Inbox className="h-6 w-6" />
            No messages here.
          </div>
        ) : (
          visible.map((m) => <InboxItem key={m.id} message={m} onUpdated={onUpdated} />)
        )}
      </CardContent>
    </Card>
  )
}

function InboxItem({
  message,
  onUpdated,
}: {
  message: StaffCheckinMessage
  onUpdated: (message: StaffCheckinMessage) => void
}) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function update(key: string, input: { status?: CheckinMessageStatus; adminReply?: string }) {
    setBusy(key)
    try {
      onUpdated(await checkinService.updateMessage(message.id, input))
      if (input.adminReply !== undefined) setReply('')
    } catch (err) {
      notify.error('Could not update the message', errorText(err, 'Please try again.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <MessageCard message={message} showName>
      <div className="mt-2 space-y-2">
        <Textarea
          rows={2}
          maxLength={1000}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Reply to the staff member…"
          aria-label={`Reply to ${message.name}`}
        />
        <div className="flex flex-wrap justify-end gap-2">
          {message.status === 'OPEN' ? (
            <Button size="sm" variant="ghost" loading={busy === 'seen'} onClick={() => void update('seen', { status: 'SEEN' })}>
              Mark seen
            </Button>
          ) : null}
          {message.status !== 'RESOLVED' ? (
            <Button
              size="sm"
              variant="outline"
              loading={busy === 'resolve'}
              onClick={() => void update('resolve', { status: 'RESOLVED' })}
            >
              Resolve
            </Button>
          ) : (
            <Button size="sm" variant="ghost" loading={busy === 'reopen'} onClick={() => void update('reopen', { status: 'OPEN' })}>
              Reopen
            </Button>
          )}
          <Button
            size="sm"
            disabled={!reply.trim()}
            loading={busy === 'reply'}
            onClick={() => void update('reply', { adminReply: reply.trim() })}
          >
            Send reply
          </Button>
        </div>
      </div>
    </MessageCard>
  )
}

type LocationForm = {
  siteName: string
  latitude: string
  longitude: string
  radiusMeters: string
  requireInside: boolean
  trackLate: boolean
  lateAfter: string
  workingDays: number[]
}

function toForm(settings: CheckinSettings): LocationForm {
  return {
    siteName: settings.siteName,
    latitude: settings.latitude == null ? '' : String(settings.latitude),
    longitude: settings.longitude == null ? '' : String(settings.longitude),
    radiusMeters: String(settings.radiusMeters),
    requireInside: settings.requireInside,
    trackLate: settings.lateAfter !== '',
    lateAfter: settings.lateAfter || '07:30',
    workingDays: settings.workingDays,
  }
}

function LocationPanel({
  settings,
  onSaved,
}: {
  settings: CheckinSettings
  onSaved: (settings: CheckinSettings) => void
}) {
  const [form, setForm] = useState(() => toForm(settings))
  const [saving, setSaving] = useState(false)
  const [locating, setLocating] = useState(false)
  const [here, setHere] = useState<(GeoPoint & { accuracy: number | null }) | null>(null)

  const lat = Number(form.latitude)
  const lng = Number(form.longitude)
  const radius = Number(form.radiusMeters)
  const coordsValid =
    form.latitude.trim() !== '' &&
    form.longitude.trim() !== '' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  const radiusValid =
    Number.isInteger(radius) && radius >= MIN_GEOFENCE_RADIUS_M && radius <= MAX_GEOFENCE_RADIUS_M
  const preview =
    coordsValid && radiusValid
      ? { name: form.siteName || 'School premises', latitude: lat, longitude: lng, radiusMeters: radius }
      : null

  async function captureLocation() {
    setLocating(true)
    try {
      const result = await getCurrentLocation()
      if (!result.ok) {
        notify.error('Could not get your location', result.message)
        return
      }
      setHere(result.fix)
      setForm((f) => ({
        ...f,
        latitude: result.fix.latitude.toFixed(6),
        longitude: result.fix.longitude.toFixed(6),
      }))
      notify.success(
        'Location captured',
        result.fix.accuracy != null
          ? `Accurate to about ${Math.round(result.fix.accuracy)} m. Stand near the middle of the school for the best result.`
          : undefined,
      )
    } finally {
      setLocating(false)
    }
  }

  async function save() {
    if (!coordsValid) return notify.error('Enter a valid latitude and longitude')
    if (!radiusValid) {
      return notify.error(
        `Boundary radius must be ${MIN_GEOFENCE_RADIUS_M}–${MAX_GEOFENCE_RADIUS_M} m`,
      )
    }
    if (form.workingDays.length === 0) return notify.error('Choose at least one working day')
    setSaving(true)
    try {
      const saved = await checkinService.updateSettings({
        siteName: form.siteName.trim() || 'School premises',
        latitude: lat,
        longitude: lng,
        radiusMeters: radius,
        requireInside: form.requireInside,
        lateAfter: form.trackLate ? form.lateAfter : '',
        workingDays: form.workingDays,
      })
      onSaved(saved)
      setForm(toForm(saved))
      notify.success('Check-in settings saved')
    } catch (err) {
      notify.error('Could not save', errorText(err, 'Please try again.'))
    } finally {
      setSaving(false)
    }
  }

  function toggleDay(day: number, on: boolean) {
    setForm((f) => ({
      ...f,
      workingDays: on
        ? [...new Set([...f.workingDays, day])].sort()
        : f.workingDays.filter((d) => d !== day),
    }))
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>School location</CardTitle>
          <CardDescription>
            Staff check in and out inside this boundary. The easiest way to set it is to stand near the
            middle of the school and use your current location.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <Label htmlFor="site-name">Name</Label>
            <Input
              id="site-name"
              value={form.siteName}
              maxLength={80}
              onChange={(e) => setForm((f) => ({ ...f, siteName: e.target.value }))}
            />
          </Field>
          <Button variant="outline" loading={locating} onClick={() => void captureLocation()}>
            <LocateFixed className="h-4 w-4" />
            Use my current location
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label htmlFor="site-lat">Latitude</Label>
              <Input
                id="site-lat"
                inputMode="decimal"
                value={form.latitude}
                placeholder="-17.829200"
                onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
              />
            </Field>
            <Field>
              <Label htmlFor="site-lng">Longitude</Label>
              <Input
                id="site-lng"
                inputMode="decimal"
                value={form.longitude}
                placeholder="31.052200"
                onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
              />
            </Field>
          </div>
          <Field>
            <Label htmlFor="site-radius">Boundary radius (metres)</Label>
            <Input
              id="site-radius"
              type="number"
              min={MIN_GEOFENCE_RADIUS_M}
              max={MAX_GEOFENCE_RADIUS_M}
              step={5}
              value={form.radiusMeters}
              onChange={(e) => setForm((f) => ({ ...f, radiusMeters: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Make the circle cover the whole school grounds. GPS on phones is usually accurate to
              5–30 m, and a little of that is allowed for automatically.
            </p>
          </Field>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div>
              <Label htmlFor="require-inside">Only inside the boundary</Label>
              <p className="text-xs text-muted-foreground">
                Check-in and check-out are refused outside the school. Turn off to allow them anywhere
                (the distance is still recorded).
              </p>
            </div>
            <Switch
              id="require-inside"
              checked={form.requireInside}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, requireInside: checked }))}
            />
          </div>
          <div className="space-y-2 rounded-lg border border-border px-3 py-2.5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <Label htmlFor="track-late">Mark late arrivals</Label>
                <p className="text-xs text-muted-foreground">Check-ins after this time are marked late.</p>
              </div>
              <Switch
                id="track-late"
                checked={form.trackLate}
                onCheckedChange={(checked) => setForm((f) => ({ ...f, trackLate: checked }))}
              />
            </div>
            {form.trackLate ? (
              <Input
                type="time"
                className="w-36"
                value={form.lateAfter}
                onChange={(e) => setForm((f) => ({ ...f, lateAfter: e.target.value }))}
                aria-label="Late after"
              />
            ) : null}
          </div>
          <div className="space-y-2">
            <Label>Working days</Label>
            <div className="flex flex-wrap gap-3">
              {WEEKDAY_LABELS.map((label, day) => (
                <label key={label} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    id={`working-day-${day}`}
                    checked={form.workingDays.includes(day)}
                    onCheckedChange={(checked) => toggleDay(day, checked === true)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Reports count these weekdays during school terms (from Settings → Academic).
            </p>
          </div>
          <Button loading={saving} onClick={() => void save()}>
            Save settings
          </Button>
        </CardContent>
      </Card>
      <div className="space-y-2">
        {preview ? (
          <VicinityMap
            site={preview}
            location={here}
            outside={false}
            muted={!here}
          />
        ) : (
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border px-6 text-center text-sm text-muted-foreground sm:h-72">
            Enter the school’s coordinates or use your current location to preview the boundary.
          </div>
        )}
        {settings.updatedAt ? (
          <p className="text-xs text-muted-foreground">
            Last saved {formatDayLabel(schoolDate(settings.updatedAt))} {schoolClock(settings.updatedAt)}
          </p>
        ) : null}
      </div>
    </div>
  )
}
