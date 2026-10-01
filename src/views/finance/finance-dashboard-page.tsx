import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AlertCircle, Banknote, PiggyBank, Receipt, TrendingUp, Users } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { StatCard } from '@/components/shared/stat-card'
import {
  ChartCard,
  ChartLegend,
  ChartTooltip,
  chartAxisProps,
  chartGridProps,
} from '@/components/shared/chart-chrome'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  DataTableShell,
} from '@/components/shared/data-table'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { formatMoney } from '@/lib/hr/constants'
import { downloadLedgerPdf } from '@/lib/hr/hr-pdf'
import { notify } from '@/lib/notify'
import { downloadXlsx } from '@/lib/xlsx'
import { financeService } from '@/services/hr'
import type { FinanceSummary } from '@/types'
import {
  ExportButtons,
  Money,
  SectionNote,
  errorText,
  useHrAccess,
  useLetterhead,
  yearOptions,
} from '@/views/hr/shared'

const COLORS = {
  fees: '#0d8a7f',
  other: '#14b8a6',
  expenses: '#c27803',
  salaries: '#134a66',
  net: '#6366f1',
}

const compact = (v: number) =>
  Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(Math.abs(v) >= 10_000 ? 0 : 1)}k` : `$${Math.round(v)}`

function Breakdown({ title, rows, total }: { title: string; rows: { label: string; amount: number }[]; total: number }) {
  return (
    <div>
      <h3 className="mb-2 font-display text-base font-semibold">{title}</h3>
      <DataTableShell>
        <DataTable className="min-w-0">
          <DataTableHead>
            <tr>
              <DataTableHeaderCell>{title.includes('Revenue') ? 'Source' : 'Category'}</DataTableHeaderCell>
              <DataTableHeaderCell className="text-right">Amount</DataTableHeaderCell>
              <DataTableHeaderCell className="text-right">Share</DataTableHeaderCell>
            </tr>
          </DataTableHead>
          <DataTableBody>
            {rows.length === 0 ? (
              <DataTableRow>
                <DataTableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                  Nothing recorded yet
                </DataTableCell>
              </DataTableRow>
            ) : (
              rows.map((r) => (
                <DataTableRow key={r.label}>
                  <DataTableCell className="text-sm">{r.label}</DataTableCell>
                  <DataTableCell className="text-right text-sm">
                    <Money value={r.amount} />
                  </DataTableCell>
                  <DataTableCell className="text-right text-xs text-muted-foreground tabular-nums">
                    {total ? `${((r.amount / total) * 100).toFixed(1)}%` : '—'}
                  </DataTableCell>
                </DataTableRow>
              ))
            )}
          </DataTableBody>
        </DataTable>
      </DataTableShell>
    </div>
  )
}

export function FinanceDashboardPage() {
  const can = useHrAccess()
  const canManage = can('finance.manage')
  const school = useLetterhead()
  const [year, setYear] = useState(new Date().getFullYear())
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    financeService
      .getSummary(year)
      .then((s) => !cancelled && setSummary(s))
      .catch((err) => !cancelled && notify.error(errorText(err, 'Could not load the financial summary')))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [year])

  async function exportPdf() {
    if (!summary) return
    try {
      const t = summary.totals
      await downloadLedgerPdf({
        school,
        title: 'Financial summary',
        subtitle: String(summary.year),
        head: ['Month', 'Fee payments', 'Other revenue', 'Total revenue', 'Expenses', 'of which salaries', 'Net'],
        rows: summary.months.map((m) => [
          m.label,
          formatMoney(m.feePayments),
          formatMoney(m.otherRevenue),
          formatMoney(m.revenue),
          formatMoney(m.expenses),
          formatMoney(m.salaries),
          formatMoney(m.net),
        ]),
        foot: [
          'Total',
          formatMoney(t.feePayments),
          formatMoney(t.otherRevenue),
          formatMoney(t.revenue),
          formatMoney(t.expenses),
          formatMoney(t.salaries),
          formatMoney(t.netBalance),
        ],
        rightAlign: [1, 2, 3, 4, 5, 6],
        filename: `financial-summary-${summary.year}.pdf`,
      })
      notify.success('Financial summary downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the PDF'))
    }
  }

  async function exportExcel() {
    if (!summary) return
    const t = summary.totals
    try {
      await downloadXlsx(
        [
          {
            name: 'Monthly',
            title: [school.name, `Financial summary ${summary.year}`],
            columns: [
              { header: 'Month', width: 12 },
              { header: 'Fee payments', width: 14, money: true },
              { header: 'Other revenue', width: 14, money: true },
              { header: 'Total revenue', width: 14, money: true },
              { header: 'Expenses', width: 14, money: true },
              { header: 'Salaries', width: 14, money: true },
              { header: 'Net', width: 14, money: true },
            ],
            rows: summary.months.map((m) => [m.label, m.feePayments, m.otherRevenue, m.revenue, m.expenses, m.salaries, m.net]),
            totals: ['Total', t.feePayments, t.otherRevenue, t.revenue, t.expenses, t.salaries, t.netBalance],
          },
          {
            name: 'Revenue by source',
            columns: [
              { header: 'Source', width: 22 },
              { header: 'Amount', width: 14, money: true },
            ],
            rows: summary.revenueBySource.map((r) => [r.source, r.amount]),
            totals: ['Total', t.revenue],
          },
          {
            name: 'Expenses by category',
            columns: [
              { header: 'Category', width: 22 },
              { header: 'Amount', width: 14, money: true },
            ],
            rows: summary.expensesByCategory.map((r) => [r.category, r.amount]),
            totals: ['Total', t.expenses],
          },
        ],
        `financial-summary-${summary.year}.xlsx`,
      )
      notify.success('Financial summary downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the spreadsheet'))
    }
  }

  const header = (
    <PageHeader
      title="Financial dashboard"
      description="Revenue, expenses, salaries and outstanding fees for the school year."
      breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Finance' }, { label: 'Financial dashboard' }]}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Year" value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-24">
            {yearOptions().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
          <ExportButtons onPdf={exportPdf} onExcel={exportExcel} disabled={!summary} />
        </div>
      }
    />
  )

  if (loading || !summary) {
    return (
      <div>
        {header}
        <LoadingState message="Loading financial summary…" />
      </div>
    )
  }

  const t = summary.totals
  const months = summary.months

  return (
    <div>
      {header}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Total revenue"
          value={formatMoney(t.revenue)}
          hint={`Fees ${formatMoney(t.feePayments)} · other ${formatMoney(t.otherRevenue)}`}
          icon={TrendingUp}
          tone="success"
          compact
        />
        <StatCard label="Total expenses" value={formatMoney(t.expenses)} icon={Receipt} tone="warning" compact />
        <StatCard
          label="Salary expenses"
          value={formatMoney(t.salaries)}
          hint="Posted when payrolls are locked"
          icon={Users}
          tone="accent"
          compact
        />
        <StatCard
          label="Net balance"
          value={formatMoney(t.netBalance)}
          hint={t.netBalance < 0 ? 'Expenses exceed revenue' : 'Revenue − expenses'}
          icon={PiggyBank}
          tone={t.netBalance < 0 ? 'warning' : 'success'}
          compact
        />
        <StatCard
          label="Outstanding fees"
          value={formatMoney(t.outstandingFees)}
          hint="Unpaid invoice balances (all years)"
          icon={AlertCircle}
          tone="warning"
          compact
        />
      </div>

      <SectionNote>
        Fee payments confirmed in Fees &amp; Payments are counted automatically as school-fees revenue — record only
        other income (projects, donations, fees received outside the system) in the revenue register.
      </SectionNote>

      {canManage ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/expenses">
              <Receipt className="h-4 w-4" />
              Record expense
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/revenue">
              <Banknote className="h-4 w-4" />
              Record revenue
            </Link>
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-2">
        <ChartCard
          title="Monthly revenue"
          description="Fee payments and other income"
          legend={
            <ChartLegend
              items={[
                { label: 'Fee payments', color: COLORS.fees },
                { label: 'Other revenue', color: COLORS.other },
              ]}
            />
          }
        >
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="label" {...chartAxisProps} dy={4} />
                <YAxis {...chartAxisProps} width={48} tickFormatter={compact} />
                <Tooltip
                  cursor={{ fill: 'color-mix(in oklab, var(--muted) 55%, transparent)' }}
                  content={<ChartTooltip valueFormatter={(v) => formatMoney(v)} />}
                />
                <Bar dataKey="feePayments" name="Fee payments" stackId="rev" fill={COLORS.fees} maxBarSize={28} />
                <Bar dataKey="otherRevenue" name="Other revenue" stackId="rev" fill={COLORS.other} radius={[6, 6, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Monthly expenses"
          description="All expenses, with salaries highlighted"
          legend={
            <ChartLegend
              items={[
                { label: 'Salaries', color: COLORS.salaries },
                { label: 'Other expenses', color: COLORS.expenses },
              ]}
            />
          }
        >
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={months.map((m) => ({ ...m, otherExpenses: Math.max(0, m.expenses - m.salaries) }))}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="label" {...chartAxisProps} dy={4} />
                <YAxis {...chartAxisProps} width={48} tickFormatter={compact} />
                <Tooltip
                  cursor={{ fill: 'color-mix(in oklab, var(--muted) 55%, transparent)' }}
                  content={<ChartTooltip valueFormatter={(v) => formatMoney(v)} />}
                />
                <Bar dataKey="salaries" name="Salaries" stackId="exp" fill={COLORS.salaries} maxBarSize={28} />
                <Bar dataKey="otherExpenses" name="Other expenses" stackId="exp" fill={COLORS.expenses} radius={[6, 6, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard
          title="Revenue vs expenses"
          description="Monthly totals and net"
          legend={
            <ChartLegend
              items={[
                { label: 'Revenue', color: COLORS.fees },
                { label: 'Expenses', color: COLORS.expenses },
                { label: 'Net', color: COLORS.net },
              ]}
            />
          }
        >
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={months} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="label" {...chartAxisProps} dy={4} />
                <YAxis {...chartAxisProps} width={48} tickFormatter={compact} />
                <Tooltip
                  cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                  content={<ChartTooltip valueFormatter={(v) => formatMoney(v)} />}
                />
                <Line type="monotone" dataKey="revenue" name="Revenue" stroke={COLORS.fees} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="expenses" name="Expenses" stroke={COLORS.expenses} strokeWidth={2.5} dot={false} />
                <Line type="monotone" dataKey="net" name="Net" stroke={COLORS.net} strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard title="Salary trends" description="Net salaries paid per month (locked payrolls)">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={months} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="salaryFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#134a66" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#0d8a7f" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...chartGridProps} />
                <XAxis dataKey="label" {...chartAxisProps} dy={4} />
                <YAxis {...chartAxisProps} width={48} tickFormatter={compact} />
                <Tooltip
                  cursor={{ stroke: 'var(--border)', strokeWidth: 1 }}
                  content={<ChartTooltip valueFormatter={(v) => formatMoney(v)} />}
                />
                <Area
                  type="monotone"
                  dataKey="salaries"
                  name="Salaries"
                  stroke={COLORS.salaries}
                  strokeWidth={2.5}
                  fill="url(#salaryFill)"
                  activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff', fill: COLORS.salaries }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Breakdown
          title="Revenue by source"
          rows={summary.revenueBySource.map((r) => ({ label: r.source, amount: r.amount }))}
          total={t.revenue}
        />
        <Breakdown
          title="Expenses by category"
          rows={summary.expensesByCategory.map((r) => ({ label: r.category, amount: r.amount }))}
          total={t.expenses}
        />
      </div>
    </div>
  )
}
