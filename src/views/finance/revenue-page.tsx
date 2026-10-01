import { useCallback, useEffect, useMemo, useState } from 'react'
import { Banknote, Gift, HandCoins, Plus, Trash2, TrendingUp } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { REVENUE_SOURCES, REVENUE_SOURCE_LABEL, formatMoney } from '@/lib/hr/constants'
import { downloadLedgerPdf } from '@/lib/hr/hr-pdf'
import { round2 } from '@/lib/hr/payroll-engine'
import { notify } from '@/lib/notify'
import { formatDate } from '@/lib/utils'
import { downloadXlsx } from '@/lib/xlsx'
import { financeService } from '@/services/hr'
import type { Revenue, RevenueInput, RevenueSource } from '@/types'
import {
  ExportButtons,
  Money,
  SectionNote,
  TablePager,
  errorText,
  todayIso,
  useHrAccess,
  useLetterhead,
  usePaged,
} from '@/views/hr/shared'
import { DateRangeFilter, rangeLabel, usePresetRange } from '@/views/finance/date-range'

type RevenueForm = { date: string; source: RevenueSource; description: string; amount: string; reference: string }

const emptyForm = (): RevenueForm => ({
  date: todayIso(),
  source: 'PROJECT_INCOME',
  description: '',
  amount: '',
  reference: '',
})

const SOURCE_VARIANT: Record<RevenueSource, 'success' | 'accent' | 'warning' | 'secondary'> = {
  SCHOOL_FEES: 'success',
  PROJECT_INCOME: 'accent',
  DONATION: 'warning',
  OTHER: 'secondary',
}

