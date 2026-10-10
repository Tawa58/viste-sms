import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Award,
  BookOpen,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  Clock,
  Download,
  FileText,
  Home,
  Lock,
  Mail,
  Megaphone,
  Phone,
  Puzzle,
  Receipt,
  ShieldCheck,
  Trophy,
  Users,
  Wallet,
} from 'lucide-react'
import { Alert } from '@/components/shared/alert'
import { EmptyState } from '@/components/shared/empty-state'
import { ResolvedAvatar } from '@/components/shared/resolved-avatar'
import { SchoolLogo } from '@/components/shared/school-logo'
import { StatCard } from '@/components/shared/stat-card'
import { invoiceBalance } from '@/lib/fees'
import {
  ATTENDANCE_LABEL,
  AttendanceBadge,
  PortalPage,
  latestResults,
  money,
  percent,
  scoreTone,
  shortDate,
} from '@/components/student-portal/portal-ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/contexts/auth-context'
import { notify } from '@/lib/notify'
import { downloadResultSheetPdf, formatMark, formatPercent } from '@/lib/result-sheet-pdf'
import { cn } from '@/lib/utils'
import { fileService } from '@/services/files'
import type {
  AttendanceStatus,
  Invoice,
  StudentPortalBundle,
  StudentPortalDocument,
  StudentResultPeriod,
  StudentResultPeriodKind,
} from '@/types'

const ASSESSMENT_TYPE_LABEL: Record<string, string> = {
  DAILY: 'Daily exercise',
  MONTHLY: 'Monthly test',
  WEEKLY: 'Weekly test',
  MOCK: 'Mock exam',
  TERMLY: 'End of term',
}

function assessmentType(type: string) {
  return ASSESSMENT_TYPE_LABEL[type] ?? type.charAt(0) + type.slice(1).toLowerCase()
}

