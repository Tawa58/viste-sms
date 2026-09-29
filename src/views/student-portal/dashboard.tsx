import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarCheck,
  Lock,
  Megaphone,
  Trophy,
  Wallet,
} from 'lucide-react'
import { EmptyState } from '@/components/shared/empty-state'
import { LoadingState } from '@/components/shared/loading-state'
import { ResolvedAvatar } from '@/components/shared/resolved-avatar'
import { FadeIn } from '@/components/shared/page-transition'
import {
  ATTENDANCE_LABEL,
  ProgressBar,
  averageScore,
  greeting,
  latestResults,
  money,
  percent,
  scoreTone,
  shortDate,
} from '@/components/student-portal/portal-ui'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/contexts/auth-context'
import { useStudentPortal } from '@/contexts/student-portal-context'
import { cn } from '@/lib/utils'
import type { AttendanceStatus, StudentPortalBundle } from '@/types'

function PortalStat({
  icon: Icon,
  label,
  value,
  hint,
  progress,
  tone,
  to,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint: string
  progress?: number | null
  tone: 'primary' | 'success' | 'accent' | 'warning'
  to: string
}) {
  return (
    <Link to={to} className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full transition-shadow group-hover:shadow-elevated">
        <CardContent className="flex h-full flex-col gap-2.5 p-3.5 sm:gap-3 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">
              {label}
            </p>
            <span
              className={cn(
                'shrink-0 rounded-lg p-1.5 sm:p-2',
                tone === 'primary' && 'bg-primary/10 text-primary',
                tone === 'success' && 'bg-success/10 text-success',
                tone === 'accent' && 'bg-accent/10 text-accent',
                tone === 'warning' && 'bg-warning/10 text-warning',
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
          </div>
          <p className="truncate font-display text-xl font-semibold tracking-tight sm:text-3xl">{value}</p>
          {progress != null ? <ProgressBar value={progress} tone={tone} /> : null}
          <p className="mt-auto text-[11px] leading-snug text-muted-foreground sm:text-xs">{hint}</p>
        </CardContent>
      </Card>
    </Link>
  )
}

function SectionLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      {label} <ArrowRight className="h-3 w-3" />
    </Link>
  )
}

const DOT_TONE: Record<AttendanceStatus, string> = {
  PRESENT: 'bg-success',
  LATE: 'bg-warning',
  ABSENT: 'bg-destructive',
  EXCUSED: 'bg-muted-foreground/50',
  AUTHORIZED_ABSENCE: 'bg-muted-foreground/50',
}

