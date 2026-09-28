import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Banknote,
  CircleAlert,
  Copy,
  KeyRound,
  Printer,
  Receipt,
  ReceiptText,
  Undo2,
  Wallet,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { SearchInput } from '@/components/shared/search-input'
import { StatCard } from '@/components/shared/stat-card'
import { StatusBadge } from '@/components/shared/status-badge'
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
import { printPortalSlips } from '@/components/shared/student-portal-access-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { useAuth } from '@/contexts/auth-context'
import { catalogService, studentService } from '@/services/api'
import { FEE_CATEGORIES, feeCategoryFor, feeCategoryLabel, residencyLabel } from '@/lib/fees'
import { copyText } from '@/lib/native-app'
import { notify } from '@/lib/notify'
import { canManageSchoolSettings, canManageStudents, hasAppPermission } from '@/lib/roles'
import { formatDate, formatDateTime, fullName } from '@/lib/utils'
import type {
  FeeCategory,
  FeePolicy,
  Invoice,
  Payment,
  RecordPaymentResult,
  SchoolClass,
  Student,
  StudentPortalAccess,
} from '@/types'

type AccountState = 'CLEARED' | 'OWING' | 'OVERDUE' | 'NOT_BILLED'

type StudentAccount = {
  student: Student
  category: FeeCategory
  /** Oldest due first. */
  invoices: Invoice[]
  billed: number
  paid: number
  balance: number
  state: AccountState
}

const ACCOUNT_BADGE: Record<
  AccountState,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'outline' }
> = {
  CLEARED: { label: 'Fees cleared', variant: 'success' },
  OWING: { label: 'Owing', variant: 'warning' },
  OVERDUE: { label: 'Overdue', variant: 'danger' },
  NOT_BILLED: { label: 'Not billed', variant: 'outline' },
}

const PAYMENT_METHODS = [
  'Cash',
  'Bank transfer',
  'EcoCash',
  'OneMoney',
  'InnBucks',
  'Swipe / card',
  'Other',
]

const PAGE = 50

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

function invoiceBalance(invoice: Invoice) {
  return Math.max(0, Math.round((invoice.total - invoice.paid) * 100) / 100)
}