function monthLabel(key: string) {
  const date = new Date(`${key}-01T12:00:00`)
  return Number.isNaN(date.getTime())
    ? key
    : date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

function DetailList({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-border">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[minmax(7rem,40%)_1fr] gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words font-medium">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

function TableShell({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[34rem] text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  )
}

/* ---------- My Profile ---------- */

export function MyProfilePage() {
  const { user } = useAuth()
  return (
    <PortalPage title="My Profile" description="Your personal, school and guardian details on record.">
      {({ profile }) => (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center">
              <ResolvedAvatar
                name={`${profile.firstName} ${profile.lastName}`}
                fileId={profile.profilePhotoId}
                access={user ? { userId: user.id, role: user.role, studentId: user.studentId ?? profile.id } : null}
                className="h-16 w-16 text-lg"
              />
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-xl font-semibold">
                  {[profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {[profile.className, profile.streamName].filter(Boolean).join(' • ')} · {profile.studentNumber}
                </p>
              </div>
              <Badge variant={profile.status === 'ACTIVE' ? 'success' : 'secondary'}>
                {profile.status.charAt(0) + profile.status.slice(1).toLowerCase()}
              </Badge>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Personal details</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailList
                  rows={[
                    ['Date of birth', shortDate(profile.dateOfBirth)],
                    ['Gender', profile.gender],
                    ['Email', profile.email],
                    ['Phone', profile.phone],
                    ['Home address', profile.address],
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">School details</CardTitle>
              </CardHeader>
              <CardContent>
                <DetailList
                  rows={[
                    ['Student number', profile.studentNumber],
                    ['Admission number', profile.admissionNumber],
                    ['Admitted', shortDate(profile.admissionDate)],
                    ['Class', [profile.className, profile.streamName].filter(Boolean).join(' • ')],
                    ['Level', profile.levelName],
                    ['Class teacher', profile.classTeacherName],
                    ['House', profile.houseName],
                    [
                      'Residency',
                      profile.residency === 'BOARDER'
                        ? 'Boarder'
                        : profile.residency === 'NON_FORMAL'
                          ? 'Non-formal'
                          : 'Day scholar',
                    ],
                  ]}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Parents & guardians</CardTitle>
            </CardHeader>
            <CardContent>
              {profile.guardians.length === 0 ? (
                <p className="text-sm text-muted-foreground">No guardians are linked to your record.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {profile.guardians.map((g) => (
                    <div key={`${g.name}-${g.phone}`} className="rounded-xl border border-border p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{g.name}</p>
                          <p className="text-xs text-muted-foreground">{g.relationship}</p>
                        </div>
                        {g.emergencyContact ? <Badge variant="accent">Emergency contact</Badge> : null}
                      </div>
                      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                        {g.phone ? (
                          <p className="flex items-center gap-2">
                            <Phone className="h-3.5 w-3.5" /> {g.phone}
                          </p>
                        ) : null}
                        {g.email ? (
                          <p className="flex items-center gap-2 break-all">
                            <Mail className="h-3.5 w-3.5 shrink-0" /> {g.email}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            Something wrong or out of date? Ask the school office to update your record.
          </p>
        </div>
      )}
    </PortalPage>
  )
}

/* ---------- Results ---------- */

const PERIOD_KINDS: { kind: StudentResultPeriodKind; label: string; picker: string }[] = [
  { kind: 'TERM', label: 'Term', picker: 'Select term' },
  { kind: 'MONTH', label: 'Month', picker: 'Select month' },
  { kind: 'YEAR', label: 'Year', picker: 'Select year' },
]

function ResultDetailsTable({ details }: { details: [string, string][] }) {
  const pairs = [details.slice(0, 2), details.slice(2, 4)]
  const label = 'bg-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm sm:hidden">
        <tbody className="divide-y divide-border">
          {details.map(([k, v]) => (
            <tr key={k}>
              <th scope="row" className={cn(label, 'w-2/5 text-left')}>
                {k}
              </th>
              <td className="px-3 py-2 font-medium">{v || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="hidden w-full text-sm sm:table">
        <tbody className="divide-y divide-border">
          {pairs.map((row) => (
            <tr key={row[0][0]}>
              {row.map(([k, v]) => (
                <Fragment key={k}>
                  <th scope="row" className={cn(label, 'w-[16%] text-left')}>
                    {k}
                  </th>
                  <td className="w-[34%] px-3 py-2 font-medium">{v || '—'}</td>
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ResultSheet({ data, period }: { data: StudentPortalBundle; period: StudentResultPeriod }) {
  const { profile, school } = data
  const best = [...period.rows].sort((a, b) => b.percent - a.percent)[0]
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="Average" value={formatPercent(period.average)} icon={Award} tone="success" />
        <StatCard label="Overall grade" value={period.averageGrade ?? '—'} icon={Trophy} tone="accent" />
        <StatCard label="Subjects" value={String(period.rows.length)} icon={BookOpen} />
        <StatCard label="Best subject" value={best?.subject ?? '—'} hint={best ? formatPercent(best.percent) : undefined} icon={Award} tone="success" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border/70 bg-muted/30 px-4 py-4 sm:px-5">
          <SchoolLogo size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-lg font-semibold leading-tight">{school.name}</p>
            <p className="text-xs text-muted-foreground">
              Results sheet · {period.label} · {period.basis}
            </p>
          </div>
        </div>
        <CardContent className="space-y-4 pt-4 sm:pt-5">
          <ResultDetailsTable
            details={[
              ['Student name', [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ')],
              ['Reg. number', profile.studentNumber],
              ['Class', [profile.className, profile.streamName].filter(Boolean).join(' ')],
              [PERIOD_KINDS.find((k) => k.kind === period.kind)?.label ?? 'Period', period.label],
            ]}
          />

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2.5 text-center font-medium">#</th>
                  <th className="px-3 py-2.5 font-medium">Subject</th>
                  <th className="px-3 py-2.5 text-center font-medium">Mark</th>
                  <th className="px-3 py-2.5 text-center font-medium">%</th>
                  <th className="px-3 py-2.5 text-center font-medium">Grade</th>
                  <th className="px-3 py-2.5 font-medium">Subject teacher</th>
                  <th className="px-3 py-2.5 font-medium">Teacher's comment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {period.rows.map((r, i) => (
                  <tr key={r.subject} className="align-top even:bg-muted/20">
                    <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-2.5 font-medium">{r.subject}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-center tabular-nums text-muted-foreground">
                      {formatMark(r.score, r.maxScore)}
                    </td>
                    <td className="px-3 py-2.5 text-center font-medium tabular-nums">{formatPercent(r.percent)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <Badge variant={scoreTone(r.percent)} className="min-w-8 justify-center">
                        {r.grade}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.teacherName ?? '—'}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{r.comment ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/40 font-semibold">
                <tr>
                  <td />
                  <td className="px-3 py-2.5">
                    Average ({period.rows.length} subject{period.rows.length === 1 ? '' : 's'})
                  </td>
                  <td />
                  <td className="px-3 py-2.5 text-center tabular-nums">{formatPercent(period.average)}</td>
                  <td className="px-3 py-2.5 text-center">
                    {period.averageGrade ? (
                      <Badge variant={scoreTone(period.average ?? 0)} className="min-w-8 justify-center">
                        {period.averageGrade}
                      </Badge>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
            <p className="text-sm font-medium">Class teacher's comment</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
              {period.classTeacherComment ?? 'No comment recorded yet.'}
            </p>
            {period.classTeacherComment && profile.classTeacherName ? (
              <p className="mt-1.5 text-xs text-muted-foreground">— {profile.classTeacherName}</p>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ResultsBody({ data }: { data: StudentPortalBundle }) {
  const { results, resultPeriods } = data
  const available = PERIOD_KINDS.filter((k) => resultPeriods.some((p) => p.kind === k.kind))
  const [kind, setKind] = useState<StudentResultPeriodKind>(available[0]?.kind ?? 'TERM')
  const options = resultPeriods.filter((p) => p.kind === kind)
  const [selectedId, setSelectedId] = useState<string>(options[0]?.id ?? '')
  const period = options.find((p) => p.id === selectedId) ?? options[0]
  const [downloading, setDownloading] = useState(false)

  function changeKind(next: StudentResultPeriodKind) {
    setKind(next)
    setSelectedId(resultPeriods.find((p) => p.kind === next)?.id ?? '')
  }

  async function download() {
    if (!period) return
    setDownloading(true)
    try {
      await downloadResultSheetPdf(data, period)
    } catch (err) {
      notify.error('Could not create the results sheet', err instanceof Error ? err.message : undefined)
    } finally {
      setDownloading(false)
    }
  }

  if (results.accessState === 'RESULTS_LOCKED_FEES') {
    return (
      <EmptyState
        icon={Lock}
        title="Results locked"
        description="Your results have been published, but they stay hidden until outstanding fees are cleared. Check your fees statement or speak to the bursar."
      />
    )
  }
  if (!period) {
    return (
      <EmptyState
        icon={Trophy}
        title="No results released yet"
        description="Your teachers may have entered marks already. They appear here once the school approves and releases them."
      />
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:p-4">
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">View results by</p>
            <div className="inline-flex rounded-lg bg-muted p-1" role="tablist" aria-label="Results period">
              {PERIOD_KINDS.map((k) => {
                const enabled = available.some((a) => a.kind === k.kind)
                return (
                  <button
                    key={k.kind}
                    type="button"
                    role="tab"
                    aria-selected={kind === k.kind}
                    disabled={!enabled}
                    onClick={() => changeKind(k.kind)}
                    className={cn(
                      'rounded-md px-4 py-1.5 text-sm font-medium text-muted-foreground transition-all disabled:cursor-not-allowed disabled:opacity-40',
                      kind === k.kind && 'bg-card text-foreground shadow-sm',
                    )}
                  >
                    {k.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-xs">
            <p className="text-xs font-medium text-muted-foreground">
              {PERIOD_KINDS.find((k) => k.kind === kind)?.picker}
            </p>
            <Select value={period.id} onChange={(e) => setSelectedId(e.target.value)} aria-label="Results period">
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <Button className="sm:ml-auto" loading={downloading} onClick={() => void download()}>
            <Download className="h-4 w-4" /> Download results sheet
          </Button>
        </CardContent>
      </Card>

      <ResultSheet data={data} period={period} />
    </div>
  )
}

export function MyResultsPage() {
  return (
    <PortalPage title="Results" description="Choose a term, month or year and download your official results sheet.">
      {(data) => <ResultsBody data={data} />}
    </PortalPage>
  )
}

/* ---------- Attendance ---------- */

const CELL_TONE: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-success/15 text-success',
  LATE: 'bg-warning/15 text-warning',
  ABSENT: 'bg-destructive/15 text-destructive',
  EXCUSED: 'bg-muted text-muted-foreground',
  AUTHORIZED_ABSENCE: 'bg-muted text-muted-foreground',
}

function AttendanceMonth({ month, byDate }: { month: string; byDate: Map<string, AttendanceStatus> }) {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y!, m!, 0).getDate()
  const cells: (string | null)[] = []
  const firstWeekday = (new Date(y!, m! - 1, 1).getDay() + 6) % 7
  for (let i = 0; i < Math.min(firstWeekday, 5); i++) cells.push(null)
  for (let d = 1; d <= days; d++) {
    const weekday = (new Date(y!, m! - 1, d).getDay() + 6) % 7
    if (weekday > 4) continue
    cells.push(`${month}-${String(d).padStart(2, '0')}`)
  }
  return (
    <Card>
      <CardHeader className="py-3 sm:py-3">
        <CardTitle className="text-base">{monthLabel(month)}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-5 gap-1.5 text-center text-[11px] text-muted-foreground">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
            <span key={d}>{d}</span>
          ))}
          {cells.map((date, i) => {
            if (!date) return <span key={`blank-${i}`} />
            const status = byDate.get(date)
            return (
              <span
                key={date}
                title={status ? `${shortDate(date)} · ${ATTENDANCE_LABEL[status]}` : shortDate(date)}
                className={cn(
                  'flex h-8 items-center justify-center rounded-md text-xs font-medium',
                  status ? CELL_TONE[status] : 'text-muted-foreground/60',
                )}
              >
                {Number(date.slice(8))}
              </span>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function AttendanceBody({ data }: { data: StudentPortalBundle }) {
  const { attendance, term } = data
  const byDate = useMemo(
    () => new Map(attendance.records.map((r) => [r.date, r.status])),
    [attendance.records],
  )
  const months = useMemo(
    () => [...new Set(attendance.records.map((r) => r.date.slice(0, 7)))].sort().reverse(),
    [attendance.records],
  )
  const missed = attendance.records.filter((r) => r.status !== 'PRESENT').slice(0, 20)

  if (attendance.records.length === 0) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="No registers yet"
        description="Your attendance appears here once your class teacher marks the daily register."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label={term ? `${term.name} attendance` : 'Attendance rate'}
          value={percent(attendance.rate)}
          icon={CalendarCheck}
          tone="success"
        />
        <StatCard label="Present" value={String(attendance.present)} icon={ShieldCheck} tone="success" />
        <StatCard label="Late" value={String(attendance.late)} icon={Clock} tone="warning" />
        <StatCard
          label="Absent / excused"
          value={`${attendance.absent} / ${attendance.excused}`}
          icon={CalendarX}
          tone="accent"
        />
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as AttendanceStatus[]).map((s) => (
          <span key={s} className={cn('rounded-md px-2 py-1 font-medium', CELL_TONE[s])}>
            {ATTENDANCE_LABEL[s]}
          </span>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {months.slice(0, 6).map((m) => (
          <AttendanceMonth key={m} month={m} byDate={byDate} />
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Days missed or late</CardTitle>
          <CardDescription>Your most recent absences and late arrivals.</CardDescription>
        </CardHeader>
        <CardContent>
          {missed.length === 0 ? (
            <p className="text-sm text-muted-foreground">Perfect record — you haven't missed a day.</p>
          ) : (
            <ul className="divide-y divide-border">
              {missed.map((r) => (
                <li key={r.date} className="flex items-center justify-between py-2 text-sm">
                  <span>{shortDate(r.date)}</span>
                  <AttendanceBadge status={r.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function MyAttendancePage() {
  return (
    <PortalPage title="Attendance" description="Your daily register, month by month.">
      {(data) => <AttendanceBody data={data} />}
    </PortalPage>
  )
}

/* ---------- Timetable ---------- */

export function MyTimetablePage() {
  const navigate = useNavigate()
  return (
    <PortalPage title="Timetable" description="Your weekly class schedule.">
      {(data) => (
        <div className="space-y-4">
          <EmptyState
            icon={CalendarClock}
            title="Timetable not published yet"
            description={`The timetable for ${data.profile.className} will appear here once the school publishes it. Until then, your subjects and teachers are listed on the Subjects page.`}
            actionLabel="View my subjects"
            onAction={() => navigate('/my/subjects')}
          />
        </div>
      )}
    </PortalPage>
  )
}

/* ---------- Subjects ---------- */

export function MySubjectsPage() {
  return (
    <PortalPage title="Subjects" description="The subjects you are registered for and who teaches them.">
      {(data) => {
        if (data.subjects.length === 0) {
          return (
            <EmptyState
              icon={BookOpen}
              title="No subjects registered"
              description="Your subjects appear here once the school registers them for your class."
            />
          )
        }
        const latest = latestResults(data.results)
        const scoreFor = new Map(latest?.rows.map((r) => [r.subject.toLowerCase(), r]) ?? [])
        return (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.subjects.map((s) => {
              const result = scoreFor.get(s.name.toLowerCase())
              return (
                <Card key={s.id}>
                  <CardContent className="flex h-full flex-col gap-3 p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <span className="rounded-lg bg-primary/10 p-2 text-primary">
                          <BookOpen className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="font-medium leading-tight">{s.name}</p>
                          <p className="text-xs text-muted-foreground">{s.category}</p>
                        </div>
                      </div>
                      {s.code ? <Badge variant="outline">{s.code}</Badge> : null}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      <Users className="mr-1.5 inline h-3.5 w-3.5" />
                      {s.teachers.length ? s.teachers.join(', ') : 'Teacher not assigned yet'}
                    </p>
                    {result ? (
                      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
                        <span>Latest · {latest?.label}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium tabular-nums text-foreground">{percent(result.pct)}</span>
                          <Badge variant={scoreTone(result.pct)} className="min-w-8 justify-center">
                            {result.grade}
                          </Badge>
                        </span>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )
      }}
    </PortalPage>
  )
}

/* ---------- Fees ---------- */

function invoiceBadge(invoice: Invoice) {
  const variant =
    invoice.status === 'PAID'
      ? 'success'
      : invoice.status === 'OVERDUE'
        ? 'danger'
        : invoice.status === 'PARTIAL'
          ? 'warning'
          : 'secondary'
  return <Badge variant={variant}>{invoice.status.charAt(0) + invoice.status.slice(1).toLowerCase()}</Badge>
}

export function MyFeesPage() {
  return (
    <PortalPage title="Fees" description="Your fee statement, invoices and payments.">
      {({ fees }) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatCard label="Current period billed" value={money(fees.billed, fees.currency)} icon={Receipt} />
            <StatCard label="Current period paid" value={money(fees.paid, fees.currency)} icon={Wallet} tone="success" />
            <StatCard
              label="Scholarship covered"
              value={money(fees.scholarshipAmount ?? 0, fees.currency)}
              icon={Award}
              tone="success"
            />
            <StatCard
              label="Current period balance"
              value={money(fees.balance, fees.currency)}
              hint={fees.nextDueDate && fees.balance > 0 ? `Due ${shortDate(fees.nextDueDate)}` : undefined}
              icon={Wallet}
              tone={fees.balance > 0 ? 'warning' : 'success'}
            />
          </div>

          {fees.invoices.length > 0 ? (
            fees.cleared ? (
              <Alert title="Current fees cleared" tone="success">
                {fees.scholarshipAmount
                  ? `Scholarship coverage of ${money(fees.scholarshipAmount, fees.currency)} has been applied.`
                  : 'Thank you — your account is fully paid up.'}
              </Alert>
            ) : (
              <Alert title="Balance outstanding" tone="warning">
                {money(fees.balance, fees.currency)} is still owed
                {fees.nextDueDate ? `, due ${shortDate(fees.nextDueDate)}` : ''}. Payments are made at the
                school bursary; your statement updates once a payment is recorded.
              </Alert>
            )
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              {fees.invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">No fees have been billed to your account.</p>
              ) : (
                <TableShell head={['Invoice', 'Term', 'Due', 'Amount', 'Paid', 'Scholarship', 'Balance', 'Status']}>
                  {fees.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-4 py-2.5 font-medium">{inv.number}</td>
                      <td className="px-4 py-2.5">
                        {[inv.termName, inv.period].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td className="px-4 py-2.5">{shortDate(inv.dueDate)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{money(inv.total, fees.currency)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{money(inv.paid, fees.currency)}</td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {money(inv.scholarshipAmount ?? 0, fees.currency)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {money(invoiceBalance(inv), fees.currency)}
                      </td>
                      <td className="px-4 py-2.5">{invoiceBadge(inv)}</td>
                    </tr>
                  ))}
                </TableShell>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {fees.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                <TableShell head={['Date', 'Receipt', 'Method', 'Amount', 'Status']}>
                  {fees.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-2.5">{shortDate(p.paidAt)}</td>
                      <td className="px-4 py-2.5 font-medium">{p.receiptNumber}</td>
                      <td className="px-4 py-2.5">{p.method}</td>
                      <td className="px-4 py-2.5 tabular-nums">{money(p.amount, fees.currency)}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={p.status === 'CONFIRMED' ? 'success' : p.status === 'PENDING' ? 'warning' : 'secondary'}>
                          {p.status.charAt(0) + p.status.slice(1).toLowerCase()}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </TableShell>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PortalPage>
  )
}

/* ---------- Exams ---------- */

export function MyExamsPage() {
  return (
    <PortalPage title="Exams" description="Tests and examinations for your class, and your marks once released.">
      {({ exams, results }) => {
        if (exams.length === 0) {
          return (
            <EmptyState
              icon={Trophy}
              title="No exams yet"
              description="Tests and examinations for your class appear here as your teachers set them."
            />
          )
        }
        const marking = exams.filter((e) => e.status === 'MARKING')
        const released = exams.filter((e) => e.status === 'RESULTS_OUT')
        const locked = results.accessState === 'RESULTS_LOCKED_FEES'
        return (
          <div className="space-y-4">
            {locked ? (
              <Alert title="Marks hidden" tone="warning">
                Released marks stay hidden until outstanding fees are cleared.
              </Alert>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Being marked</CardTitle>
                <CardDescription>Your teachers are still marking or reviewing these.</CardDescription>
              </CardHeader>
              <CardContent>
                {marking.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing waiting on marks.</p>
                ) : (
                  <TableShell head={['Assessment', 'Subject', 'Type', 'When', 'Status']}>
                    {marking.map((e) => (
                      <tr key={e.id}>
                        <td className="px-4 py-2.5 font-medium">{e.name}</td>
                        <td className="px-4 py-2.5">{e.subject}</td>
                        <td className="px-4 py-2.5">{assessmentType(e.type)}</td>
                        <td className="px-4 py-2.5">{e.month ? monthLabel(e.month) : (e.termName ?? '—')}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="secondary">Marking</Badge>
                        </td>
                      </tr>
                    ))}
                  </TableShell>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Results released</CardTitle>
              </CardHeader>
              <CardContent>
                {released.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No marks released yet.</p>
                ) : (
                  <TableShell head={['Assessment', 'Subject', 'Type', 'When', 'Score', 'Grade']}>
                    {released.map((e) => (
                      <tr key={e.id}>
                        <td className="px-4 py-2.5 font-medium">{e.name}</td>
                        <td className="px-4 py-2.5">{e.subject}</td>
                        <td className="px-4 py-2.5">{assessmentType(e.type)}</td>
                        <td className="px-4 py-2.5">{e.month ? monthLabel(e.month) : (e.termName ?? '—')}</td>
                        <td className="px-4 py-2.5 tabular-nums">
                          {e.score != null ? `${e.score}/${e.maxScore}` : locked ? 'Hidden' : '—'}
                        </td>
                        <td className="px-4 py-2.5">
                          {e.grade ? (
                            <Badge variant={scoreTone(e.maxScore > 0 && e.score != null ? (e.score / e.maxScore) * 100 : 0)}>
                              {e.grade}
                            </Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </TableShell>
                )}
              </CardContent>
            </Card>
          </div>
        )
      }}
    </PortalPage>
  )
}

/* ---------- Announcements ---------- */

export function MyAnnouncementsPage() {
  return (
    <PortalPage title="Announcements" description="News and notices from the school.">
      {({ announcements }) =>
        announcements.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No announcements"
            description="School notices for students will appear here."
          />
        ) : (
          <div className="space-y-3">
            {announcements.map((a) => (
              <Card key={a.id}>
                <CardContent className="space-y-2 p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-display text-base font-semibold">{a.title}</h3>
                    {a.publishedAt ? (
                      <span className="text-xs text-muted-foreground">{shortDate(a.publishedAt)}</span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{a.body}</p>
                  <p className="text-xs text-muted-foreground">— {a.author}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      }
    </PortalPage>
  )
}

/* ---------- Documents ---------- */

const DOCUMENT_TYPE_LABEL: Record<string, string> = {
  report_pdf: 'Report',
  certificate: 'Certificate',
  school_document: 'School document',
  attachment: 'Attachment',
  other: 'Document',
}

function fileSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function DocumentsBody({ documents, studentId }: { documents: StudentPortalDocument[]; studentId: string }) {
  const { user } = useAuth()
  const [busy, setBusy] = useState<string | null>(null)

  async function download(doc: StudentPortalDocument) {
    if (!user) return
    setBusy(doc.id)
    try {
      await fileService.downloadFile(doc.id, {
        userId: user.id,
        role: user.role,
        studentId: user.studentId ?? studentId,
      })
    } catch (err) {
      notify.error('Could not download', err instanceof Error ? err.message : undefined)
    } finally {
      setBusy(null)
    }
  }

  if (documents.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No documents yet"
        description="Report cards, certificates and other documents the school shares with you will appear here."
      />
    )
  }
  return (
    <Card>
      <CardContent className="p-0 sm:p-0">
        <ul className="divide-y divide-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="rounded-lg bg-primary/10 p-2 text-primary">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {DOCUMENT_TYPE_LABEL[doc.fileType] ?? 'Document'} · {fileSize(doc.sizeBytes)} ·{' '}
                  {shortDate(doc.uploadedAt)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                loading={busy === doc.id}
                onClick={() => void download(doc)}
              >
                <Download className="h-4 w-4" /> <span className="hidden sm:inline">Download</span>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function MyDocumentsPage() {
  return (
    <PortalPage title="Documents" description="Reports, certificates and files the school has shared with you.">
      {(data) => <DocumentsBody documents={data.documents} studentId={data.profile.id} />}
    </PortalPage>
  )
}

/* ---------- Activities ---------- */

export function MyActivitiesPage() {
  return (
    <PortalPage title="Activities" description="Your house, sports teams, clubs and societies.">
      {({ activities }) => {
        const { house, sports, clubs } = activities
        if (!house && sports.length === 0 && clubs.length === 0) {
          return (
            <EmptyState
              icon={Puzzle}
              title="No activities yet"
              description="Sports, clubs and your house appear here once the school signs you up."
            />
          )
        }
        return (
          <div className="space-y-4">
            {house ? (
              <Card className="overflow-hidden">
                <CardContent className="flex items-center gap-4 p-5">
                  <span
                    className="flex h-12 w-12 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: house.color || 'var(--primary)' }}
                  >
                    <Home className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">My house</p>
                    <p className="font-display text-lg font-semibold">{house.name}</p>
                  </div>
                </CardContent>
              </Card>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Sports</CardTitle>
                </CardHeader>
                <CardContent>
                  {sports.length === 0 ? (
                    <p className="text-sm text-muted-foreground">You're not on any sports team yet.</p>
                  ) : (
                    <ul className="space-y-3">
                      {sports.map((s) => (
                        <li key={s.id} className="rounded-xl border border-border p-3">
                          <p className="font-medium">{s.name}</p>
                          {s.description ? <p className="text-sm text-muted-foreground">{s.description}</p> : null}
                          {s.coachName ? <p className="mt-1 text-xs text-muted-foreground">Coach: {s.coachName}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Clubs & societies</CardTitle>
                </CardHeader>
                <CardContent>
                  {clubs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">You haven't joined any clubs yet.</p>
                  ) : (
                    <ul className="space-y-3">
                      {clubs.map((c) => (
                        <li key={c.id} className="rounded-xl border border-border p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium">{c.name}</p>
                            <Badge variant="outline">{c.type.charAt(0) + c.type.slice(1).toLowerCase()}</Badge>
                          </div>
                          {c.description ? <p className="text-sm text-muted-foreground">{c.description}</p> : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )
      }}
    </PortalPage>
  )
}
