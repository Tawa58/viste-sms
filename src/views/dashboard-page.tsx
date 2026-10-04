import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  Banknote,
  CalendarClock,
  ClipboardCheck,
  FileWarning,
  GraduationCap,
  Megaphone,
  Plus,
  Receipt,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartCard,
  ChartLegend,
  ChartTooltip,
  chartAxisProps,
  chartGridProps,
} from '@/components/shared/chart-chrome'
import { DashboardSkeleton } from '@/components/shared/loading-state'
import { StatCard } from '@/components/shared/stat-card'
import { StatusBadge } from '@/components/shared/status-badge'
import { FadeIn } from '@/components/shared/page-transition'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/contexts/auth-context'
import { catalogService, dashboardService, USE_SERVER_API } from '@/services/api'
import { USE_MOCK_API } from '@/services/api/client'
import { notify } from '@/lib/notify'
import { canAccessPath, hasFullConsoleAccess } from '@/lib/roles'
import { cn, formatCurrency, formatDateTime } from '@/lib/utils'
import type { Announcement, DashboardStats, Payment } from '@/types'

const emptyStats: DashboardStats = {
  totalStudents: 0,
  totalTeachers: 0,
  todayAttendancePct: 0,
  outstandingFees: 0,
  feesCollected: 0,
  pendingResults: 0,
}

const pieColors = ['#0d8a7f', '#134a66', '#c27803', '#66798c']
const performanceColors = ['#134a66', '#0d8a7f', '#1d6b9a', '#c27803', '#66798c']

const allQuickActions = [
  { label: 'Add student', to: '/students', icon: Plus },
  { label: 'Take attendance', to: '/attendance', icon: ClipboardCheck },
  { label: 'Record payment', to: '/fees', icon: Wallet },
  { label: 'Publish results', to: '/results', icon: FileWarning },
]

const upcoming = [
  { title: 'Term 2 Mid assessments', when: 'Mon 22 Sep', place: 'All forms' },
  { title: 'Parent conference', when: 'Thu 25 Sep', place: 'Main hall' },
]

const dashboardFeedItemClass =
  'min-h-[4.25rem] rounded-lg border border-border/70 px-2.5 py-2'

const feedIconTone = {
  primary: 'bg-primary/12 text-primary',
  accent: 'bg-accent/12 text-accent',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/12 text-warning',
} as const

function FeedIcon({
  icon: Icon,
  tone,
  size = 'md',
}: {
  icon: LucideIcon
  tone: keyof typeof feedIconTone
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-lg',
        size === 'md' ? 'h-8 w-8' : 'h-7 w-7 rounded-md',
        feedIconTone[tone],
      )}
    >
      <Icon className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
    </span>
  )
}

function FeedCard({
  title,
  icon,
  tone,
  children,
  action,
}: {
  title: string
  icon: LucideIcon
  tone: keyof typeof feedIconTone
  children: ReactNode
  action: ReactNode
}) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex shrink-0 flex-row items-center justify-between space-y-0 gap-2 p-3.5 pb-2">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <FeedIcon icon={icon} tone={tone} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 p-3.5 pt-0">
        <div className="flex flex-1 flex-col gap-2">{children}</div>
        {action}
      </CardContent>
    </Card>
  )
}