export function FeesPage() {
  const { user, permissions } = useAuth()
  const canBill = hasAppPermission(permissions, 'fees.create')
  const canRecord = hasAppPermission(permissions, 'payments.create')
  const canReverse = hasAppPermission(permissions, 'payments.reverse')
  const canIssuePasscode = user ? canManageStudents(user.role) : false
  const canEditFees = user ? canManageSchoolSettings(user.role) : false

  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [policy, setPolicy] = useState<FeePolicy | null>(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | AccountState>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | FeeCategory>('all')
  const [accountsShown, setAccountsShown] = useState(PAGE)
  const [paymentsShown, setPaymentsShown] = useState(25)
  const [billing, setBilling] = useState(false)
  const [reversingId, setReversingId] = useState<string | null>(null)
  const [paymentDialog, setPaymentDialog] = useState<{ studentId?: string } | null>(null)
  const [passcode, setPasscode] = useState<{ student: Student; justCleared: boolean } | null>(
    null,
  )

  const load = useCallback(async () => {
    const [inv, pay, stu, cls, pol] = await Promise.all([
      catalogService.getInvoices(),
      catalogService.getPayments(),
      studentService.list(),
      catalogService.getClasses().catch(() => [] as SchoolClass[]),
      catalogService.getFeePolicy().catch(() => null),
    ])
    setInvoices(inv)
    setPayments(pay)
    setStudents(stu)
    setClasses(cls)
    setPolicy(pol)
  }, [])

  useEffect(() => {
    load()
      .catch((err) => {
        console.error(err)
        notify.error('Could not load fees & payments', 'Check your connection and try again.')
      })
      .finally(() => setLoading(false))
  }, [load])

  const currency = policy?.currency ?? 'USD'
  const money = useCallback((n: number) => formatMoney(n, currency), [currency])

  const accounts = useMemo<StudentAccount[]>(() => {
    const byStudent = new Map<string, Invoice[]>()
    for (const inv of invoices) {
      const list = byStudent.get(inv.studentId) ?? []
      list.push(inv)
      byStudent.set(inv.studentId, list)
    }
    return students
      .filter((s) => s.status === 'ACTIVE' || byStudent.has(s.id))
      .map((student) => {
        const list = [...(byStudent.get(student.id) ?? [])].sort((a, b) =>
          a.dueDate.localeCompare(b.dueDate),
        )
        const billed = list.reduce((sum, i) => sum + i.total, 0)
        const paid = list.reduce((sum, i) => sum + i.paid, 0)
        const balance = list.reduce((sum, i) => sum + invoiceBalance(i), 0)
        const state: AccountState =
          list.length === 0
            ? 'NOT_BILLED'
            : balance <= 0
              ? 'CLEARED'
              : list.some((i) => i.status === 'OVERDUE' && invoiceBalance(i) > 0)
                ? 'OVERDUE'
                : 'OWING'
        const level =
          student.educationLevelId ||
          classes.find((c) => c.id === student.classId)?.educationLevelId
        return {
          student,
          category: feeCategoryFor(student.residency, level),
          invoices: list,
          billed,
          paid,
          balance,
          state,
        }
      })
      .sort((a, b) => fullName(a.student).localeCompare(fullName(b.student)))
  }, [students, invoices, classes])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accounts.filter((a) => {
      if (stateFilter !== 'all' && a.state !== stateFilter) return false
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false
      if (!q) return true
      return (
        fullName(a.student).toLowerCase().includes(q) ||
        a.student.studentNumber.toLowerCase().includes(q)
      )
    })
  }, [accounts, search, stateFilter, categoryFilter])

  useEffect(() => setAccountsShown(PAGE), [search, stateFilter, categoryFilter])

  const totals = useMemo(() => {
    const billed = invoices.reduce((s, i) => s + i.total, 0)
    const collected = payments
      .filter((p) => p.status === 'CONFIRMED')
      .reduce((s, p) => s + p.amount, 0)
    const outstanding = invoices.reduce((s, i) => s + invoiceBalance(i), 0)
    const overdue = invoices
      .filter((i) => i.status === 'OVERDUE')
      .reduce((s, i) => s + invoiceBalance(i), 0)
    return { billed, collected, outstanding, overdue }
  }, [invoices, payments])

  const categoryCounts = useMemo(() => {
    const counts: Record<FeeCategory, number> = { BOARDING: 0, DAY: 0, PRIMARY: 0, NON_FORMAL: 0 }
    for (const a of accounts) if (a.student.status === 'ACTIVE') counts[a.category] += 1
    return counts
  }, [accounts])

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])
  const feesNotSet = policy ? !Object.values(policy.termFees).some((v) => v > 0) : false

  async function billTerm() {
    const ok = window.confirm(
      'Bill every active student for the current term using the fees in Settings → Fees?\n\nStudents already billed for this term have their invoice updated to the current amount; payments are kept.',
    )
    if (!ok) return
    setBilling(true)
    try {
      await notify.process(() => catalogService.billTerm(), {
        loading: 'Billing students…',
        success: (r) => `${r.termName}: ${r.created} new, ${r.updated} updated invoices`,
        error: 'Could not bill the term',
      })
      await load()
    } finally {
      setBilling(false)
    }
  }

  async function reversePayment(payment: Payment) {
    const ok = window.confirm(
      `Reverse receipt ${payment.receiptNumber} (${money(payment.amount)})? The amount goes back onto the student's balance.`,
    )
    if (!ok) return
    setReversingId(payment.id)
    try {
      await notify.process(() => catalogService.reversePayment(payment.id), {
        loading: 'Reversing payment…',
        success: 'Payment reversed',
        error: 'Could not reverse payment',
      })
      await load()
    } finally {
      setReversingId(null)
    }
  }

  async function handleRecorded(result: RecordPaymentResult, student: Student) {
    await load().catch(() => undefined)
    if (!result.feesCleared) return
    if (canIssuePasscode) {
      setPasscode({ student, justCleared: true })
    } else {
      notify.success(
        'Fees cleared',
        `${fullName(student)} can now be given a portal passcode by the school office.`,
      )
    }
  }

  if (loading) return <LoadingState message="Loading fees & payments…" />

  const visibleAccounts = filtered.slice(0, accountsShown)
  const visiblePayments = payments.slice(0, paymentsShown)

  return (
    <div>
      <PageHeader
        title="Fees & Payments"
        description="Term fees by student type, payments, receipts, and balances."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Fees & Payments' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            {canBill ? (
              <Button variant="outline" loading={billing} onClick={() => void billTerm()}>
                <ReceiptText className="h-4 w-4" />
                Bill current term
              </Button>
            ) : null}
            {canRecord ? (
              <Button onClick={() => setPaymentDialog({})}>
                <Banknote className="h-4 w-4" />
                Record payment
              </Button>
            ) : null}
          </div>
        }
      />

      {feesNotSet ? (
        <Alert title="Term fees are not set" tone="warning" className="mb-4">
          {canEditFees ? (
            <>
              Enter the boarding, day scholar, primary learner, and non-formal fees in{' '}
              <Link to="/settings?tab=fees" className="font-medium underline">
                Settings → Fees
              </Link>
              , then bill the current term.
            </>
          ) : (
            'Ask a school administrator to enter the term fees in Settings → Fees.'
          )}
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Total billed" value={money(totals.billed)} icon={Receipt} />
        <StatCard
          label="Total collected"
          value={money(totals.collected)}
          icon={Banknote}
          tone="success"
        />
        <StatCard
          label="Outstanding"
          value={money(totals.outstanding)}
          icon={Wallet}
          tone="warning"
        />
        <StatCard
          label="Overdue"
          value={money(totals.overdue)}
          icon={CircleAlert}
          tone="warning"
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Term fees</CardTitle>
          <CardDescription>
            Per student, per term.{' '}
            {canEditFees ? (
              <Link to="/settings?tab=fees" className="text-primary hover:underline">
                Change amounts
              </Link>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {FEE_CATEGORIES.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() =>
                setCategoryFilter((prev) => (prev === c.value ? 'all' : c.value))
              }
              className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                categoryFilter === c.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/40'
              }`}
            >
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="mt-1 font-semibold">{money(policy?.termFees[c.value] ?? 0)}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {categoryCounts[c.value]} active student{categoryCounts[c.value] === 1 ? '' : 's'}
              </p>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Student accounts</CardTitle>
          <CardDescription>
            A student whose fees are cleared can be given a portal passcode: their student number is
            the username and the passcode is the password for the results and progress portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
            <SearchInput
              id="fees-search"
              name="fees-search"
              value={search}
              onChange={setSearch}
              placeholder="Search by name or student number…"
            />
            <Select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as 'all' | AccountState)}
            >
              <option value="all">All balances</option>
              <option value="OWING">Owing</option>
              <option value="OVERDUE">Overdue</option>
              <option value="CLEARED">Fees cleared</option>
              <option value="NOT_BILLED">Not billed</option>
            </Select>
            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as 'all' | FeeCategory)}
            >
              <option value="all">All fee types</option>
              {FEE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>

          {filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No student accounts match these filters.
            </p>
          ) : (
            <DataTableShell>
              <DataTable>
                <DataTableHead>
                  <tr>
                    <DataTableHeaderCell>Student</DataTableHeaderCell>
                    <DataTableHeaderCell>Type</DataTableHeaderCell>
                    <DataTableHeaderCell className="text-right">Billed</DataTableHeaderCell>
                    <DataTableHeaderCell className="text-right">Paid</DataTableHeaderCell>
                    <DataTableHeaderCell className="text-right">Balance</DataTableHeaderCell>
                    <DataTableHeaderCell>Status</DataTableHeaderCell>
                    <DataTableHeaderCell className="text-right">Actions</DataTableHeaderCell>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {visibleAccounts.map((a) => (
                    <DataTableRow key={a.student.id}>
                      <DataTableCell>
                        <Link
                          to={`/students/${a.student.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {fullName(a.student)}
                        </Link>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {a.student.studentNumber}
                        </p>
                      </DataTableCell>
                      <DataTableCell className="text-xs">
                        <p>{residencyLabel(a.student.residency)}</p>
                        <p className="text-muted-foreground">{feeCategoryLabel(a.category)}</p>
                      </DataTableCell>
                      <DataTableCell className="text-right tabular-nums">
                        {money(a.billed)}
                      </DataTableCell>
                      <DataTableCell className="text-right tabular-nums">
                        {money(a.paid)}
                      </DataTableCell>
                      <DataTableCell className="text-right font-semibold tabular-nums">
                        {money(a.balance)}
                      </DataTableCell>
                      <DataTableCell>
                        <Badge variant={ACCOUNT_BADGE[a.state].variant}>
                          {ACCOUNT_BADGE[a.state].label}
                        </Badge>
                      </DataTableCell>
                      <DataTableCell className="text-right">
                        {a.balance > 0 && canRecord ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPaymentDialog({ studentId: a.student.id })}
                          >
                            <Banknote className="h-3.5 w-3.5" />
                            Pay
                          </Button>
                        ) : a.state === 'CLEARED' && canIssuePasscode ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPasscode({ student: a.student, justCleared: false })}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                            Passcode
                          </Button>
                        ) : null}
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </DataTableShell>
          )}
          {filtered.length > accountsShown ? (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => setAccountsShown((n) => n + PAGE)}>
                Show more ({filtered.length - accountsShown} left)
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Payment history / receipts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            visiblePayments.map((p) => {
              const student = studentById.get(p.studentId)
              return (
                <div
                  key={p.id}
                  className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="font-medium">
                      {p.receiptNumber}
                      <span className="font-normal text-muted-foreground">
                        {' '}
                        · {student ? fullName(student) : p.studentId}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(p.paidAt)} · {p.method}
                      {p.recordedByName ? ` · by ${p.recordedByName}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{money(p.amount)}</p>
                      <StatusBadge status={p.status} />
                    </div>
                    {canReverse && p.status === 'CONFIRMED' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={reversingId === p.id}
                        onClick={() => void reversePayment(p)}
                        aria-label={`Reverse ${p.receiptNumber}`}
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                        Reverse
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })
          )}
          {payments.length > paymentsShown ? (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={() => setPaymentsShown((n) => n + 50)}>
                Show more ({payments.length - paymentsShown} left)
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <RecordPaymentDialog
        open={paymentDialog !== null}
        initialStudentId={paymentDialog?.studentId}
        accounts={accounts}
        currency={currency}
        onOpenChange={(open) => {
          if (!open) setPaymentDialog(null)
        }}
        onRecorded={handleRecorded}
      />

      <PortalPasscodeDialog
        student={passcode?.student ?? null}
        justCleared={passcode?.justCleared ?? false}
        onClose={() => setPasscode(null)}
      />
    </div>
  )
}

function RecordPaymentDialog({
  open,
  initialStudentId,
  accounts,
  currency,
  onOpenChange,
  onRecorded,
}: {
  open: boolean
  initialStudentId?: string
  accounts: StudentAccount[]
  currency: string
  onOpenChange: (open: boolean) => void
  onRecorded: (result: RecordPaymentResult, student: Student) => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [studentId, setStudentId] = useState('')
  const [invoiceId, setInvoiceId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState(PAYMENT_METHODS[0]!)
  const [receiptNumber, setReceiptNumber] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [saving, setSaving] = useState(false)

  const account = accounts.find((a) => a.student.id === studentId)
  const unpaid = useMemo(
    () => account?.invoices.filter((i) => invoiceBalance(i) > 0) ?? [],
    [account],
  )
  const invoice = unpaid.find((i) => i.id === invoiceId)

  function selectStudent(id: string) {
    setStudentId(id)
    const first = accounts
      .find((a) => a.student.id === id)
      ?.invoices.find((i) => invoiceBalance(i) > 0)
    setInvoiceId(first?.id ?? '')
    setAmount(first ? String(invoiceBalance(first)) : '')
  }

  useEffect(() => {
    if (!open) return
    setQuery('')
    setMethod(PAYMENT_METHODS[0]!)
    setReceiptNumber('')
    setPaidAt(new Date().toISOString().slice(0, 10))
    selectStudent(initialStudentId ?? '')
    // Reset only when the dialog opens, not when accounts reload behind it.
  }, [open, initialStudentId])

  const owing = useMemo(() => {
    const q = query.trim().toLowerCase()
    return accounts
      .filter((a) => a.balance > 0)
      .filter(
        (a) =>
          !q ||
          fullName(a.student).toLowerCase().includes(q) ||
          a.student.studentNumber.toLowerCase().includes(q),
      )
      .slice(0, 100)
  }, [accounts, query])

  async function submit() {
    const value = Math.round(Number(amount) * 100) / 100
    if (!account || !invoice) {
      notify.error('Choose a student and an invoice')
      return
    }
    if (!(value > 0)) {
      notify.error('Enter the amount paid')
      return
    }
    if (value > invoiceBalance(invoice) + 0.001) {
      notify.error(
        'Amount is more than the balance',
        `${invoice.number} has ${formatMoney(invoiceBalance(invoice), currency)} left to pay.`,
      )
      return
    }
    setSaving(true)
    try {
      const result = await notify.process(
        () =>
          catalogService.recordPayment({
            studentId: account.student.id,
            invoiceId: invoice.id,
            amount: value,
            method,
            receiptNumber: receiptNumber.trim() || undefined,
            paidAt: paidAt || undefined,
          }),
        {
          loading: 'Recording payment…',
          success: (r) => `Payment recorded · receipt ${r.payment.receiptNumber}`,
          error: 'Could not record payment',
        },
      )
      onOpenChange(false)
      await onRecorded(result, account.student)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            The receipt number is assigned automatically unless you type one from a manual receipt
            book.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {initialStudentId && account ? (
            <div className="rounded-lg border border-border px-3 py-2 text-sm">
              <p className="font-medium">{fullName(account.student)}</p>
              <p className="text-xs text-muted-foreground">
                {account.student.studentNumber} · balance {formatMoney(account.balance, currency)}
              </p>
            </div>
          ) : (
            <Field>
              <Label htmlFor="payment-student">Student</Label>
              <Input
                placeholder="Search name or student number…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <Select
                id="payment-student"
                value={studentId}
                onChange={(e) => selectStudent(e.target.value)}
              >
                <option value="">
                  {owing.length ? 'Select a student with a balance' : 'No students with a balance'}
                </option>
                {owing.map((a) => (
                  <option key={a.student.id} value={a.student.id}>
                    {fullName(a.student)} · {a.student.studentNumber} ·{' '}
                    {formatMoney(a.balance, currency)}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {account ? (
            <Field>
              <Label htmlFor="payment-invoice">Invoice</Label>
              <Select
                id="payment-invoice"
                value={invoiceId}
                onChange={(e) => {
                  setInvoiceId(e.target.value)
                  const next = unpaid.find((i) => i.id === e.target.value)
                  setAmount(next ? String(invoiceBalance(next)) : '')
                }}
              >
                {unpaid.length === 0 ? <option value="">Nothing owing</option> : null}
                {unpaid.map((i) => (
                  <option key={i.id} value={i.id}>
                    {[i.termName, i.number].filter(Boolean).join(' · ')} · balance{' '}
                    {formatMoney(invoiceBalance(i), currency)}
                  </option>
                ))}
              </Select>
              {invoice ? (
                <p className="text-xs text-muted-foreground">
                  {invoice.category ? `${feeCategoryLabel(invoice.category)} · ` : ''}
                  Due {formatDate(invoice.dueDate)}
                </p>
              ) : null}
            </Field>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <Label htmlFor="payment-amount">Amount ({currency})</Label>
              <Input
                id="payment-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="payment-method">Method</Label>
              <Select
                id="payment-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label htmlFor="payment-date">Date paid</Label>
              <Input
                id="payment-date"
                type="date"
                value={paidAt}
                onChange={(e) => setPaidAt(e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="payment-receipt">Receipt no. (optional)</Label>
              <Input
                id="payment-receipt"
                placeholder="Auto"
                value={receiptNumber}
                onChange={(e) => setReceiptNumber(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button loading={saving} disabled={!invoice} onClick={() => void submit()}>
              Record payment
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PortalPasscodeDialog({
  student,
  justCleared,
  onClose,
}: {
  student: Student | null
  justCleared: boolean
  onClose: () => void
}) {
  const [access, setAccess] = useState<StudentPortalAccess | null>(null)
  const [issuing, setIssuing] = useState(false)

  useEffect(() => setAccess(null), [student?.id])

  async function issue() {
    if (!student || !studentService.issuePortalCode) return
    setIssuing(true)
    try {
      const next = await notify.process(() => studentService.issuePortalCode!(student.id), {
        loading: 'Issuing passcode…',
        success: 'Portal passcode issued',
        error: 'Could not issue passcode',
      })
      setAccess(next)
    } finally {
      setIssuing(false)
    }
  }

  const name = student ? fullName(student) : ''
  const code = access?.code

  return (
    <Dialog open={Boolean(student)} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{justCleared ? 'Fees cleared' : 'Portal passcode'}</DialogTitle>
          <DialogDescription>
            {justCleared ? `${name} has paid all fees. ` : ''}
            Issue a passcode for the results and progress portal. The student signs in with their
            student number as the username and the passcode as the password.
          </DialogDescription>
        </DialogHeader>

        {student && code ? (
          <div className="space-y-3">
            <dl className="space-y-2 rounded-lg border border-border px-3 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Username</dt>
                <dd className="font-mono font-semibold">{student.studentNumber}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Passcode</dt>
                <dd className="font-mono text-lg font-semibold tracking-widest">{code}</dd>
              </div>
              {access?.expiresAt ? (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Valid until</dt>
                  <dd>{formatDate(access.expiresAt)}</dd>
                </div>
              ) : null}
            </dl>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  void copyText(
                    `${name}\nUsername (student number): ${student.studentNumber}\nPasscode: ${code}`,
                  ).then(
                    () => notify.success('Login details copied'),
                    () => notify.error('Could not copy'),
                  )
                }}
              >
                <Copy className="h-4 w-4" />
                Copy
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  printPortalSlips(
                    [
                      {
                        name,
                        studentNumber: student.studentNumber,
                        code,
                        expiresAt: access?.expiresAt,
                      },
                    ],
                    `Portal passcode · ${name}`,
                  )
                }
              >
                <Printer className="h-4 w-4" />
                Print slip
              </Button>
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Later
            </Button>
            <Button loading={issuing} onClick={() => void issue()}>
              <KeyRound className="h-4 w-4" />
              Issue passcode
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
