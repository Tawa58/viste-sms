import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarRange, Lock, Plus, Receipt, Tags, Trash2, TrendingDown, Users } from 'lucide-react'
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
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, SALARIES_CATEGORY, formatMoney } from '@/lib/hr/constants'
import { downloadLedgerPdf } from '@/lib/hr/hr-pdf'
import { round2 } from '@/lib/hr/payroll-engine'
import { notify } from '@/lib/notify'
import { formatDate } from '@/lib/utils'
import { downloadXlsx } from '@/lib/xlsx'
import { financeService } from '@/services/hr'
import type { Expense, ExpenseCategory, ExpenseInput, ExpensePaymentMethod } from '@/types'
import {
  ExportButtons,
  Money,
  TablePager,
  errorText,
  todayIso,
  useHrAccess,
  useLetterhead,
  usePaged,
} from '@/views/hr/shared'
import { DateRangeFilter, rangeLabel, usePresetRange } from '@/views/finance/date-range'

type ExpenseForm = {
  date: string
  category: string
  description: string
  quantity: string
  unitPrice: string
  supplier: string
  paymentMethod: ExpensePaymentMethod
  notes: string
}

const emptyForm = (): ExpenseForm => ({
  date: todayIso(),
  category: 'Stationery',
  description: '',
  quantity: '1',
  unitPrice: '',
  supplier: '',
  paymentMethod: 'CASH',
  notes: '',
})