export function RevenuePage() {
  const can = useHrAccess()
  const canManage = can('finance.manage')
  const school = useLetterhead()
  const range = usePresetRange('this-year')
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Revenue[]>([])
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Revenue | null>(null)
  const [form, setForm] = useState<RevenueForm>(emptyForm())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setRows(await financeService.listRevenues({ from: range.from, to: range.to }))
  }, [range.from, range.to])

  useEffect(() => {
    if (range.from > range.to) return
    setLoading(true)
    load()
      .catch((err) => notify.error(errorText(err, 'Could not load revenue')))
      .finally(() => setLoading(false))
  }, [load, range.from, range.to])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows
      .filter((r) => source === 'all' || r.source === source)
      .filter((r) => !q || `${r.revenueNo} ${r.description} ${r.reference ?? ''}`.toLowerCase().includes(q))
  }, [rows, search, source])
  const { page, setPage, pageCount, pageRows } = usePaged(filtered, 15)
  useEffect(() => setPage(1), [search, source, range.from, range.to, setPage])

  const stats = useMemo(() => {
    const sum = (s?: RevenueSource) =>
      round2(filtered.filter((r) => !s || r.source === s).reduce((t, r) => t + r.amount, 0))
    return {
      total: sum(),
      fees: sum('SCHOOL_FEES'),
      projects: sum('PROJECT_INCOME'),
      donations: sum('DONATION'),
      other: sum('OTHER'),
    }
  }, [filtered])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setOpen(true)
  }

  function openEdit(r: Revenue) {
    setEditing(r)
    setForm({
      date: r.date,
      source: r.source,
      description: r.description,
      amount: String(r.amount),
      reference: r.reference ?? '',
    })
    setOpen(true)
  }

  async function save() {
    const amount = Number(form.amount)
    if (form.description.trim().length < 2) return notify.error('Description is required')
    if (!(amount > 0)) return notify.error('Enter an amount greater than zero')
    const payload: RevenueInput = {
      date: form.date,
      source: form.source,
      description: form.description.trim(),
      amount,
      reference: form.reference.trim(),
    }
    setSaving(true)
    try {
      if (editing) {
        await financeService.updateRevenue(editing.id, payload)
        notify.success('Revenue entry updated')
      } else {
        const created = await financeService.createRevenue(payload)
        notify.success('Revenue recorded', `${created.revenueNo} · ${formatMoney(created.amount)}`)
      }
      setOpen(false)
      await load()
    } catch (err) {
      notify.error(errorText(err, 'Could not save the revenue entry'))
    } finally {
      setSaving(false)
    }
  }

  async function remove(r: Revenue) {
    if (!window.confirm(`Delete ${r.revenueNo} (${r.description}, ${formatMoney(r.amount)})?`)) return
    try {
      await financeService.deleteRevenue(r.id)
      notify.success('Revenue entry deleted')
      await load()
    } catch (err) {
      notify.error(errorText(err, 'Could not delete the revenue entry'))
    }
  }

  const subtitle = rangeLabel(range)

  async function exportPdf() {
    try {
      await downloadLedgerPdf({
        school,
        title: 'Revenue register',
        subtitle,
        head: ['ID', 'Date', 'Source', 'Description', 'Reference', 'Amount'],
        rows: filtered.map((r) => [
          r.revenueNo,
          formatDate(r.date),
          REVENUE_SOURCE_LABEL[r.source],
          r.description,
          r.reference || '—',
          formatMoney(r.amount),
        ]),
        foot: ['', '', '', '', 'Total', formatMoney(stats.total)],
        rightAlign: [5],
        filename: `revenue-${range.from}-to-${range.to}.pdf`,
      })
      notify.success('Revenue register downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the PDF'))
    }
  }

  async function exportExcel() {
    try {
      await downloadXlsx(
        [
          {
            name: 'Revenue',
            title: [school.name, `Revenue register — ${subtitle}`],
            columns: [
              { header: 'Revenue ID', width: 12 },
              { header: 'Date', width: 12 },
              { header: 'Source', width: 16 },
              { header: 'Description', width: 34 },
              { header: 'Reference', width: 16 },
              { header: 'Amount', width: 14, money: true },
              { header: 'Recorded by', width: 20 },
            ],
            rows: filtered.map((r) => [
              r.revenueNo,
              r.date,
              REVENUE_SOURCE_LABEL[r.source],
              r.description,
              r.reference ?? '',
              r.amount,
              r.createdByName,
            ]),
            totals: ['Total', '', '', '', '', stats.total],
          },
        ],
        `revenue-${range.from}-to-${range.to}.xlsx`,
      )
      notify.success('Revenue register downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the spreadsheet'))
    }
  }

  return (
    <div>
      <PageHeader
        title="Revenue"
        description="School fees received outside the fees module, project income, donations and other income."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Finance' }, { label: 'Revenue' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <ExportButtons onPdf={exportPdf} onExcel={exportExcel} disabled={!filtered.length} />
            {canManage ? (
              <Button type="button" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Record revenue
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard label="Total recorded" value={formatMoney(stats.total)} hint={subtitle} icon={TrendingUp} tone="success" compact />
        <StatCard label="School fees" value={formatMoney(stats.fees)} hint="Entered here (not from Fees)" icon={Banknote} compact />
        <StatCard label="Project income" value={formatMoney(stats.projects)} icon={HandCoins} tone="accent" compact />
        <StatCard
          label="Donations"
          value={formatMoney(stats.donations)}
          hint={stats.other ? `Other income ${formatMoney(stats.other)}` : undefined}
          icon={Gift}
          tone="warning"
          compact
        />
      </div>

      <SectionNote>
        Fee payments recorded in Fees &amp; Payments already count as revenue on the financial dashboard. Use
        “School fees” here only for fees received outside the system, to avoid counting them twice.
      </SectionNote>

      <DateRangeFilter range={range} />

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput
          id="revenue-search"
          name="revenue-search"
          value={search}
          onChange={setSearch}
          placeholder="Search description, reference, ID…"
          className="min-w-[220px] flex-1"
        />
        <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-44" aria-label="Source">
          <option value="all">All sources</option>
          {REVENUE_SOURCES.map((s) => (
            <option key={s} value={s}>
              {REVENUE_SOURCE_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <LoadingState message="Loading revenue…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title="No revenue entries"
          description={`Nothing recorded for ${subtitle.toLowerCase()}${search || source !== 'all' ? ' that matches the filters' : ''}.`}
          actionLabel={canManage ? 'Record revenue' : undefined}
          onAction={canManage ? openCreate : undefined}
        />
      ) : (
        <>
          <DataTableShell>
            <DataTable>
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Date</DataTableHeaderCell>
                  <DataTableHeaderCell>Description</DataTableHeaderCell>
                  <DataTableHeaderCell>Source</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Amount</DataTableHeaderCell>
                  <DataTableHeaderCell />
                </tr>
              </DataTableHead>
              <DataTableBody>
                {pageRows.map((r) => (
                  <DataTableRow key={r.id}>
                    <DataTableCell className="whitespace-nowrap text-sm">
                      {formatDate(r.date)}
                      <div className="text-[11px] text-muted-foreground">{r.revenueNo}</div>
                    </DataTableCell>
                    <DataTableCell>
                      <div className="font-medium">{r.description}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.reference ? `Ref ${r.reference} · ` : ''}by {r.createdByName}
                      </div>
                    </DataTableCell>
                    <DataTableCell>
                      <Badge variant={SOURCE_VARIANT[r.source]}>{REVENUE_SOURCE_LABEL[r.source]}</Badge>
                    </DataTableCell>
                    <DataTableCell className="text-right font-semibold">
                      <Money value={r.amount} />
                    </DataTableCell>
                    <DataTableCell>
                      {canManage ? (
                        <div className="flex justify-end gap-1">
                          <Button type="button" size="sm" variant="outline" onClick={() => openEdit(r)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`Delete ${r.revenueNo}`}
                            onClick={() => void remove(r)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : null}
                    </DataTableCell>
                  </DataTableRow>
                ))}
              </DataTableBody>
              <tfoot className="border-t border-border bg-muted/30 text-sm font-semibold">
                <tr>
                  <td className="px-3 py-3 sm:px-4" colSpan={3}>
                    Total · {filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums sm:px-4">{formatMoney(stats.total)}</td>
                  <td />
                </tr>
              </tfoot>
            </DataTable>
          </DataTableShell>
          <TablePager page={page} pageCount={pageCount} onPageChange={setPage} total={filtered.length} noun="entry" plural="entries" />
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.revenueNo}` : 'Record revenue'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </Field>
            <Field>
              <Label>Source</Label>
              <Select
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value as RevenueSource }))}
              >
                {REVENUE_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {REVENUE_SOURCE_LABEL[s]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field className="sm:col-span-2">
              <Label>Description</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
            <Field>
              <Label>Amount</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </Field>
            <Field>
              <Label>Reference (optional)</Label>
              <Input
                value={form.reference}
                placeholder="Receipt or bank ref"
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              />
            </Field>
          </div>
          {form.source === 'SCHOOL_FEES' ? (
            <p className="mt-1 text-xs text-warning">
              Only record fees here if they were not captured in Fees &amp; Payments.
            </p>
          ) : null}
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
