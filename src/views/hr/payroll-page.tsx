import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Download,
  FileText,
  Lock,
  Printer,
  RefreshCw,
  RotateCcw,
  Trash2,
  Users,
  Wallet,
  WalletCards,
  TrendingDown,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { EmptyState } from '@/components/shared/empty-state'
import { SearchInput } from '@/components/shared/search-input'
import { StatCard } from '@/components/shared/stat-card'
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
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatMoney, formatPercentValue } from '@/lib/hr/constants'
import { downloadPayrollPdf, downloadPayslipPdf, printPayslipPdf } from '@/lib/hr/hr-pdf'
import { periodKey, periodLabel } from '@/lib/hr/payroll-engine'
import { notify } from '@/lib/notify'
import { formatDate } from '@/lib/utils'
import { downloadXlsx } from '@/lib/xlsx'
import { hrService, type PayrollAction } from '@/services/hr'
import type {
  AttendanceDeductionSettings,
  PayrollItem,
  PayrollRun,
  PayrollRunDetail,
  PayrollSchoolInfo,
} from '@/types'
import {
  ExportButtons,
  MONTH_NAMES,
  Money,
  PayrollStatusBadge,
  SectionNote,
  TablePager,
  errorText,
  useHrAccess,
  usePaged,
  yearOptions,
} from '@/views/hr/shared'

function deductionSummary(item: PayrollItem) {
  return item.deductions
    .map((d) => {
      const basis = [
        d.percentage ? formatPercentValue(d.percentage) : null,
        d.fixedAmount ? formatMoney(d.fixedAmount) : null,
      ]
        .filter(Boolean)
        .join(' + ')
      return `${d.label}${basis ? ` (${basis})` : ''}: ${formatMoney(d.amount)}`
    })
    .join('\n')
}

