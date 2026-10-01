import { useEffect, useMemo, useState } from 'react'
import { History, Layers, Plus, Power, TrendingUp, Wallet } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { HR_CATEGORIES, HR_CATEGORY_LABEL, formatMoney } from '@/lib/hr/constants'
import { downloadLedgerPdf } from '@/lib/hr/hr-pdf'
import { allowancesOf, grossOf } from '@/lib/hr/payroll-engine'
import { notify } from '@/lib/notify'
import { formatDate } from '@/lib/utils'
import { downloadXlsx } from '@/lib/xlsx'
import { hrService } from '@/services/hr'
import type { HrStaffCategory, SalaryScaleInput, SalaryScaleVersion } from '@/types'
import {
  ExportButtons,
  Money,
  ScaleStatusBadge,
  SectionNote,
  TablePager,
  errorText,
  todayIso,
  useHrAccess,
  useLetterhead,
  usePaged,
} from '@/views/hr/shared'

const emptyForm = (): SalaryScaleInput => ({
  category: 'TEACHER',
  position: '',
  grade: '',
  basicSalary: 0,
  housingAllowance: 0,
  transportAllowance: 0,
  otherAllowances: 0,
  effectiveDate: todayIso(),
  notes: '',
})

type DialogMode = { kind: 'create' } | { kind: 'revise'; scale: SalaryScaleVersion }

