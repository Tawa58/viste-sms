import { useEffect, useMemo, useState } from 'react'
import { CalendarClock, ClipboardList, Percent, Plus, Trash2, TrendingDown } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DEDUCTION_REASONS,
  DEDUCTION_REASON_LABEL,
  DEFAULT_ATTENDANCE_RULES,
  formatMoney,
  formatPercentValue,
} from '@/lib/hr/constants'
import { downloadLedgerPdf } from '@/lib/hr/hr-pdf'
import { currentScaleVersion, deductionAmount, periodLabel } from '@/lib/hr/payroll-engine'
import { notify } from '@/lib/notify'
import { formatDate } from '@/lib/utils'
import { downloadXlsx } from '@/lib/xlsx'
import { hrService, type AttendanceRulesInput } from '@/services/hr'
import type {
  AttendanceDeductionMode,
  AttendanceDeductionSettings,
  DeductionInput,
  DeductionReason,
  HrEmployee,
  PayrollDeduction,
  SalaryScaleVersion,
} from '@/types'
import {
  ExportButtons,
  MONTH_NAMES,
  SectionNote,
  TablePager,
  currentPeriod,
  errorText,
  todayIso,
  useHrAccess,
  useLetterhead,
  usePaged,
  yearOptions,
} from '@/views/hr/shared'

type DeductionForm = {
  employeeId: string
  reason: DeductionReason
  percentage: string
  fixedAmount: string
  date: string
  notes: string
}

const emptyForm = (): DeductionForm => ({
  employeeId: '',
  reason: 'UNAUTHORIZED_ABSENCE',
  percentage: '',
  fixedAmount: '',
  date: todayIso(),
  notes: '',
})

const num = (v: string) => (v.trim() === '' ? null : Number(v))

function RuleEditor({
  label,
  hint,
  rule,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  rule: AttendanceRulesInput['absentDay']
  disabled: boolean
  onChange: (rule: AttendanceRulesInput['absentDay']) => void
}) {
  return (
    <div className="rounded-xl border border-border/70 p-4">
      <p className="font-medium">{label}</p>
      <p className="mb-3 text-xs text-muted-foreground">{hint}</p>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <Label>Deduct as</Label>
          <Select
            value={rule.mode}
            disabled={disabled}
            onChange={(e) => onChange({ ...rule, mode: e.target.value as AttendanceDeductionMode })}
          >
            <option value="PERCENT">Percentage</option>
            <option value="FIXED">Fixed amount</option>
          </Select>
        </Field>
        <Field>
          <Label>{rule.mode === 'PERCENT' ? 'Percent per day' : 'Amount per day'}</Label>
          <Input
            type="number"
            min={0}
            max={rule.mode === 'PERCENT' ? 100 : undefined}
            step="0.01"
            disabled={disabled}
            value={rule.value}
            onChange={(e) => onChange({ ...rule, value: Math.max(0, Number(e.target.value) || 0) })}
          />
        </Field>
      </div>
    </div>
  )
}