function PayslipView({ school, item, provisional }: { school: PayrollSchoolInfo; item: PayrollItem; provisional: boolean }) {
  const earnings: [string, number][] = [
    ['Basic salary', item.basicSalary],
    ['Housing allowance', item.housingAllowance],
    ['Transport allowance', item.transportAllowance],
    ['Other allowances', item.otherAllowances],
  ]
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-xl border border-border/70 bg-muted/20 p-4 text-center">
        <p className="font-display text-lg font-semibold">{school.name}</p>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
          Payslip · {periodLabel(item.period)}
        </p>
        {provisional ? (
          <p className="mt-2 text-xs font-medium text-warning">
            Provisional — final once the payroll is locked
          </p>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        {(
          [
            ['Employee', item.employeeName],
            ['Employee no.', item.employeeNumber],
            ['Position', item.position],
            ['Department', item.department || '—'],
            ['Salary scale', `${item.scaleId} v${item.scaleVersion} · Grade ${item.grade}`],
            ['Bank', [item.bank.bankName, item.bank.accountNumber].filter(Boolean).join(' · ') || '—'],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="overflow-hidden rounded-xl border border-border/70">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Earnings</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {earnings.map(([label, amount]) => (
              <tr key={label} className="border-t border-border/60">
                <td className="px-3 py-1.5">{label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(amount)}</td>
              </tr>
            ))}
            <tr className="border-t border-border/60 font-semibold">
              <td className="px-3 py-1.5">Gross salary</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(item.grossSalary)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="overflow-hidden rounded-xl border border-border/70">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Deductions</th>
              <th className="px-3 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {item.deductions.length === 0 ? (
              <tr className="border-t border-border/60">
                <td className="px-3 py-1.5 text-muted-foreground" colSpan={2}>
                  No deductions
                </td>
              </tr>
            ) : (
              item.deductions.map((d, i) => (
                <tr key={`${d.label}-${i}`} className="border-t border-border/60">
                  <td className="px-3 py-1.5">
                    {d.label}
                    <span className="text-xs text-muted-foreground">
                      {d.percentage ? ` · ${formatPercentValue(d.percentage)}` : ''}
                      {d.fixedAmount ? ` · ${formatMoney(d.fixedAmount)}` : ''}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(d.amount)}</td>
                </tr>
              ))
            )}
            <tr className="border-t border-border/60 font-semibold">
              <td className="px-3 py-1.5">Total deductions</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(item.deductionsTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between rounded-xl bg-primary px-4 py-3 text-primary-foreground">
        <span className="font-medium">Net salary</span>
        <span className="font-display text-xl font-semibold tabular-nums">{formatMoney(item.netSalary)}</span>
      </div>
    </div>
  )
}

export function PayrollPage() {
  const can = useHrAccess()
  const canManage = can('payroll.manage')
  const canApprove = can('payroll.approve')
  const now = new Date()
  const [loading, setLoading] = useState(true)
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [rules, setRules] = useState<AttendanceDeductionSettings | null>(null)
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [detail, setDetail] = useState<PayrollRunDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [slip, setSlip] = useState<PayrollItem | null>(null)
  const [adjusting, setAdjusting] = useState<PayrollItem | null>(null)
  const [counts, setCounts] = useState({ absentDays: 0, lateDays: 0 })

  const period = periodKey(year, month)
  const runExists = runs.some((r) => r.id === period)

  const loadRuns = useCallback(async () => {
    const rows = await hrService.listPayrolls()
    setRuns(rows)
    return rows
  }, [])

  useEffect(() => {
    Promise.all([loadRuns(), hrService.getAttendanceRules().catch(() => null)])
      .then(([rows, r]) => {
        setRules(r)
        const latest = rows[0]
        if (latest && !rows.some((x) => x.id === periodKey(now.getFullYear(), now.getMonth() + 1))) {
          setYear(latest.year)
          setMonth(latest.month)
        }
      })
      .catch((err) => notify.error(errorText(err, 'Could not load payrolls')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (loading) return
    if (!runExists) {
      setDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    hrService
      .getPayroll(period)
      .then((d) => !cancelled && setDetail(d))
      .catch((err) => !cancelled && notify.error(errorText(err, 'Could not load the payroll')))
      .finally(() => !cancelled && setDetailLoading(false))
    return () => {
      cancelled = true
    }
  }, [period, runExists, loading])

  const items = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (detail?.items ?? []).filter(
      (i) =>
        !q ||
        `${i.employeeNumber} ${i.employeeName} ${i.position} ${i.department}`.toLowerCase().includes(q),
    )
  }, [detail, search])
  const { page, setPage, pageCount, pageRows } = usePaged(items, 15)
  useEffect(() => setPage(1), [search, period, setPage])

  const run = detail?.run ?? null
  const showAttendance = Boolean(
    rules?.enabled || detail?.items.some((i) => i.attendance.absentDays || i.attendance.lateDays),
  )

  async function generate() {
    const regenerate = runExists
    if (
      regenerate &&
      !window.confirm(
        `Regenerate the ${periodLabel(period)} draft? Salaries and deductions are recalculated; hand-entered attendance counts are kept.`,
      )
    ) {
      return
    }
    setBusy('generate')
    try {
      const next = await hrService.generatePayroll(year, month)
      setDetail(next)
      await loadRuns()
      notify.success(
        regenerate ? 'Payroll regenerated' : 'Payroll generated',
        `${next.run.totals.employees} employees · net ${formatMoney(next.run.totals.net)}. Review the preview, then approve.`,
      )
    } catch (err) {
      notify.error(errorText(err, 'Could not generate the payroll'))
    } finally {
      setBusy(null)
    }
  }

  async function act(action: PayrollAction) {
    if (!run) return
    const prompts: Record<PayrollAction, string> = {
      approve: `Approve the ${periodLabel(run.period)} payroll (net ${formatMoney(run.totals.net)})?`,
      reopen: `Reopen the ${periodLabel(run.period)} payroll for changes? It returns to draft.`,
      lock: `Lock the ${periodLabel(run.period)} payroll? Payslips are issued, deductions are marked applied and a ${formatMoney(run.totals.net)} salaries expense is posted. A locked payroll cannot be changed.`,
    }
    if (!window.confirm(prompts[action])) return
    setBusy(action)
    try {
      const next = await hrService.payrollAction(run.id, action)
      setDetail(next)
      await loadRuns()
      notify.success(
        { approve: 'Payroll approved', reopen: 'Payroll reopened', lock: 'Payroll locked' }[action],
        action === 'lock' ? 'Payslips issued and the salaries expense recorded.' : undefined,
      )
    } catch (err) {
      notify.error(errorText(err, 'Could not update the payroll'))
    } finally {
      setBusy(null)
    }
  }

  async function removeRun() {
    if (!run || !window.confirm(`Delete the ${periodLabel(run.period)} draft payroll?`)) return
    setBusy('delete')
    try {
      await hrService.deletePayroll(run.id)
      setDetail(null)
      await loadRuns()
      notify.success('Draft payroll deleted')
    } catch (err) {
      notify.error(errorText(err, 'Could not delete the payroll'))
    } finally {
      setBusy(null)
    }
  }

  function openAdjust(item: PayrollItem) {
    setCounts({ absentDays: item.attendance.absentDays, lateDays: item.attendance.lateDays })
    setAdjusting(item)
  }

  async function saveAdjust() {
    if (!adjusting || !run) return
    setBusy('adjust')
    try {
      const next = await hrService.updatePayrollItem(run.id, adjusting.id, counts)
      setDetail(next)
      await loadRuns()
      setAdjusting(null)
      notify.success('Attendance updated', `${adjusting.employeeName}'s net pay was recalculated.`)
    } catch (err) {
      notify.error(errorText(err, 'Could not update attendance'))
    } finally {
      setBusy(null)
    }
  }

  async function exportPdf() {
    if (!detail) return
    try {
      await downloadPayrollPdf(detail)
      notify.success('Payroll register downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the PDF'))
    }
  }

  async function exportExcel() {
    if (!detail) return
    const { run: r, items: all, school } = detail
    try {
      await downloadXlsx(
        [
          {
            name: 'Payroll',
            title: [school.name, `Payroll register — ${periodLabel(r.period)} (${r.status.toLowerCase()})`],
            columns: [
              { header: 'Employee no.', width: 13 },
              { header: 'Employee', width: 24 },
              { header: 'Position', width: 18 },
              { header: 'Department', width: 16 },
              { header: 'Scale', width: 12 },
              { header: 'Grade', width: 7 },
              { header: 'Basic', width: 12, money: true },
              { header: 'Housing', width: 11, money: true },
              { header: 'Transport', width: 11, money: true },
              { header: 'Other', width: 11, money: true },
              { header: 'Gross', width: 12, money: true },
              { header: 'Absent days', width: 11 },
              { header: 'Late days', width: 10 },
              { header: 'Deductions', width: 12, money: true },
              { header: 'Net salary', width: 13, money: true },
              { header: 'Bank', width: 16 },
              { header: 'Account no.', width: 18 },
              { header: 'Branch', width: 16 },
            ],
            rows: all.map((i) => [
              i.employeeNumber,
              i.employeeName,
              i.position,
              i.department,
              `${i.scaleId} v${i.scaleVersion}`,
              i.grade,
              i.basicSalary,
              i.housingAllowance,
              i.transportAllowance,
              i.otherAllowances,
              i.grossSalary,
              i.attendance.absentDays,
              i.attendance.lateDays,
              i.deductionsTotal,
              i.netSalary,
              i.bank.bankName,
              i.bank.accountNumber,
              i.bank.branch,
            ]),
            totals: [
              'Totals',
              `${r.totals.employees} employees`,
              '',
              '',
              '',
              '',
              r.totals.basic,
              all.reduce((s, i) => s + i.housingAllowance, 0),
              all.reduce((s, i) => s + i.transportAllowance, 0),
              all.reduce((s, i) => s + i.otherAllowances, 0),
              r.totals.gross,
              '',
              '',
              r.totals.deductions,
              r.totals.net,
            ],
          },
          {
            name: 'Deductions',
            title: [school.name, `Deductions — ${periodLabel(r.period)}`],
            columns: [
              { header: 'Employee no.', width: 13 },
              { header: 'Employee', width: 24 },
              { header: 'Deduction', width: 24 },
              { header: 'Source', width: 12 },
              { header: 'Percentage', width: 11 },
              { header: 'Fixed amount', width: 13, money: true },
              { header: 'Amount', width: 12, money: true },
              { header: 'Notes', width: 30 },
            ],
            rows: all.flatMap((i) =>
              i.deductions.map((d) => [
                i.employeeNumber,
                i.employeeName,
                d.label,
                d.source === 'ATTENDANCE' ? 'Attendance' : 'Manual',
                d.percentage ? `${d.percentage}%` : '',
                d.fixedAmount,
                d.amount,
                d.notes ?? '',
              ]),
            ),
            totals: ['Total', '', '', '', '', null, r.totals.deductions, ''],
          },
          ...(r.skipped.length
            ? [
                {
                  name: 'Not paid',
                  title: [school.name, `Employees left off — ${periodLabel(r.period)}`],
                  columns: [
                    { header: 'Employee no.', width: 13 },
                    { header: 'Employee', width: 26 },
                    { header: 'Reason', width: 40 },
                  ],
                  rows: r.skipped.map((s) => [s.employeeNumber, s.name, s.reason]),
                },
              ]
            : []),
        ],
        `payroll-${r.period}.xlsx`,
      )
      notify.success('Payroll spreadsheet downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the spreadsheet'))
    }
  }

  async function slipPdf(item: PayrollItem, print = false) {
    if (!detail) return
    try {
      if (print) await printPayslipPdf(detail.school, item)
      else {
        await downloadPayslipPdf(detail.school, item)
        notify.success('Payslip downloaded')
      }
    } catch (err) {
      notify.error(errorText(err, 'Could not create the payslip'))
    }
  }

  if (loading) return <LoadingState message="Loading payroll…" />

  const years = yearOptions()

  return (
    <div>
      <PageHeader
        title="Payroll"
        description="Generate the monthly payroll from salary scales, deductions and attendance, preview it, approve and lock it, then issue payslips."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'HR & Payroll' }, { label: 'Payroll' }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Month"
              value={String(month)}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="w-36"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="Year"
              value={String(year)}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-24"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            {canManage && (!run || run.status === 'DRAFT') ? (
              <Button type="button" loading={busy === 'generate'} disabled={busy !== null} onClick={() => void generate()}>
                <RefreshCw className="h-4 w-4" />
                {runExists ? 'Regenerate' : 'Generate payroll'}
              </Button>
            ) : null}
          </div>
        }
      />

      {detailLoading ? (
        <LoadingState message={`Loading ${periodLabel(period)}…`} />
      ) : !run || !detail ? (
        <EmptyState
          icon={WalletCards}
          title={`No payroll for ${periodLabel(period)}`}
          description={
            canManage
              ? 'Generate the payroll to preview salaries, allowances, deductions and net pay for every active employee.'
              : 'The payroll for this month has not been generated yet.'
          }
          actionLabel={canManage ? 'Generate payroll' : undefined}
          onAction={canManage ? () => void generate() : undefined}
        />
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
            <StatCard label="Employees paid" value={String(run.totals.employees)} icon={Users} compact />
            <StatCard
              label="Gross salaries"
              value={formatMoney(run.totals.gross)}
              hint={`Basic ${formatMoney(run.totals.basic)} + allowances ${formatMoney(run.totals.allowances)}`}
              icon={Wallet}
              tone="accent"
              compact
            />
            <StatCard
              label="Deductions"
              value={formatMoney(run.totals.deductions)}
              icon={TrendingDown}
              tone="warning"
              compact
            />
            <StatCard label="Net salaries" value={formatMoney(run.totals.net)} icon={WalletCards} tone="success" compact />
          </div>

          <Card className="mb-4">
            <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-display text-lg font-semibold">{periodLabel(run.period)}</h2>
                  <PayrollStatusBadge status={run.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Generated {formatDate(run.generatedAt)} by {run.generatedByName}
                  {run.approvedAt ? ` · approved ${formatDate(run.approvedAt)} by ${run.approvedByName}` : ''}
                  {run.lockedAt ? ` · locked ${formatDate(run.lockedAt)} by ${run.lockedByName}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ExportButtons onPdf={exportPdf} onExcel={exportExcel} />
                {run.status === 'DRAFT' && canApprove ? (
                  <Button type="button" loading={busy === 'approve'} disabled={busy !== null} onClick={() => void act('approve')}>
                    <CheckCircle2 className="h-4 w-4" />
                    Approve
                  </Button>
                ) : null}
                {run.status === 'DRAFT' && canManage ? (
                  <Button
                    type="button"
                    variant="ghost"
                    loading={busy === 'delete'}
                    disabled={busy !== null}
                    aria-label="Delete draft payroll"
                    onClick={() => void removeRun()}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
                {run.status === 'APPROVED' && canApprove ? (
                  <>
                    <Button type="button" variant="outline" loading={busy === 'reopen'} disabled={busy !== null} onClick={() => void act('reopen')}>
                      <RotateCcw className="h-4 w-4" />
                      Reopen
                    </Button>
                    <Button type="button" loading={busy === 'lock'} disabled={busy !== null} onClick={() => void act('lock')}>
                      <Lock className="h-4 w-4" />
                      Lock payroll
                    </Button>
                  </>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {run.status === 'DRAFT' ? (
            <SectionNote>
              Preview: net salary = gross salary (basic + allowances) − deductions.
              {rules?.enabled
                ? ` Attendance deductions are on (absent day ${rules.absentDay.mode === 'PERCENT' ? `${rules.absentDay.value}%` : formatMoney(rules.absentDay.value)}, late coming ${rules.lateComing.mode === 'PERCENT' ? `${rules.lateComing.value}%` : formatMoney(rules.lateComing.value)}); counts come from staff check-in for employees linked to a login and can be adjusted per employee.`
                : ' Attendance deductions are off — turn them on under Deductions → Attendance rules.'}{' '}
              Regenerate after changing salary scales, staff records or deductions.
            </SectionNote>
          ) : null}

          {run.skipped.length ? (
            <details className="mb-4 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-warning">
                {run.skipped.length} employee{run.skipped.length === 1 ? '' : 's'} not on this payroll
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {run.skipped.map((s) => (
                  <li key={s.employeeId}>
                    <span className="font-medium text-foreground">{s.name}</span> ({s.employeeNumber}) — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="mb-4 flex flex-wrap gap-3">
            <SearchInput
              id="payroll-search"
              name="payroll-search"
              value={search}
              onChange={setSearch}
              placeholder="Search employee, number, position…"
              className="min-w-[220px] flex-1"
            />
          </div>

          <DataTableShell>
            <DataTable className="min-w-[860px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Employee</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Basic</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Allowances</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Gross</DataTableHeaderCell>
                  {showAttendance ? <DataTableHeaderCell>Absent / late</DataTableHeaderCell> : null}
                  <DataTableHeaderCell className="text-right">Deductions</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Net salary</DataTableHeaderCell>
                  <DataTableHeaderCell />
                </tr>
              </DataTableHead>
              <DataTableBody>
                {pageRows.map((i) => (
                  <DataTableRow key={i.id}>
                    <DataTableCell>
                      <div className="font-medium">{i.employeeName}</div>
                      <div className="text-xs text-muted-foreground">
                        {i.employeeNumber} · {i.position} · {i.scaleId} v{i.scaleVersion} ({i.grade})
                      </div>
                    </DataTableCell>
                    <DataTableCell className="text-right text-sm">
                      <Money value={i.basicSalary} />
                    </DataTableCell>
                    <DataTableCell className="text-right text-sm">
                      <Money value={i.allowancesTotal} />
                    </DataTableCell>
                    <DataTableCell className="text-right text-sm">
                      <Money value={i.grossSalary} />
                    </DataTableCell>
                    {showAttendance ? (
                      <DataTableCell className="whitespace-nowrap text-sm">
                        {i.attendance.absentDays} / {i.attendance.lateDays}
                        <div className="text-[11px] text-muted-foreground">
                          {i.attendance.overridden ? 'Entered by hand' : i.attendance.tracked ? 'From check-in' : 'Not tracked'}
                        </div>
                      </DataTableCell>
                    ) : null}
                    <DataTableCell className="text-right text-sm" title={deductionSummary(i) || undefined}>
                      {i.deductionsTotal ? (
                        <span className="tabular-nums text-destructive">−{formatMoney(i.deductionsTotal)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {i.deductions.length ? (
                        <div className="text-[11px] text-muted-foreground">
                          {i.deductions.length} item{i.deductions.length === 1 ? '' : 's'}
                        </div>
                      ) : null}
                    </DataTableCell>
                    <DataTableCell className="text-right font-semibold">
                      <Money value={i.netSalary} />
                    </DataTableCell>
                    <DataTableCell>
                      <div className="flex justify-end gap-1">
                        {run.status === 'DRAFT' && canManage && rules?.enabled ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => openAdjust(i)}>
                            Adjust
                          </Button>
                        ) : null}
                        <Button type="button" size="sm" variant="outline" onClick={() => setSlip(i)}>
                          <FileText className="h-4 w-4" />
                          Payslip
                        </Button>
                      </div>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
              <tfoot className="border-t border-border bg-muted/30 text-sm font-semibold">
                <tr>
                  <td className="px-3 py-3 sm:px-4">Totals · {run.totals.employees} employees</td>
                  <td className="px-3 py-3 text-right tabular-nums sm:px-4">{formatMoney(run.totals.basic)}</td>
                  <td className="px-3 py-3 text-right tabular-nums sm:px-4">{formatMoney(run.totals.allowances)}</td>
                  <td className="px-3 py-3 text-right tabular-nums sm:px-4">{formatMoney(run.totals.gross)}</td>
                  {showAttendance ? <td /> : null}
                  <td className="px-3 py-3 text-right tabular-nums sm:px-4">{formatMoney(run.totals.deductions)}</td>
                  <td className="px-3 py-3 text-right tabular-nums sm:px-4">{formatMoney(run.totals.net)}</td>
                  <td />
                </tr>
              </tfoot>
            </DataTable>
          </DataTableShell>
          <TablePager page={page} pageCount={pageCount} onPageChange={setPage} total={items.length} noun="employee" />
        </>
      )}

      {runs.length ? (
        <div className="mt-8">
          <h2 className="mb-3 font-display text-lg font-semibold">Payroll history</h2>
          <DataTableShell>
            <DataTable>
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Month</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Employees</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Gross</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Deductions</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Net</DataTableHeaderCell>
                  <DataTableHeaderCell />
                </tr>
              </DataTableHead>
              <DataTableBody>
                {runs.map((r) => (
                  <DataTableRow key={r.id} className={r.id === period ? 'bg-primary/5' : undefined}>
                    <DataTableCell className="font-medium">{periodLabel(r.period)}</DataTableCell>
                    <DataTableCell>
                      <PayrollStatusBadge status={r.status} />
                    </DataTableCell>
                    <DataTableCell className="text-right">{r.totals.employees}</DataTableCell>
                    <DataTableCell className="text-right text-sm">
                      <Money value={r.totals.gross} />
                    </DataTableCell>
                    <DataTableCell className="text-right text-sm">
                      <Money value={r.totals.deductions} />
                    </DataTableCell>
                    <DataTableCell className="text-right font-semibold">
                      <Money value={r.totals.net} />
                    </DataTableCell>
                    <DataTableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={r.id === period}
                        onClick={() => {
                          setYear(r.year)
                          setMonth(r.month)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                      >
                        {r.id === period ? 'Showing' : 'Open'}
                      </Button>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </DataTableShell>
        </div>
      ) : null}

      <Dialog open={slip !== null} onOpenChange={(o) => !o && setSlip(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Payslip</DialogTitle>
          </DialogHeader>
          {slip && detail ? (
            <>
              <PayslipView school={detail.school} item={slip} provisional={detail.run.status !== 'LOCKED'} />
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => void slipPdf(slip, true)}>
                  <Printer className="h-4 w-4" />
                  Print
                </Button>
                <Button type="button" onClick={() => void slipPdf(slip)}>
                  <Download className="h-4 w-4" />
                  Download PDF
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={adjusting !== null} onOpenChange={(o) => !o && setAdjusting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Attendance · {adjusting?.employeeName}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Unexcused absent days and late check-ins for {periodLabel(period)}. Hand-entered counts replace
            check-in figures and are kept if the payroll is regenerated.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <Label>Absent days</Label>
              <Input
                type="number"
                min={0}
                max={31}
                value={counts.absentDays}
                onChange={(e) => setCounts((c) => ({ ...c, absentDays: Math.max(0, Math.min(31, Number(e.target.value) || 0)) }))}
              />
            </Field>
            <Field>
              <Label>Late days</Label>
              <Input
                type="number"
                min={0}
                max={31}
                value={counts.lateDays}
                onChange={(e) => setCounts((c) => ({ ...c, lateDays: Math.max(0, Math.min(31, Number(e.target.value) || 0)) }))}
              />
            </Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAdjusting(null)}>
              Cancel
            </Button>
            <Button type="button" loading={busy === 'adjust'} onClick={() => void saveAdjust()}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