export function SalaryScalesPage() {
  const can = useHrAccess()
  const canManage = can('hr.manage')
  const school = useLetterhead()
  const [loading, setLoading] = useState(true)
  const [versions, setVersions] = useState<SalaryScaleVersion[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [mode, setMode] = useState<DialogMode | null>(null)
  const [form, setForm] = useState<SalaryScaleInput>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [historyFor, setHistoryFor] = useState<string | null>(null)

  async function reload() {
    setVersions(await hrService.listScales())
  }

  useEffect(() => {
    reload()
      .catch((err) => notify.error(errorText(err, 'Could not load salary scales')))
      .finally(() => setLoading(false))
  }, [])

  const current = useMemo(() => versions.filter((v) => v.current), [versions])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return current
      .filter((s) => category === 'all' || s.category === category)
      .filter((s) => status === 'all' || s.status === status)
      .filter((s) => !q || `${s.scaleId} ${s.position} ${s.grade}`.toLowerCase().includes(q))
  }, [current, search, category, status])
  const { page, setPage, pageCount, pageRows } = usePaged(filtered)
  useEffect(() => setPage(1), [search, category, status, setPage])

  const stats = useMemo(() => {
    const active = current.filter((s) => s.status === 'ACTIVE')
    const gross = active.map((s) => s.grossSalary)
    return {
      scales: current.length,
      active: active.length,
      versions: versions.length,
      highest: gross.length ? Math.max(...gross) : 0,
      lowest: gross.length ? Math.min(...gross) : 0,
    }
  }, [current, versions])

  const history = useMemo(
    () => (historyFor ? versions.filter((v) => v.scaleId === historyFor) : []),
    [versions, historyFor],
  )

  function openCreate() {
    setForm(emptyForm())
    setMode({ kind: 'create' })
  }

  function openRevise(scale: SalaryScaleVersion) {
    setForm({
      category: scale.category,
      position: scale.position,
      grade: scale.grade,
      basicSalary: scale.basicSalary,
      housingAllowance: scale.housingAllowance,
      transportAllowance: scale.transportAllowance,
      otherAllowances: scale.otherAllowances,
      effectiveDate: todayIso() < scale.effectiveDate ? scale.effectiveDate : todayIso(),
      notes: '',
    })
    setMode({ kind: 'revise', scale })
  }

  async function save() {
    if (!mode) return
    if (form.position.trim().length < 2) return notify.error('Position is required')
    if (!form.grade.trim()) return notify.error('Grade is required')
    if (!form.effectiveDate) return notify.error('Effective date is required')
    setSaving(true)
    try {
      if (mode.kind === 'create') {
        const created = await hrService.createScale(form)
        notify.success('Salary scale created', `${created.scaleId} · gross ${formatMoney(created.grossSalary)}`)
      } else {
        await hrService.reviseScale(mode.scale.scaleId, form)
        notify.success(
          'Salary scale revised',
          `Version ${mode.scale.version + 1} takes effect ${formatDate(form.effectiveDate)}. Earlier versions are kept.`,
        )
      }
      setMode(null)
      await reload()
    } catch (err) {
      notify.error(errorText(err, 'Could not save the salary scale'))
    } finally {
      setSaving(false)
    }
  }

  async function toggleStatus(scale: SalaryScaleVersion) {
    const next = scale.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    if (
      next === 'INACTIVE' &&
      !window.confirm(
        `Deactivate ${scale.scaleId}? Employees on this scale are left off new payrolls until it is reactivated.`,
      )
    ) {
      return
    }
    try {
      await hrService.setScaleStatus(scale.scaleId, next)
      notify.success(next === 'ACTIVE' ? 'Salary scale activated' : 'Salary scale deactivated')
      await reload()
    } catch (err) {
      notify.error(errorText(err, 'Could not change the status'))
    }
  }

  async function exportPdf() {
    try {
      await downloadLedgerPdf({
        school,
        title: 'Salary scales',
        subtitle: `Current versions · ${filtered.length} scale${filtered.length === 1 ? '' : 's'}`,
        head: ['Scale', 'Category', 'Position', 'Grade', 'Basic', 'Housing', 'Transport', 'Other', 'Gross', 'Effective', 'Status'],
        rows: filtered.map((s) => [
          `${s.scaleId} v${s.version}`,
          HR_CATEGORY_LABEL[s.category],
          s.position,
          s.grade,
          formatMoney(s.basicSalary),
          formatMoney(s.housingAllowance),
          formatMoney(s.transportAllowance),
          formatMoney(s.otherAllowances),
          formatMoney(s.grossSalary),
          formatDate(s.effectiveDate),
          s.status === 'ACTIVE' ? 'Active' : 'Inactive',
        ]),
        rightAlign: [4, 5, 6, 7, 8],
        filename: 'salary-scales.pdf',
      })
      notify.success('Salary scales downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the PDF'))
    }
  }

  async function exportExcel() {
    const columns = [
      { header: 'Scale ID', width: 12 },
      { header: 'Version', width: 9 },
      { header: 'Category', width: 20 },
      { header: 'Position', width: 22 },
      { header: 'Grade', width: 8 },
      { header: 'Basic salary', width: 14, money: true },
      { header: 'Housing', width: 12, money: true },
      { header: 'Transport', width: 12, money: true },
      { header: 'Other allowances', width: 16, money: true },
      { header: 'Gross salary', width: 14, money: true },
      { header: 'Effective date', width: 14 },
      { header: 'Status', width: 10 },
      { header: 'Created by', width: 20 },
    ]
    const row = (s: SalaryScaleVersion) => [
      s.scaleId,
      s.version,
      HR_CATEGORY_LABEL[s.category],
      s.position,
      s.grade,
      s.basicSalary,
      s.housingAllowance,
      s.transportAllowance,
      s.otherAllowances,
      s.grossSalary,
      s.effectiveDate,
      s.status === 'ACTIVE' ? 'Active' : 'Inactive',
      s.createdByName ?? '',
    ]
    try {
      await downloadXlsx(
        [
          { name: 'Current scales', title: [school.name, 'Salary scales'], columns, rows: filtered.map(row) },
          { name: 'History', title: [school.name, 'Salary scale history'], columns, rows: versions.map(row) },
        ],
        'salary-scales.xlsx',
      )
      notify.success('Salary scales downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the spreadsheet'))
    }
  }

  if (loading) return <LoadingState message="Loading salary scales…" />

  const money = (key: keyof SalaryScaleInput, label: string) => (
    <Field>
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        step="0.01"
        value={form[key] as number}
        onChange={(e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) || 0 }))}
      />
    </Field>
  )

  return (
    <div>
      <PageHeader
        title="Salary scales"
        description="Basic salary and allowances per category, position and grade. Revisions add a new version, so past payrolls keep the amounts they were paid on."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'HR & Payroll' }, { label: 'Salary scales' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <ExportButtons onPdf={exportPdf} onExcel={exportExcel} disabled={!filtered.length} />
            {canManage ? (
              <Button type="button" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                New salary scale
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard label="Salary scales" value={String(stats.scales)} icon={Layers} compact />
        <StatCard label="Active" value={String(stats.active)} icon={Power} tone="success" compact />
        <StatCard
          label="Gross range"
          value={stats.active ? `${formatMoney(stats.lowest)} – ${formatMoney(stats.highest)}` : '—'}
          icon={Wallet}
          tone="accent"
          compact
        />
        <StatCard
          label="Versions on record"
          value={String(stats.versions)}
          hint="Salary history is never overwritten"
          icon={TrendingUp}
          tone="warning"
          compact
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput
          id="scale-search"
          name="scale-search"
          value={search}
          onChange={setSearch}
          placeholder="Search scale ID, position, grade…"
          className="min-w-[220px] flex-1"
        />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-48">
          <option value="all">All categories</option>
          {HR_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {HR_CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="all">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={current.length ? 'No salary scales match' : 'No salary scales yet'}
          description={
            current.length
              ? 'Try a different search or filter.'
              : 'Create a salary scale (e.g. Teacher grade A: basic $800, housing $50, transport $30) and assign it to employees.'
          }
          actionLabel={!current.length && canManage ? 'New salary scale' : undefined}
          onAction={!current.length && canManage ? openCreate : undefined}
        />
      ) : (
        <>
          <DataTableShell>
            <DataTable>
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Scale</DataTableHeaderCell>
                  <DataTableHeaderCell>Position · grade</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Basic</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Allowances</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Gross</DataTableHeaderCell>
                  <DataTableHeaderCell>Effective</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell />
                </tr>
              </DataTableHead>
              <DataTableBody>
                {pageRows.map((s) => (
                  <DataTableRow key={s.id}>
                    <DataTableCell>
                      <div className="font-medium">{s.scaleId}</div>
                      <div className="text-xs text-muted-foreground">Version {s.version}</div>
                    </DataTableCell>
                    <DataTableCell className="text-sm">
                      <div>
                        {s.position} · Grade {s.grade}
                      </div>
                      <div className="text-xs text-muted-foreground">{HR_CATEGORY_LABEL[s.category]}</div>
                    </DataTableCell>
                    <DataTableCell className="text-right text-sm">
                      <Money value={s.basicSalary} />
                    </DataTableCell>
                    <DataTableCell className="text-right text-sm">
                      <Money value={allowancesOf(s)} />
                      <div className="text-[11px] text-muted-foreground">
                        H {formatMoney(s.housingAllowance)} · T {formatMoney(s.transportAllowance)}
                        {s.otherAllowances ? ` · O ${formatMoney(s.otherAllowances)}` : ''}
                      </div>
                    </DataTableCell>
                    <DataTableCell className="text-right font-semibold">
                      <Money value={s.grossSalary} />
                    </DataTableCell>
                    <DataTableCell className="whitespace-nowrap text-sm">{formatDate(s.effectiveDate)}</DataTableCell>
                    <DataTableCell>
                      <ScaleStatusBadge status={s.status} />
                    </DataTableCell>
                    <DataTableCell>
                      <div className="flex flex-wrap gap-1">
                        {canManage ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => openRevise(s)}>
                            Edit
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`History of ${s.scaleId}`}
                          onClick={() => setHistoryFor(s.scaleId)}
                        >
                          <History className="h-4 w-4" />
                        </Button>
                        {canManage ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => void toggleStatus(s)}>
                            {s.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </Button>
                        ) : null}
                      </div>
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </DataTableShell>
          <TablePager page={page} pageCount={pageCount} onPageChange={setPage} total={filtered.length} noun="scale" />
        </>
      )}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {mode?.kind === 'revise' ? `Edit ${mode.scale.scaleId}` : 'New salary scale'}
            </DialogTitle>
          </DialogHeader>
          {mode?.kind === 'revise' ? (
            <SectionNote>
              Saving creates version {mode.scale.version + 1}. Version {mode.scale.version} (effective{' '}
              {formatDate(mode.scale.effectiveDate)}) stays on record and is still used for payroll
              months before the new effective date.
            </SectionNote>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <Label>Staff category</Label>
              <Select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as HrStaffCategory }))}
              >
                {HR_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {HR_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>Position</Label>
              <Input
                value={form.position}
                onChange={(e) => setForm((f) => ({ ...f, position: e.target.value }))}
              />
            </Field>
            <Field>
              <Label>Grade</Label>
              <Input value={form.grade} onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))} />
            </Field>
            <Field>
              <Label>Effective date</Label>
              <Input
                type="date"
                value={form.effectiveDate}
                min={mode?.kind === 'revise' ? mode.scale.effectiveDate : undefined}
                onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))}
              />
            </Field>
            {money('basicSalary', 'Basic salary')}
            {money('housingAllowance', 'Housing allowance')}
            {money('transportAllowance', 'Transport allowance')}
            {money('otherAllowances', 'Other allowances')}
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 sm:col-span-2">
              <span className="text-sm text-muted-foreground">Total gross salary</span>
              <span className="font-display text-lg font-semibold tabular-nums">{formatMoney(grossOf(form))}</span>
            </div>
            <Field className="sm:col-span-2">
              <Label>Notes</Label>
              <Textarea
                value={form.notes || ''}
                placeholder={mode?.kind === 'revise' ? 'Reason for the change (optional)' : undefined}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button type="button" loading={saving} onClick={() => void save()}>
              {mode?.kind === 'revise' ? 'Save new version' : 'Create scale'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={historyFor !== null} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Salary history · {historyFor}</DialogTitle>
          </DialogHeader>
          <DataTableShell>
            <DataTable>
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Version</DataTableHeaderCell>
                  <DataTableHeaderCell>Effective</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Basic</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Allowances</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Gross</DataTableHeaderCell>
                  <DataTableHeaderCell>Recorded</DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {history.map((v) => (
                  <DataTableRow key={v.id}>
                    <DataTableCell>
                      <span className="font-medium">v{v.version}</span>
                      {v.current ? <span className="ml-2 text-xs text-success">current</span> : null}
                      <div className="text-xs text-muted-foreground">
                        {v.position} · Grade {v.grade}
                      </div>
                    </DataTableCell>
                    <DataTableCell className="whitespace-nowrap text-sm">{formatDate(v.effectiveDate)}</DataTableCell>
                    <DataTableCell className="text-right text-sm">
                      <Money value={v.basicSalary} />
                    </DataTableCell>
                    <DataTableCell className="text-right text-sm">
                      <Money value={allowancesOf(v)} />
                    </DataTableCell>
                    <DataTableCell className="text-right font-semibold">
                      <Money value={v.grossSalary} />
                    </DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {formatDate(v.createdAt)}
                      {v.createdByName ? ` · ${v.createdByName}` : ''}
                      {v.notes ? <div className="mt-0.5 text-foreground/80">{v.notes}</div> : null}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
            </DataTable>
          </DataTableShell>
        </DialogContent>
      </Dialog>
    </div>
  )
}