export function ExpensesPage() {
  const can = useHrAccess()
  const canManage = can('finance.manage')
  const school = useLetterhead()
  const range = usePresetRange('this-month')
  const [loading, setLoading] = useState(true)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [method, setMethod] = useState('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [form, setForm] = useState<ExpenseForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [newCategory, setNewCategory] = useState('')

  const load = useCallback(async () => {
    setExpenses(await financeService.listExpenses({ from: range.from, to: range.to }))
  }, [range.from, range.to])

  useEffect(() => {
    financeService
      .listExpenseCategories()
      .then(setCategories)
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (range.from > range.to) return
    setLoading(true)
    load()
      .catch((err) => notify.error(errorText(err, 'Could not load expenses')))
      .finally(() => setLoading(false))
  }, [load, range.from, range.to])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return expenses
      .filter((e) => category === 'all' || e.category === category)
      .filter((e) => method === 'all' || e.paymentMethod === method)
      .filter(
        (e) =>
          !q ||
          `${e.expenseNo} ${e.description} ${e.supplier} ${e.category} ${e.notes ?? ''}`.toLowerCase().includes(q),
      )
  }, [expenses, search, category, method])
  const { page, setPage, pageCount, pageRows } = usePaged(filtered, 15)
  useEffect(() => setPage(1), [search, category, method, range.from, range.to, setPage])

  const stats = useMemo(() => {
    const total = round2(filtered.reduce((s, e) => s + e.totalAmount, 0))
    const salaries = round2(filtered.filter((e) => e.category === SALARIES_CATEGORY).reduce((s, e) => s + e.totalAmount, 0))
    const byCat = new Map<string, number>()
    for (const e of filtered) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.totalAmount)
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0]
    return { total, salaries, count: filtered.length, top }
  }, [filtered])

  const categoryNames = useMemo(() => {
    const names = new Set(categories.map((c) => c.name))
    for (const e of expenses) names.add(e.category)
    return [...names]
  }, [categories, expenses])

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setOpen(true)
  }

  function openEdit(e: Expense) {
    setEditing(e)
    setForm({
      date: e.date,
      category: e.category,
      description: e.description,
      quantity: String(e.quantity),
      unitPrice: String(e.unitPrice),
      supplier: e.supplier,
      paymentMethod: e.paymentMethod,
      notes: e.notes ?? '',
    })
    setOpen(true)
  }

  const formTotal = round2((Number(form.quantity) || 0) * (Number(form.unitPrice) || 0))

  async function save() {
    const quantity = Number(form.quantity)
    const unitPrice = Number(form.unitPrice)
    if (form.description.trim().length < 2) return notify.error('Description is required')
    if (!(quantity > 0)) return notify.error('Quantity must be more than zero')
    if (!(unitPrice >= 0) || form.unitPrice.trim() === '') return notify.error('Enter the unit price')
    const payload: ExpenseInput = {
      date: form.date,
      category: form.category,
      description: form.description.trim(),
      quantity,
      unitPrice,
      supplier: form.supplier.trim(),
      paymentMethod: form.paymentMethod,
      notes: form.notes.trim(),
    }
    setSaving(true)
    try {
      if (editing) {
        await financeService.updateExpense(editing.id, payload)
        notify.success('Expense updated')
      } else {
        const created = await financeService.createExpense(payload)
        notify.success('Expense recorded', `${created.expenseNo} · ${formatMoney(created.totalAmount)}`)
      }
      setOpen(false)
      await load()
    } catch (err) {
      notify.error(errorText(err, 'Could not save the expense'))
    } finally {
      setSaving(false)
    }
  }

  async function remove(e: Expense) {
    if (!window.confirm(`Delete ${e.expenseNo} (${e.description}, ${formatMoney(e.totalAmount)})?`)) return
    try {
      await financeService.deleteExpense(e.id)
      notify.success('Expense deleted')
      await load()
    } catch (err) {
      notify.error(errorText(err, 'Could not delete the expense'))
    }
  }

  async function addCategory() {
    if (newCategory.trim().length < 2) return notify.error('Enter a category name')
    try {
      const created = await financeService.createExpenseCategory(newCategory)
      setCategories((c) => [...c, created])
      setNewCategory('')
      notify.success('Category added')
    } catch (err) {
      notify.error(errorText(err, 'Could not add the category'))
    }
  }

  async function removeCategory(c: ExpenseCategory) {
    if (!window.confirm(`Remove the “${c.name}” category? Existing expenses keep their category.`)) return
    try {
      await financeService.deleteExpenseCategory(c.id)
      setCategories((list) => list.filter((x) => x.id !== c.id))
      notify.success('Category removed')
    } catch (err) {
      notify.error(errorText(err, 'Could not remove the category'))
    }
  }

  const subtitle = rangeLabel(range)

  async function exportPdf() {
    try {
      await downloadLedgerPdf({
        school,
        title: 'Expenses',
        subtitle,
        head: ['ID', 'Date', 'Category', 'Description', 'Qty', 'Unit price', 'Total', 'Supplier', 'Method'],
        rows: filtered.map((e) => [
          e.expenseNo,
          formatDate(e.date),
          e.category,
          e.description,
          String(e.quantity),
          formatMoney(e.unitPrice),
          formatMoney(e.totalAmount),
          e.supplier || '—',
          PAYMENT_METHOD_LABEL[e.paymentMethod],
        ]),
        foot: ['', '', '', 'Total', '', '', formatMoney(stats.total), '', ''],
        rightAlign: [4, 5, 6],
        filename: `expenses-${range.from}-to-${range.to}.pdf`,
      })
      notify.success('Expenses downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the PDF'))
    }
  }

  async function exportExcel() {
    try {
      await downloadXlsx(
        [
          {
            name: 'Expenses',
            title: [school.name, `Expenses — ${subtitle}`],
            columns: [
              { header: 'Expense ID', width: 12 },
              { header: 'Date', width: 12 },
              { header: 'Category', width: 18 },
              { header: 'Description', width: 32 },
              { header: 'Quantity', width: 10 },
              { header: 'Unit price', width: 12, money: true },
              { header: 'Total amount', width: 14, money: true },
              { header: 'Supplier', width: 20 },
              { header: 'Payment method', width: 16 },
              { header: 'Notes', width: 30 },
              { header: 'Recorded by', width: 20 },
            ],
            rows: filtered.map((e) => [
              e.expenseNo,
              e.date,
              e.category,
              e.description,
              e.quantity,
              e.unitPrice,
              e.totalAmount,
              e.supplier,
              PAYMENT_METHOD_LABEL[e.paymentMethod],
              e.notes ?? '',
              e.createdByName,
            ]),
            totals: ['Total', '', '', '', '', null, stats.total],
          },
        ],
        `expenses-${range.from}-to-${range.to}.xlsx`,
      )
      notify.success('Expenses downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the spreadsheet'))
    }
  }

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Daily school expenses — quantity × unit price, supplier and payment method. Salary payrolls are posted here automatically when locked."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Finance' }, { label: 'Expenses' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <ExportButtons onPdf={exportPdf} onExcel={exportExcel} disabled={!filtered.length} />
            {canManage ? (
              <>
                <Button type="button" variant="outline" onClick={() => setCatOpen(true)}>
                  <Tags className="h-4 w-4" />
                  Categories
                </Button>
                <Button type="button" onClick={openCreate}>
                  <Plus className="h-4 w-4" />
                  Record expense
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard label="Total expenses" value={formatMoney(stats.total)} hint={subtitle} icon={TrendingDown} tone="warning" compact />
        <StatCard label="Entries" value={String(stats.count)} icon={Receipt} compact />
        <StatCard label="Salaries" value={formatMoney(stats.salaries)} icon={Users} tone="accent" compact />
        <StatCard
          label="Largest category"
          value={stats.top ? stats.top[0] : '—'}
          hint={stats.top ? formatMoney(stats.top[1]) : undefined}
          icon={CalendarRange}
          tone="success"
          compact
        />
      </div>

      <DateRangeFilter range={range} />

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput
          id="expense-search"
          name="expense-search"
          value={search}
          onChange={setSearch}
          placeholder="Search description, supplier, ID…"
          className="min-w-[220px] flex-1"
        />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-44" aria-label="Category">
          <option value="all">All categories</option>
          {categoryNames.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select value={method} onChange={(e) => setMethod(e.target.value)} className="w-44" aria-label="Payment method">
          <option value="all">All payment methods</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m]}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <LoadingState message="Loading expenses…" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="No expenses"
          description={`No expenses recorded for ${subtitle.toLowerCase()}${search || category !== 'all' || method !== 'all' ? ' that match the filters' : ''}.`}
          actionLabel={canManage ? 'Record expense' : undefined}
          onAction={canManage ? openCreate : undefined}
        />
      ) : (
        <>
          <DataTableShell>
            <DataTable className="min-w-[820px]">
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Date</DataTableHeaderCell>
                  <DataTableHeaderCell>Expense</DataTableHeaderCell>
                  <DataTableHeaderCell>Category</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Qty × unit</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Total</DataTableHeaderCell>
                  <DataTableHeaderCell>Supplier · method</DataTableHeaderCell>
                  <DataTableHeaderCell />
                </tr>
              </DataTableHead>
              <DataTableBody>
                {pageRows.map((e) => (
                  <DataTableRow key={e.id}>
                    <DataTableCell className="whitespace-nowrap text-sm">
                      {formatDate(e.date)}
                      <div className="text-[11px] text-muted-foreground">{e.expenseNo}</div>
                    </DataTableCell>
                    <DataTableCell>
                      <div className="font-medium">{e.description}</div>
                      {e.notes ? <div className="max-w-xs truncate text-xs text-muted-foreground">{e.notes}</div> : null}
                    </DataTableCell>
                    <DataTableCell className="text-sm">{e.category}</DataTableCell>
                    <DataTableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                      {e.quantity} × {formatMoney(e.unitPrice)}
                    </DataTableCell>
                    <DataTableCell className="text-right font-semibold">
                      <Money value={e.totalAmount} />
                    </DataTableCell>
                    <DataTableCell className="text-sm">
                      <div>{e.supplier || '—'}</div>
                      <div className="text-xs text-muted-foreground">{PAYMENT_METHOD_LABEL[e.paymentMethod]}</div>
                    </DataTableCell>
                    <DataTableCell>
                      {e.source === 'PAYROLL' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Posted by the payroll lock">
                          <Lock className="h-3.5 w-3.5" />
                          Payroll
                        </span>
                      ) : canManage ? (
                        <div className="flex gap-1">
                          <Button type="button" size="sm" variant="outline" onClick={() => openEdit(e)}>
                            Edit
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`Delete ${e.expenseNo}`}
                            onClick={() => void remove(e)}
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
                  <td className="px-3 py-3 sm:px-4" colSpan={4}>
                    Total · {filtered.length} entr{filtered.length === 1 ? 'y' : 'ies'}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums sm:px-4">{formatMoney(stats.total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </DataTable>
          </DataTableShell>
          <TablePager page={page} pageCount={pageCount} onPageChange={setPage} total={filtered.length} noun="expense" />
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.expenseNo}` : 'Record expense'}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
            </Field>
            <Field>
              <Label>Category</Label>
              <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {categoryNames.map((c) => (
                  <option key={c} value={c}>
                    {c}
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
              <Label>Quantity</Label>
              <Input
                type="number"
                min={0}
                step="any"
                value={form.quantity}
                onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
              />
            </Field>
            <Field>
              <Label>Unit price</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.unitPrice}
                onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
              />
            </Field>
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 sm:col-span-2">
              <span className="text-sm text-muted-foreground">Total amount (quantity × unit price)</span>
              <span className="font-display text-lg font-semibold tabular-nums">{formatMoney(formTotal)}</span>
            </div>
            <Field>
              <Label>Supplier</Label>
              <Input value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} />
            </Field>
            <Field>
              <Label>Payment method</Label>
              <Select
                value={form.paymentMethod}
                onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value as ExpensePaymentMethod }))}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field className="sm:col-span-2">
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
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

      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Expense categories</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              placeholder="New category, e.g. Transport hire"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addCategory()
              }}
            />
            <Button type="button" onClick={() => void addCategory()}>
              Add
            </Button>
          </div>
          <ul className="mt-2 divide-y divide-border/60 rounded-xl border border-border/70">
            {categories.map((c) => (
              <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span>{c.name}</span>
                {c.builtIn ? (
                  <span className="text-xs text-muted-foreground">Built-in</span>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${c.name}`}
                    onClick={() => void removeCategory(c)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  )
}