function RecentResults({ data }: { data: StudentPortalBundle }) {
  const latest = latestResults(data.results)
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Recent results</CardTitle>
          <p className="text-xs text-muted-foreground">{latest?.label ?? 'Published marks'}</p>
        </div>
        <SectionLink to="/my/results" label="All results" />
      </CardHeader>
      <CardContent>
        {data.results.accessState === 'RESULTS_LOCKED_FEES' ? (
          <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/5 p-4">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="text-sm">
              <p className="font-medium">Results are locked</p>
              <p className="text-muted-foreground">
                Your results are ready, but they stay hidden until outstanding fees are cleared.{' '}
                <Link to="/my/fees" className="font-medium text-primary hover:underline">
                  View fees
                </Link>
              </p>
            </div>
          </div>
        ) : !latest ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            No results have been released yet. They will appear here as soon as your teachers publish them.
          </p>
        ) : (
          <ul className="space-y-3.5">
            {latest.rows.slice(0, 6).map((row) => (
              <li key={row.subject} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{row.subject}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular-nums text-muted-foreground">{percent(row.pct)}</span>
                    <Badge variant={scoreTone(row.pct)} className="min-w-8 justify-center">
                      {row.grade}
                    </Badge>
                  </span>
                </div>
                <ProgressBar value={row.pct} tone={scoreTone(row.pct)} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function LatestAnnouncements({ data }: { data: StudentPortalBundle }) {
  const items = data.announcements.slice(0, 3)
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="h-4 w-4 text-accent" /> Latest announcements
        </CardTitle>
        <SectionLink to="/my/announcements" label="All" />
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No announcements right now.</p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((a) => (
              <li key={a.id} className="py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium leading-snug">{a.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.body}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {a.author}
                  {a.publishedAt ? ` · ${shortDate(a.publishedAt)}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function RecentAttendance({ data }: { data: StudentPortalBundle }) {
  const recent = data.attendance.records.slice(0, 10).reverse()
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Last 10 school days</CardTitle>
        <SectionLink to="/my/attendance" label="History" />
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">No registers have been marked yet.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {recent.map((r) => (
                <span
                  key={r.date}
                  title={`${shortDate(r.date)} · ${ATTENDANCE_LABEL[r.status]}`}
                  className={cn('h-7 w-7 rounded-md', DOT_TONE[r.status])}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success" />Present {data.attendance.present}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warning" />Late {data.attendance.late}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-destructive" />Absent {data.attendance.absent}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function FeesSummary({ data }: { data: StudentPortalBundle }) {
  const { fees } = data
  const paidPct = fees.billed > 0 ? (fees.paid / fees.billed) * 100 : 100
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Fees</CardTitle>
        <SectionLink to="/my/fees" label="Statement" />
      </CardHeader>
      <CardContent className="space-y-3">
        {fees.invoices.length === 0 ? (
          <p className="text-sm text-muted-foreground">No fees have been billed to your account.</p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-2 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Paid</p>
                <p className="font-semibold">{money(fees.paid, fees.currency)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Balance</p>
                <p className={cn('font-semibold', fees.balance > 0 ? 'text-warning' : 'text-success')}>
                  {money(fees.balance, fees.currency)}
                </p>
              </div>
            </div>
            <ProgressBar value={paidPct} tone={fees.cleared ? 'success' : 'warning'} />
            <p className="text-xs text-muted-foreground">
              {fees.cleared
                ? 'All fees are cleared. Thank you!'
                : fees.nextDueDate
                  ? `Next payment due ${shortDate(fees.nextDueDate)}`
                  : 'Please clear the outstanding balance.'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function MyClass({ data }: { data: StudentPortalBundle }) {
  const { profile } = data
  const rows = [
    ['Class', profile.className],
    ['Class teacher', profile.classTeacherName],
    ['House', profile.houseName],
    ['Student no.', profile.studentNumber],
  ].filter((r): r is [string, string] => Boolean(r[1]))
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">My class</CardTitle>
        <SectionLink to="/my/profile" label="Profile" />
      </CardHeader>
      <CardContent>
        <dl className="space-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

export function StudentDashboardPage() {
  const { user } = useAuth()
  const { data, loading, error, reload } = useStudentPortal()

  if (!data) {
    return loading ? (
      <LoadingState message="Loading your portal…" />
    ) : (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load your portal"
        description={error ?? 'Check your connection and try again.'}
        actionLabel="Try again"
        onAction={() => void reload()}
      />
    )
  }

  const { profile, attendance, fees, term } = data
  const average = averageScore(data.results)
  const classLine = [profile.className, profile.streamName].filter(Boolean).join(' • ')
  const resultsLocked = data.results.accessState === 'RESULTS_LOCKED_FEES'

  return (
    <div className="space-y-5">
      <FadeIn>
        <Card className="overflow-hidden">
          <CardContent className="relative flex flex-col gap-4 bg-gradient-to-br from-primary/10 via-card to-accent/10 p-5 sm:flex-row sm:items-center sm:p-6">
            <ResolvedAvatar
              name={`${profile.firstName} ${profile.lastName}`}
              fileId={profile.profilePhotoId}
              access={
                user
                  ? { userId: user.id, role: user.role, studentId: user.studentId ?? profile.id }
                  : null
              }
              className="h-14 w-14 text-lg ring-4 ring-card sm:h-16 sm:w-16"
            />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                {greeting()}, {profile.firstName} 👋
              </h1>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {classLine}
                {term ? ` · ${term.name}` : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{profile.studentNumber}</Badge>
              {profile.residency === 'BOARDER' ? <Badge variant="accent">Boarder</Badge> : null}
              {profile.houseName ? <Badge variant="secondary">{profile.houseName} House</Badge> : null}
            </div>
          </CardContent>
        </Card>
      </FadeIn>

      <FadeIn delay={0.05}>
        <div className="grid grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-4">
          <PortalStat
            icon={CalendarCheck}
            label="Attendance"
            value={percent(attendance.rate)}
            progress={attendance.rate}
            hint={
              attendance.rate == null
                ? 'No registers marked yet'
                : `${attendance.present + attendance.late} of ${attendance.present + attendance.late + attendance.absent + attendance.excused} days${term ? ` this term` : ''}`
            }
            tone={attendance.rate == null ? 'primary' : attendance.rate >= 90 ? 'success' : attendance.rate >= 75 ? 'accent' : 'warning'}
            to="/my/attendance"
          />
          <PortalStat
            icon={Trophy}
            label="Average"
            value={resultsLocked ? 'Locked' : percent(average, 1)}
            progress={average}
            hint={
              resultsLocked
                ? 'Clear fees to view results'
                : average == null
                  ? 'No results released yet'
                  : 'Across published results'
            }
            tone={average == null ? 'primary' : scoreTone(average)}
            to="/my/results"
          />
          <PortalStat
            icon={Wallet}
            label={fees.cleared ? 'Fees' : 'Fees balance'}
            value={
              fees.invoices.length === 0
                ? '—'
                : fees.cleared
                  ? 'Paid'
                  : money(fees.balance, fees.currency)
            }
            progress={fees.billed > 0 ? (fees.paid / fees.billed) * 100 : null}
            hint={
              fees.invoices.length === 0
                ? 'Nothing billed yet'
                : fees.cleared
                  ? `${money(fees.paid, fees.currency)} paid in full`
                  : `${money(fees.paid, fees.currency)} of ${money(fees.billed, fees.currency)} paid`
            }
            tone={fees.cleared ? 'success' : 'warning'}
            to="/my/fees"
          />
          <PortalStat
            icon={BookOpen}
            label="Subjects"
            value={String(data.subjects.length)}
            hint={data.subjects.length ? 'Registered this year' : 'No subjects registered yet'}
            tone="primary"
            to="/my/subjects"
          />
        </div>
      </FadeIn>

      <FadeIn delay={0.1}>
        <div className="grid gap-4 lg:grid-cols-3">
          <RecentResults data={data} />
          <LatestAnnouncements data={data} />
        </div>
      </FadeIn>

      <FadeIn delay={0.15}>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <RecentAttendance data={data} />
          <FeesSummary data={data} />
          <MyClass data={data} />
        </div>
      </FadeIn>
    </div>
  )
}