export function DeductionsPage() {
  const can = useHrAccess()
  const canManage = can('payroll.manage')
  const school = useLetterhead()
  const [loading, setLoading] = useState(true)
  const [deductions, setDeductions] = useState<PayrollDeduction[]>([])
  const [employees, setEmployees] = useState<HrEmployee[]>([])
  const [scales, setScales] = useState<SalaryScaleVersion[]>([])
  const [rules, setRules] = useState<AttendanceDeductionSettings>(DEFAULT_ATTENDANCE_RULES)
  const [ruleDraft, setRuleDraft] = useState<AttendanceRulesInput>(DEFAULT_ATTENDANCE_RULES)
  const [savingRules, setSavingRules] = useState(false)
  const [period, setPeriod] = useState(currentPeriod())
  const [reason, setReason] = useState('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<PayrollDeduction | null>(null)
  const [form, setForm] = useState<DeductionForm>(emptyForm())
  const [saving, setSaving] = useState(false)

  async function reloadDeductions() {
    setDeductions(await hrService.listDeductions())
  }

  useEffect(() => {
    Promise.all([
      hrService.listDeductions(),
      hrService.listStaff().catch(() => ({ employees: [] as HrEmployee[], accounts: [] })),
      hrService.listScales().catch(() => [] as SalaryScaleVersion[]),
      hrService.getAttendanceRules(),
    ])
      .then(([rows, bundle, scaleRows, r]) => {
        setDeductions(rows)
        setEmployees(bundle.employees)
        setScales(scaleRows)
        setRules(r)
        setRuleDraft({
          enabled: r.enabled,
          absentDay: { ...r.absentDay },
          lateComing: { ...r.lateComing },
          percentBase: r.percentBase,
        })
      })
      .catch((err) => notify.error(errorText(err, 'Could not load deductions')))
      .finally(() => setLoading(false))
  }, [])

  const employeeById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees])

  /** Estimated amount from the employee's current salary scale; payroll uses the version in force that month. */
  function estimate(d: { employeeId: string; percentage: number | null; fixedAmount: number | null }) {
    const employee = employeeById.get(d.employeeId)
    const scale = employee?.salaryScaleId ? currentScaleVersion(scales, employee.salaryScaleId) : null
    const base = scale ? (rules.percentBase === 'BASIC' ? scale.basicSalary : scale.grossSalary) : 0
    return { base, amount: deductionAmount(d, base), known: Boolean(scale) || !d.percentage }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return deductions
      .filter((d) => period === 'all' || d.period === period)
      .filter((d) => reason === 'all' || d.reason === reason)
      .filter(
        (d) =>
          !q ||
          `${d.deductionNo} ${d.employeeName} ${d.employeeNumber} ${d.notes ?? ''}`.toLowerCase().includes(q),
      )
  }, [deductions, period, reason, search])
  const { page, setPage, pageCount, pageRows } = usePaged(filtered)
  useEffect(() => setPage(1), [period, reason, search, setPage])

  const stats = useMemo(() => {
    let total = 0
    for (const d of filtered) total += estimate(d).amount
    return {
      count: filtered.length,
      pending: filtered.filter((d) => d.status === 'PENDING').length,
      applied: filtered.filter((d) => d.status === 'APPLIED').length,
      total,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, scales, employees, rules])

  const periodChoices = useMemo(() => {
    const set = new Set<string>([currentPeriod(), ...deductions.map((d) => d.period)])
    for (const y of yearOptions(1, 0)) for (let m = 1; m <= 12; m += 1) set.add(`${y}-${String(m).padStart(2, '0')}`)
    return [...set].sort().reverse()
  }, [deductions])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setOpen(true)
  }

  function openEdit(d: PayrollDeduction) {
    setEditing(d)
    setForm({
      employeeId: d.employeeId,
      reason: d.reason,
      percentage: d.percentage == null ? '' : String(d.percentage),
      fixedAmount: d.fixedAmount == null ? '' : String(d.fixedAmount),
      date: d.date,
      notes: d.notes ?? '',
    })
    setOpen(true)
  }

  const preview = useMemo(() => {
    if (!form.employeeId) return null
    const pct = num(form.percentage)
    const fixed = num(form.fixedAmount)
    const { base, amount, known } = estimate({ employeeId: form.employeeId, percentage: pct, fixedAmount: fixed })
    return { base, amount, known, pct, fixed }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, scales, employees, rules])

  async function save() {
    const percentage = num(form.percentage)
    const fixedAmount = num(form.fixedAmount)
    if (!form.employeeId) return notify.error('Choose an employee')
    if (!(percentage && percentage > 0) && !(fixedAmount && fixedAmount > 0)) {
      return notify.error('Enter a percentage or a fixed amount')
    }
    if (percentage != null && (percentage < 0 || percentage > 100)) {
      return notify.error('Percentage must be between 0 and 100')
    }
    const payload: DeductionInput = {
      employeeId: form.employeeId,
      reason: form.reason,
      percentage: percentage || null,
      fixedAmount: fixedAmount || null,
      date: form.date,
      notes: form.notes.trim(),
    }
    setSaving(true)
    try {
      if (editing) {
        await hrService.updateDeduction(editing.id, payload)
        notify.success('Deduction updated')
      } else {
        const created = await hrService.createDeduction(payload)
        notify.success('Deduction added', `${created.deductionNo} applies to the ${periodLabel(created.period)} payroll.`)
      }
      setOpen(false)
      await reloadDeductions()
    } catch (err) {
      notify.error(errorText(err, 'Could not save the deduction'))
    } finally {
      setSaving(false)
    }
  }

  async function remove(d: PayrollDeduction) {
    if (!window.confirm(`Delete ${d.deductionNo} for ${d.employeeName}?`)) return
    try {
      await hrService.deleteDeduction(d.id)
      notify.success('Deduction removed')
      await reloadDeductions()
    } catch (err) {
      notify.error(errorText(err, 'Could not delete the deduction'))
    }
  }

  async function saveRules() {
    if (ruleDraft.absentDay.mode === 'PERCENT' && ruleDraft.absentDay.value > 100) {
      return notify.error('Absent-day percentage cannot exceed 100')
    }
    if (ruleDraft.lateComing.mode === 'PERCENT' && ruleDraft.lateComing.value > 100) {
      return notify.error('Late-coming percentage cannot exceed 100')
    }
    setSavingRules(true)
    try {
      const saved = await hrService.updateAttendanceRules(ruleDraft)
      setRules(saved)
      notify.success('Attendance deduction rules saved', 'Draft payrolls pick up the new rules when regenerated.')
    } catch (err) {
      notify.error(errorText(err, 'Could not save the rules'))
    } finally {
      setSavingRules(false)
    }
  }

  const basisText = (d: { percentage: number | null; fixedAmount: number | null }) =>
    [d.percentage ? formatPercentValue(d.percentage) : null, d.fixedAmount ? formatMoney(d.fixedAmount) : null]
      .filter(Boolean)
      .join(' + ')

  const scopeLabel = period === 'all' ? 'All months' : periodLabel(period)

  async function exportPdf() {
    try {
      await downloadLedgerPdf({
        school,
        title: 'Salary deductions',
        subtitle: scopeLabel,
        head: ['ID', 'Employee', 'Reason', 'Basis', 'Est. amount', 'Date', 'Added by', 'Status'],
        rows: filtered.map((d) => [
          d.deductionNo,
          `${d.employeeName} (${d.employeeNumber})`,
          DEDUCTION_REASON_LABEL[d.reason],
          basisText(d),
          formatMoney(estimate(d).amount),
          formatDate(d.date),
          d.addedByName,
          d.status === 'APPLIED' ? 'Applied' : 'Pending',
        ]),
        foot: ['', '', '', 'Total', formatMoney(stats.total), '', '', ''],
        rightAlign: [4],
        filename: `deductions-${period}.pdf`,
      })
      notify.success('Deductions downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the PDF'))
    }
  }

  async function exportExcel() {
    try {
      await downloadXlsx(
        [
          {
            name: 'Deductions',
            title: [school.name, `Salary deductions — ${scopeLabel}`],
            columns: [
              { header: 'Deduction ID', width: 13 },
              { header: 'Employee no.', width: 13 },
              { header: 'Employee', width: 24 },
              { header: 'Reason', width: 22 },
              { header: 'Percentage', width: 11 },
              { header: 'Fixed amount', width: 13, money: true },
              { header: 'Est. amount', width: 13, money: true },
              { header: 'Date', width: 12 },
              { header: 'Payroll month', width: 14 },
              { header: 'Notes', width: 30 },
              { header: 'Added by', width: 20 },
              { header: 'Status', width: 10 },
            ],
            rows: filtered.map((d) => [
              d.deductionNo,
              d.employeeNumber,
              d.employeeName,
              DEDUCTION_REASON_LABEL[d.reason],
              d.percentage ? `${d.percentage}%` : '',
              d.fixedAmount,
              estimate(d).amount,
              d.date,
              periodLabel(d.period),
              d.notes ?? '',
              d.addedByName,
              d.status === 'APPLIED' ? 'Applied' : 'Pending',
            ]),
            totals: ['Total', '', '', '', '', null, stats.total],
          },
        ],
        `deductions-${period}.xlsx`,
      )
      notify.success('Deductions downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the spreadsheet'))
    }
  }

  if (loading) return <LoadingState message="Loading deductions…" />

  const payable = employees.filter((e) => e.status !== 'RESIGNED')
  const rulesDirty = JSON.stringify(ruleDraft) !==
    JSON.stringify({
      enabled: rules.enabled,
      absentDay: rules.absentDay,
      lateComing: rules.lateComing,
      percentBase: rules.percentBase,
    })

  return (
    <div>
      <PageHeader
        title="Deductions"
        description="Custom salary deductions (absence, late coming, advances, loans, penalties) and automatic attendance deduction rules."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'HR & Payroll' }, { label: 'Deductions' }]}
        actions={
          canManage ? (
            <Button type="button" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Add deduction
            </Button>
          ) : undefined
        }
      />

      <Tabs defaultValue="deductions">
        <TabsList>
          <TabsTrigger value="deductions">Deductions</TabsTrigger>
          <TabsTrigger value="rules">Attendance rules</TabsTrigger>
        </TabsList>

        <TabsContent value="deductions">
          <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
            <StatCard label="Deductions" value={String(stats.count)} hint={scopeLabel} icon={ClipboardList} compact />
            <StatCard label="Pending" value={String(stats.pending)} hint="Not yet on a locked payroll" icon={CalendarClock} tone="warning" compact />
            <StatCard label="Applied" value={String(stats.applied)} icon={Percent} tone="success" compact />
            <StatCard
              label="Estimated total"
              value={formatMoney(stats.total)}
              hint="Based on current salary scales"
              icon={TrendingDown}
              tone="accent"
              compact
            />
          </div>

          <div className="mb-4 flex flex-wrap gap-3">
            <SearchInput
              id="deduction-search"
              name="deduction-search"
              value={search}
              onChange={setSearch}
              placeholder="Search employee, ID, notes…"
              className="min-w-[220px] flex-1"
            />
            <Select value={period} onChange={(e) => setPeriod(e.target.value)} className="w-44" aria-label="Payroll month">
              <option value="all">All months</option>
              {periodChoices.map((p) => (
                <option key={p} value={p}>
                  {MONTH_NAMES[Number(p.slice(5)) - 1]} {p.slice(0, 4)}
                </option>
              ))}
            </Select>
            <Select value={reason} onChange={(e) => setReason(e.target.value)} className="w-48" aria-label="Reason">
              <option value="all">All reasons</option>
              {DEDUCTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {DEDUCTION_REASON_LABEL[r]}
                </option>
              ))}
            </Select>
            <ExportButtons onPdf={exportPdf} onExcel={exportExcel} disabled={!filtered.length} />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No deductions"
              description={`No deductions recorded for ${scopeLabel.toLowerCase() === 'all months' ? 'any month' : scopeLabel}.`}
              actionLabel={canManage ? 'Add deduction' : undefined}
              onAction={canManage ? openCreate : undefined}
            />
          ) : (
            <>
              <DataTableShell>
                <DataTable className="min-w-[820px]">
                  <DataTableHead>
                    <tr>
                      <DataTableHeaderCell>Deduction</DataTableHeaderCell>
                      <DataTableHeaderCell>Employee</DataTableHeaderCell>
                      <DataTableHeaderCell>Basis</DataTableHeaderCell>
                      <DataTableHeaderCell className="text-right">Est. amount</DataTableHeaderCell>
                      <DataTableHeaderCell>Date</DataTableHeaderCell>
                      <DataTableHeaderCell>Status</DataTableHeaderCell>
                      <DataTableHeaderCell />
                    </tr>
                  </DataTableHead>
                  <DataTableBody>
                    {pageRows.map((d) => {
                      const est = estimate(d)
                      return (
                        <DataTableRow key={d.id}>
                          <DataTableCell>
                            <div className="font-medium">{DEDUCTION_REASON_LABEL[d.reason]}</div>
                            <div className="text-xs text-muted-foreground">
                              {d.deductionNo} · by {d.addedByName}
                            </div>
                            {d.notes ? <div className="mt-0.5 max-w-xs truncate text-xs">{d.notes}</div> : null}
                          </DataTableCell>
                          <DataTableCell className="text-sm">
                            <div>{d.employeeName}</div>
                            <div className="text-xs text-muted-foreground">{d.employeeNumber}</div>
                          </DataTableCell>
                          <DataTableCell className="whitespace-nowrap text-sm">{basisText(d)}</DataTableCell>
                          <DataTableCell className="text-right text-sm">
                            <span className="tabular-nums">{est.known ? formatMoney(est.amount) : '—'}</span>
                            {d.percentage && est.known ? (
                              <div className="text-[11px] text-muted-foreground">
                                {formatMoney(est.base)} × {formatPercentValue(d.percentage)}
                              </div>
                            ) : null}
                          </DataTableCell>
                          <DataTableCell className="whitespace-nowrap text-sm">
                            {formatDate(d.date)}
                            <div className="text-[11px] text-muted-foreground">{periodLabel(d.period)} payroll</div>
                          </DataTableCell>
                          <DataTableCell>
                            <Badge variant={d.status === 'APPLIED' ? 'success' : 'warning'}>
                              {d.status === 'APPLIED' ? 'Applied' : 'Pending'}
                            </Badge>
                          </DataTableCell>
                          <DataTableCell>
                            {canManage && d.status === 'PENDING' ? (
                              <div className="flex gap-1">
                                <Button type="button" size="sm" variant="outline" onClick={() => openEdit(d)}>
                                  Edit
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  aria-label={`Delete ${d.deductionNo}`}
                                  onClick={() => void remove(d)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : null}
                          </DataTableCell>
                        </DataTableRow>
                      )
                    })}
                  </DataTableBody>
                </DataTable>
              </DataTableShell>
              <TablePager page={page} pageCount={pageCount} onPageChange={setPage} total={filtered.length} noun="deduction" />
            </>
          )}
        </TabsContent>

        <TabsContent value="rules">
          <Card>
            <CardContent className="space-y-5 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-display text-base font-semibold">Automatic attendance deductions</p>
                  <p className="text-sm text-muted-foreground">
                    Deduct for days absent without an approved reason and for late check-ins. Counts come from
                    staff check-in for employees linked to a console login, and can be adjusted on the draft payroll.
                  </p>
                </div>
                <Switch
                  checked={ruleDraft.enabled}
                  disabled={!canManage}
                  aria-label="Enable attendance deductions"
                  onCheckedChange={(v) => setRuleDraft((r) => ({ ...r, enabled: v }))}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <RuleEditor
                  label="Absent day"
                  hint="Per working day absent without a notice or approved reason."
                  rule={ruleDraft.absentDay}
                  disabled={!canManage}
                  onChange={(absentDay) => setRuleDraft((r) => ({ ...r, absentDay }))}
                />
                <RuleEditor
                  label="Late coming"
                  hint="Per late check-in (after the check-in cut-off time)."
                  rule={ruleDraft.lateComing}
                  disabled={!canManage}
                  onChange={(lateComing) => setRuleDraft((r) => ({ ...r, lateComing }))}
                />
              </div>
              <Field className="max-w-sm">
                <Label>Percentages are calculated on</Label>
                <Select
                  value={ruleDraft.percentBase}
                  disabled={!canManage}
                  onChange={(e) =>
                    setRuleDraft((r) => ({ ...r, percentBase: e.target.value as AttendanceRulesInput['percentBase'] }))
                  }
                >
                  <option value="GROSS">Gross salary</option>
                  <option value="BASIC">Basic salary</option>
                </Select>
              </Field>
              <SectionNote>
                Example: gross salary $800 with a {ruleDraft.absentDay.mode === 'PERCENT' ? `${ruleDraft.absentDay.value}%` : formatMoney(ruleDraft.absentDay.value)} absent-day
                rule → one absent day deducts{' '}
                {formatMoney(ruleDraft.absentDay.mode === 'PERCENT' ? (800 * ruleDraft.absentDay.value) / 100 : ruleDraft.absentDay.value)}
                , net {formatMoney(800 - (ruleDraft.absentDay.mode === 'PERCENT' ? (800 * ruleDraft.absentDay.value) / 100 : ruleDraft.absentDay.value))}.
                The same percentage base applies to manual percentage deductions.
                {rules.updatedAt ? ` Last changed ${formatDate(rules.updatedAt)}${rules.updatedByName ? ` by ${rules.updatedByName}` : ''}.` : ''}
              </SectionNote>
              {canManage ? (
                <div className="flex justify-end">
                  <Button type="button" loading={savingRules} disabled={!rulesDirty} onClick={() => void saveRules()}>
                    Save rules
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.deductionNo}` : 'Add deduction'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field className="sm:col-span-2">
              <Label>Employee</Label>
              <Select value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}>
                <option value="">Choose an employee…</option>
                {payable.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.fullName} · {e.employeeNumber}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>Reason</Label>
              <Select
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value as DeductionReason }))}
              >
                {DEDUCTION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {DEDUCTION_REASON_LABEL[r]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </Field>
            <Field>
              <Label>Percentage (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step="0.01"
                placeholder="e.g. 5"
                value={form.percentage}
                onChange={(e) => setForm((f) => ({ ...f, percentage: e.target.value }))}
              />
            </Field>
            <Field>
              <Label>Fixed amount</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. 40"
                value={form.fixedAmount}
                onChange={(e) => setForm((f) => ({ ...f, fixedAmount: e.target.value }))}
              />
            </Field>
            {preview && (preview.pct || preview.fixed) ? (
              <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm sm:col-span-2">
                {preview.known ? (
                  <>
                    {preview.pct ? `${formatMoney(preview.base)} × ${formatPercentValue(preview.pct)}` : ''}
                    {preview.pct && preview.fixed ? ' + ' : ''}
                    {preview.fixed ? formatMoney(preview.fixed) : ''} ={' '}
                    <span className="font-semibold tabular-nums">{formatMoney(preview.amount)}</span> deduction
                    {preview.base ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · net {formatMoney(Math.max(0, preview.base - preview.amount))}
                        {rules.percentBase === 'BASIC' ? ' of basic' : ''}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    This employee has no salary scale yet — the percentage is applied when the payroll is generated.
                  </span>
                )}
              </div>
            ) : null}
            <Field className="sm:col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Applies to the payroll month of the date. Months that are already approved or locked can’t take new deductions.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