export function DashboardPage() {
  const { user, permissions } = useAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [enrollment, setEnrollment] = useState<{ month: string; students: number }[]>([])
  const [attendance, setAttendance] = useState<{ name: string; value: number }[]>([])
  const [fees, setFees] = useState<{ month: string; collected: number; outstanding: number }[]>([])
  const [performance, setPerformance] = useState<{ subject: string; average: number }[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [activities, setActivities] = useState<
    { id: string; title: string; detail: string; at: string }[]
  >([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [s, e, a, f, p, pay, act, an] = await Promise.all([
          dashboardService.getStats(),
          dashboardService.getEnrollmentTrend(),
          dashboardService.getAttendanceOverview(),
          dashboardService.getFeeCollection(),
          dashboardService.getPerformance(),
          dashboardService.getRecentPayments(),
          dashboardService.getRecentActivities(),
          catalogService.getAnnouncements(),
        ])
        if (!mounted) return
        setStats(s)
        setEnrollment(e)
        setAttendance(a)
        setFees(f)
        setPerformance(p)
        setPayments(pay.slice(0, 2))
        setActivities(act.slice(0, 2))
        setAnnouncements(an.filter((x) => x.status === 'PUBLISHED').slice(0, 2))
      } catch (err) {
        console.error(err)
        if (mounted) {
          setStats(emptyStats)
          setEnrollment([])
          setAttendance([
            { name: 'Present', value: 0 },
            { name: 'Late', value: 0 },
            { name: 'Absent', value: 0 },
            { name: 'Excused', value: 0 },
          ])
          setFees([])
          setPerformance([])
          setPayments([])
          setActivities([])
          setAnnouncements([])
        }
        notify.error(
          'Could not load dashboard',
          USE_SERVER_API || USE_MOCK_API
            ? err instanceof Error
              ? err.message
              : 'Check your sign-in and server logs, then try again.'
            : 'Client Firestore mode is enabled, but the security rules intentionally block direct data access. Set NEXT_PUBLIC_USE_CLIENT_FIRESTORE=false to use the server API. Do not open the Firestore rules.',
        )
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  if (loading || !stats) return <DashboardSkeleton />

  const role = user?.role
  const isAdminView = role ? hasFullConsoleAccess(role) : false
  const canFees = role ? canAccessPath(role, '/fees', permissions) : false
  const canAudit = role ? canAccessPath(role, '/audit-logs', permissions) : false
  const canTeachers = role ? canAccessPath(role, '/teachers', permissions) : false
  const quickActions = allQuickActions.filter((action) =>
    role ? canAccessPath(role, action.to, permissions) : false,
  )

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="space-y-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
            Good day
          </p>
          <h2 className="font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Welcome back, {user?.name?.split(' ')[0] ?? 'Admin'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isAdminView
              ? 'Here’s today’s snapshot for Viste High School operations.'
              : 'Here’s your classroom snapshot for today.'}
          </p>
        </div>
      </FadeIn>

      <div
        className={cn(
          'grid w-full grid-cols-2 gap-1.5',
          isAdminView
            ? 'max-w-xl sm:max-w-2xl sm:grid-cols-3 lg:max-w-3xl lg:grid-cols-6'
            : 'max-w-lg sm:grid-cols-3',
        )}
      >
        <StatCard compact label="Total Students" value={String(stats.totalStudents)} icon={Users} />
        {canTeachers && (
          <StatCard
            compact
            label="Total Teachers"
            value={String(stats.totalTeachers)}
            icon={GraduationCap}
          />
        )}
        <StatCard
          compact
          label="Today's Attendance"
          value={`${stats.todayAttendancePct}%`}
          icon={ClipboardCheck}
          tone="accent"
        />
        {canFees && (
          <>
            <StatCard
              compact
              label="Outstanding Fees"
              value={formatCurrency(stats.outstandingFees)}
              icon={Wallet}
              tone="warning"
            />
            <StatCard
              compact
              label="Fees Collected"
              value={formatCurrency(stats.feesCollected)}
              icon={Banknote}
              tone="success"
            />
          </>
        )}
        <StatCard
          compact
          label="Pending Results"
          value={String(stats.pendingResults)}
          icon={FileWarning}
        />
      </div>

      {quickActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickActions.map((action) => {
            const Icon = action.icon
            return (
              <Button key={action.to} variant="outline" size="sm" className="h-8 rounded-full" asChild>
                <Link to={action.to}>
                  <Icon />
                  {action.label}
                </Link>
              </Button>
            )
          })}
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Student Enrollment"
          description="Month-over-month headcount trend"
        >
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={enrollment} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="enrollmentFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#134a66" stopOpacity={0.35} />
                    <stop offset="55%" stopColor="#0d8a7f" stopOpacity={0.12} />
                    <stop offset="100%" stopColor="#0d8a7f" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="enrollmentStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#134a66" />
                    <stop offset="100%" stopColor="#0d8a7f" />
                  </linearGradient>
                </defs>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="month" {...chartAxisProps} dy={4} />
                <YAxis {...chartAxisProps} width={36} />
                <Tooltip
                  cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                  content={<ChartTooltip />}
                />
                <Area
                  type="monotone"
                  dataKey="students"
                  name="Students"
                  stroke="url(#enrollmentStroke)"
                  strokeWidth={2.5}
                  fill="url(#enrollmentFill)"
                  activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff', fill: '#0d8a7f' }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Attendance Overview"
          description="Today’s distribution"
          legend={
            <ChartLegend
              className="justify-end"
              items={attendance.map((item, index) => ({
                label: item.name,
                color: pieColors[index % pieColors.length],
              }))}
            />
          }
        >
          <div className="relative h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={attendance}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={68}
                  paddingAngle={3}
                  cornerRadius={6}
                  stroke="transparent"
                >
                  {attendance.map((_, index) => (
                    <Cell key={index} fill={pieColors[index % pieColors.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={
                    <ChartTooltip valueFormatter={(v) => Number(v).toLocaleString()} />
                  }
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Present
              </p>
              <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
                {stats.todayAttendancePct}%
              </p>
            </div>
          </div>
        </ChartCard>
      </div>

      <div className={cn('grid gap-3', canFees ? 'xl:grid-cols-2' : 'xl:grid-cols-1')}>
        {canFees && (
          <ChartCard
            title="Fee Collection"
            description="Collected vs outstanding"
            legend={
              <ChartLegend
                items={[
                  { label: 'Collected', color: '#0d8a7f' },
                  { label: 'Outstanding', color: '#c27803' },
                ]}
              />
            }
          >
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fees} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={6}>
                  <defs>
                    <linearGradient id="feeCollected" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#14b8a6" />
                      <stop offset="100%" stopColor="#0d8a7f" />
                    </linearGradient>
                    <linearGradient id="feeOutstanding" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f0b429" />
                      <stop offset="100%" stopColor="#c27803" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis dataKey="month" {...chartAxisProps} dy={4} />
                  <YAxis {...chartAxisProps} width={40} />
                  <Tooltip
                    cursor={{ fill: 'color-mix(in oklab, var(--muted) 55%, transparent)' }}
                    content={
                      <ChartTooltip valueFormatter={(v) => formatCurrency(v)} />
                    }
                  />
                  <Bar
                    dataKey="collected"
                    name="Collected"
                    fill="url(#feeCollected)"
                    radius={[8, 8, 4, 4]}
                    maxBarSize={28}
                  />
                  <Bar
                    dataKey="outstanding"
                    name="Outstanding"
                    fill="url(#feeOutstanding)"
                    radius={[8, 8, 4, 4]}
                    maxBarSize={28}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        )}

        <ChartCard title="Academic Performance" description="Average scores by subject">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={performance}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 4, bottom: 0 }}
              >
                <defs>
                  {performance.map((_, index) => (
                    <linearGradient
                      key={index}
                      id={`perf-${index}`}
                      x1="0"
                      y1="0"
                      x2="1"
                      y2="0"
                    >
                      <stop
                        offset="0%"
                        stopColor={performanceColors[index % performanceColors.length]}
                        stopOpacity={0.75}
                      />
                      <stop
                        offset="100%"
                        stopColor={performanceColors[index % performanceColors.length]}
                      />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid {...chartGridProps} horizontal={false} vertical />
                <XAxis type="number" domain={[0, 100]} {...chartAxisProps} />
                <YAxis
                  type="category"
                  dataKey="subject"
                  {...chartAxisProps}
                  width={72}
                />
                <Tooltip
                  cursor={{ fill: 'color-mix(in oklab, var(--muted) 55%, transparent)' }}
                  content={<ChartTooltip valueFormatter={(v) => `${v}%`} />}
                />
                <Bar dataKey="average" name="Average" radius={[0, 10, 10, 0]} maxBarSize={18}>
                  {performance.map((_, index) => (
                    <Cell key={index} fill={`url(#perf-${index})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <div
        className={cn(
          'grid auto-rows-fr gap-3 lg:grid-cols-2',
          isAdminView ? 'xl:grid-cols-4' : 'xl:grid-cols-2',
        )}
      >
        <FeedCard
          title="Upcoming"
          icon={CalendarClock}
          tone="primary"
          action={
            <Button variant="outline" size="sm" className="mt-auto w-full shrink-0 justify-between" asChild>
              <Link to="/announcements">
                View schedule
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          }
        >
          {upcoming.map((item) => (
            <div key={item.title} className={cn('flex items-start gap-2.5', dashboardFeedItemClass)}>
              <FeedIcon icon={CalendarClock} tone="primary" size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.when} · {item.place}
                </p>
              </div>
            </div>
          ))}
        </FeedCard>

        <FeedCard
          title="Announcements"
          icon={Megaphone}
          tone="accent"
          action={
            <Button variant="outline" size="sm" className="mt-auto w-full shrink-0 justify-between" asChild>
              <Link to="/announcements">
                View all notices
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          }
        >
          {announcements.map((a) => (
            <div key={a.id} className={cn('flex items-start gap-2.5', dashboardFeedItemClass)}>
              <FeedIcon icon={Megaphone} tone="accent" size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{a.title}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{a.body}</p>
              </div>
            </div>
          ))}
        </FeedCard>

        {canFees && (
          <FeedCard
            title="Recent Payments"
            icon={Receipt}
            tone="success"
            action={
              <Button variant="outline" size="sm" className="mt-auto w-full shrink-0 justify-between" asChild>
                <Link to="/fees">
                  Open fee ledger
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            }
          >
            {payments.map((p) => (
              <div key={p.id} className={cn('flex items-center gap-2.5', dashboardFeedItemClass)}>
                <FeedIcon icon={Banknote} tone="success" size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.receiptNumber}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatDateTime(p.paidAt)} · {p.method}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold">{formatCurrency(p.amount)}</p>
                  <StatusBadge status={p.status} />
                </div>
              </div>
            ))}
          </FeedCard>
        )}

        {canAudit && (
          <FeedCard
            title="Recent Activities"
            icon={Activity}
            tone="warning"
            action={
              <Button variant="outline" size="sm" className="mt-auto w-full shrink-0 justify-between" asChild>
                <Link to="/audit-logs">
                  View activity log
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            }
          >
            {activities.map((a) => (
              <div key={a.id} className={cn('flex items-start gap-2.5', dashboardFeedItemClass)}>
                <FeedIcon icon={Activity} tone="warning" size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.title}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {a.detail} · {formatDateTime(a.at)}
                  </p>
                </div>
              </div>
            ))}
          </FeedCard>
        )}
      </div>
    </div>
  )
}
