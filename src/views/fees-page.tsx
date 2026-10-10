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
import {
  FEE_CATEGORIES,
  FEE_LEVELS,
  PAYMENT_PLANS,
  currentBillingTerm,
  feeCategoryFor,
  feeCategoryLabel,
  hasAnyFee,
  paymentPlanLabel,
} from '@/lib/fees'
import { copyText } from '@/lib/native-app'
import { notify } from '@/lib/notify'
import { canManageSchoolSettings, canManageStudents, hasAppPermission } from '@/lib/roles'
import { formatDate, formatDateTime, fullName } from '@/lib/utils'
import type {
  FeeCategory,
  FeePolicy,
  Invoice,
  Payment,
  PaymentPlan,
  RecordPaymentResult,
  SchoolClass,
  Student,
  StudentPortalAccess,
  Term,
} from '@/types'

type AccountState = 'CLEARED' | 'OWING' | 'OVERDUE' | 'NOT_BILLED'

type StudentAccount = {
  student: Student
  category: FeeCategory
  plan: PaymentPlan
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
const UNASSIGNED_TERM_ID = '__unassigned__'
const MONTHLY_PAYMENT = '__monthly__'

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

function currentMonthPeriod(date = new Date()) {
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
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
  const [terms, setTerms] = useState<Term[]>([])
  const [selectedTermId, setSelectedTermId] = useState('')
  const [policy, setPolicy] = useState<FeePolicy | null>(null)
  const [search, setSearch] = useState('')
  const [stateFilter, setStateFilter] = useState<'all' | AccountState>('all')
  const [categoryFilter, setCategoryFilter] = useState<'all' | FeeCategory>('all')
  const [planFilter, setPlanFilter] = useState<'all' | PaymentPlan>('all')
  const [accountsShown, setAccountsShown] = useState(PAGE)
  const [paymentsShown, setPaymentsShown] = useState(25)
  const [billing, setBilling] = useState(false)
  const [reversingId, setReversingId] = useState<string | null>(null)
  const [paymentDialog, setPaymentDialog] = useState<{ studentId?: string } | null>(null)
  const [passcode, setPasscode] = useState<{ student: Student; justCleared: boolean } | null>(
    null,
  )

  const load = useCallback(async () => {
    const [inv, pay, stu, feeCatalog, pol] = await Promise.all([
      catalogService.getInvoices(),
      catalogService.getPayments(),
      studentService.list(),
      catalogService.getTermsAndClasses(),
      catalogService.getFeePolicy().catch(() => null),
    ])
    const { terms: termRows, classes: cls } = feeCatalog
    setInvoices(inv)
    setPayments(pay)
    setStudents(stu)
    setClasses(cls)
    setTerms(termRows)
    setSelectedTermId((current) =>
      termRows.some((term) => term.id === current) ||
      (current === UNASSIGNED_TERM_ID && inv.some((invoice) => !invoice.termId))
        ? current
        : (currentBillingTerm(termRows)?.id ??
          (inv.some((invoice) => !invoice.termId) ? UNASSIGNED_TERM_ID : '')),
    )
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
  const selectedTerm = terms.find((term) => term.id === selectedTermId)
  const currentTerm = currentBillingTerm(terms)
  const hasUnassignedInvoices = invoices.some((invoice) => !invoice.termId)
  const termInvoices = useMemo(
    () =>
      selectedTermId === UNASSIGNED_TERM_ID
        ? invoices.filter((invoice) => !invoice.termId)
        : selectedTerm
          ? invoices.filter((invoice) => invoice.termId === selectedTerm.id)
          : [],
    [invoices, selectedTerm, selectedTermId],
  )
  const periodInvoices = useMemo(
    () =>
      termInvoices.filter((invoice) =>
        invoice.plan === 'MONTHLY'
          ? invoice.period === currentMonthPeriod()
          : true,
      ),
    [termInvoices],
  )

  const accounts = useMemo<StudentAccount[]>(() => {
    const byStudent = new Map<string, Invoice[]>()
    for (const inv of termInvoices) {
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
        const plan: PaymentPlan = student.paymentPlan ?? 'TERMLY'
        const displayedInvoices =
          plan === 'MONTHLY'
            ? list.filter((invoice) => invoice.plan === 'MONTHLY' && invoice.period === currentMonthPeriod())
            : list.filter((invoice) => invoice.plan !== 'MONTHLY')
        const billed = displayedInvoices.reduce((sum, i) => sum + i.total, 0)
        const paid = displayedInvoices.reduce((sum, i) => sum + i.paid, 0)
        const balance = displayedInvoices.reduce((sum, i) => sum + invoiceBalance(i), 0)
        const state: AccountState =
          displayedInvoices.length === 0
            ? 'NOT_BILLED'
            : balance <= 0
              ? 'CLEARED'
              : displayedInvoices.some((i) => i.status === 'OVERDUE' && invoiceBalance(i) > 0)
                ? 'OVERDUE'
                : 'OWING'
        const level =
          student.educationLevelId ||
          classes.find((c) => c.id === student.classId)?.educationLevelId
        return {
          student,
          category: feeCategoryFor(student.residency, level),
          plan,
          invoices: list,
          billed,
          paid,
          balance,
          state,
        }
      })
      .sort((a, b) => fullName(a.student).localeCompare(fullName(b.student)))
  }, [students, termInvoices, classes])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return accounts.filter((a) => {
      if (stateFilter !== 'all' && a.state !== stateFilter) return false
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false
      if (planFilter !== 'all' && a.plan !== planFilter) return false
      if (!q) return true
      return (
        fullName(a.student).toLowerCase().includes(q) ||
        a.student.studentNumber.toLowerCase().includes(q)
      )
    })
  }, [accounts, search, stateFilter, categoryFilter, planFilter])

  useEffect(() => setAccountsShown(PAGE), [search, stateFilter, categoryFilter, planFilter])

  const totals = useMemo(() => {
    const invoiceIds = new Set(periodInvoices.map((invoice) => invoice.id))
    const billed = periodInvoices.reduce((s, i) => s + i.total, 0)
    const collected = payments
      .filter((p) => p.status === 'CONFIRMED' && invoiceIds.has(p.invoiceId))
      .reduce((s, p) => s + p.amount, 0)
    const outstanding = periodInvoices.reduce((s, i) => s + invoiceBalance(i), 0)
    const overdue = periodInvoices
      .filter((i) => i.status === 'OVERDUE')
      .reduce((s, i) => s + invoiceBalance(i), 0)
    return { billed, collected, outstanding, overdue }
  }, [periodInvoices, payments])

  const categoryCounts = useMemo(() => {
    const counts = Object.fromEntries(FEE_CATEGORIES.map((c) => [c.value, 0])) as Record<
      FeeCategory,
      number
    >
    for (const a of accounts) if (a.student.status === 'ACTIVE') counts[a.category] += 1
    return counts
  }, [accounts])

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])
  const feesNotSet = policy ? !hasAnyFee(policy.fees) : false

  async function billTerm() {
    const ok = window.confirm(
      'Bill every active student for the current term using the fees in Settings → Fees?\n\nTermly-plan students get one invoice for the term. Monthly-plan students get an invoice for each month that has started; later months are raised automatically. Existing invoices are updated to the current amount; payments are kept.',
    )
    if (!ok) return
    setBilling(true)
    try {
      await notify.process(() => catalogService.billTerm(), {
        loading: 'Billing students…',
        success: (r) => `${r.termName}: ${r.created} new, ${r.updated} updated invoices`,
        error: 'Could not bill the term',
      })
      setSelectedTermId(currentTerm?.id ?? '')
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
        description="Review invoices and balances for one term at a time. Past terms remain available in the term selector."
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
        <Alert title="School fees are not set" tone="warning" className="mb-4">
          {canEditFees ? (
            <>
              Enter the day scholar and boarder fees for ECD, primary, secondary and A-Level in{' '}
              <Link to="/settings?tab=fees" className="font-medium underline">
                Settings → Fees
              </Link>
              , then bill the current term.
            </>
          ) : (
            'Ask a school administrator to enter the school fees in Settings → Fees.'
          )}
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:gap-4 xl:grid-cols-4">
        <StatCard label="Billed for period" value={money(totals.billed)} icon={Receipt} />
        <StatCard
          label="Collected for period"
          value={money(totals.collected)}
          icon={Banknote}
          tone="success"
        />
        <StatCard
          label="Period balance"
          value={money(totals.outstanding)}
          icon={Wallet}
          tone="warning"
        />
        <StatCard
          label="Period overdue"
          value={money(totals.overdue)}
          icon={CircleAlert}
          tone="warning"
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Fee structure</CardTitle>
          <CardDescription>
            Termly fee per term and monthly fee per month, for day scholars and boarders at each
            level. Select a fee to filter the student accounts.{' '}
            {canEditFees ? (
              <Link to="/settings?tab=fees" className="text-primary hover:underline">
                Change amounts
              </Link>
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 sm:gap-3 xl:grid-cols-5">
          {[
            ...FEE_LEVELS.map((l) => ({ key: l.value, title: l.label, sub: l.classes })),
            { key: null, title: 'Non-formal', sub: 'Any level' },
          ].map((group) => (
            <div key={group.key ?? 'NON_FORMAL'} className="rounded-lg border border-border p-2">
              <p className="px-1 text-sm font-semibold">
                {group.title}{' '}
                <span className="text-xs font-normal text-muted-foreground">{group.sub}</span>
              </p>
              <div className="mt-1.5 space-y-1">
                {FEE_CATEGORIES.filter((c) => c.level === group.key).map((c) => {
                  const amounts = policy?.fees[c.value]
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() =>
                        setCategoryFilter((prev) => (prev === c.value ? 'all' : c.value))
                      }
                      className={`w-full rounded-md border px-2.5 py-2 text-left text-sm transition-colors ${
                        categoryFilter === c.value
                          ? 'border-primary bg-primary/5'
                          : 'border-transparent hover:bg-muted/40'
                      }`}
                    >
                      <p className="text-xs text-muted-foreground">{c.short}</p>
                      <p className="mt-0.5 font-semibold tabular-nums">
                        {money(amounts?.termly ?? 0)}
                        <span className="text-xs font-normal text-muted-foreground"> / term</span>
                      </p>
                      <p className="text-xs tabular-nums text-muted-foreground">
                        {money(amounts?.monthly ?? 0)} / month
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {categoryCounts[c.value]} active student
                        {categoryCounts[c.value] === 1 ? '' : 's'}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Student accounts</CardTitle>
          <CardDescription>
            {selectedTerm
              ? `Termly invoices show the selected term balance. Monthly-plan balances show this month only. Select another term to review it.`
              : selectedTermId === UNASSIGNED_TERM_ID
                ? 'These invoices do not have an academic term recorded; they are kept separate from current-term balances.'
                : 'No academic terms are configured, so term-scoped balances cannot be shown.'}{' '}
            A student whose fees are cleared can be given a portal passcode: their student number is
            the username and the passcode is the password for the results and progress portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">
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
            <Select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value as 'all' | PaymentPlan)}
            >
              <option value="all">All payment plans</option>
              {PAYMENT_PLANS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
            <Select
              value={selectedTermId}
              onChange={(e) => setSelectedTermId(e.target.value)}
              aria-label="Academic term"
            >
              {!terms.length && !hasUnassignedInvoices ? (
                <option value="">No terms configured</option>
              ) : null}
              {hasUnassignedInvoices ? (
                <option value={UNASSIGNED_TERM_ID}>Unassigned / legacy invoices</option>
              ) : null}
              {terms
                .slice()
                .sort((a, b) => b.startDate.localeCompare(a.startDate))
                .map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.id === currentTerm?.id ? `${term.name} (current)` : term.name}
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
                    <DataTableHeaderCell className="text-right">Period billed</DataTableHeaderCell>
                    <DataTableHeaderCell className="text-right">Period paid</DataTableHeaderCell>
                    <DataTableHeaderCell className="text-right">Period balance</DataTableHeaderCell>
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
                        <p>{feeCategoryLabel(a.category)}</p>
                        <p className="text-muted-foreground">
                          {paymentPlanLabel(a.plan)} plan
                          {a.plan === 'MONTHLY' ? ` · ${currentMonthPeriod()}` : ''}
                        </p>
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
                        {(a.balance > 0 ||
                          (a.plan === 'MONTHLY' &&
                            a.invoices.some((invoice) => invoiceBalance(invoice) > 0))) &&
                        canRecord ? (
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
        selectedTermId={selectedTermId}
        selectedTermIsCurrent={Boolean(
          selectedTerm && currentTerm && selectedTerm.id === currentTerm.id,
        )}
        accounts={accounts}
        allInvoices={invoices}
        terms={terms}
        currency={currency}
        onOpenChange={(open) => {
          if (!open) setPaymentDialog(null)
        }}
        onRecorded={handleRecorded}
        onBilled={load}
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
  selectedTermId,
  selectedTermIsCurrent,
  accounts,
  allInvoices,
  terms,
  currency,
  onOpenChange,
  onRecorded,
  onBilled,
}: {
  open: boolean
  initialStudentId?: string
  selectedTermId: string
  selectedTermIsCurrent: boolean
  accounts: StudentAccount[]
  allInvoices: Invoice[]
  terms: Term[]
  currency: string
  onOpenChange: (open: boolean) => void
  onRecorded: (result: RecordPaymentResult, student: Student) => Promise<void>
  onBilled: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [studentId, setStudentId] = useState('')
  const [feePeriod, setFeePeriod] = useState('')
  const [invoiceId, setInvoiceId] = useState('')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState(PAYMENT_METHODS[0]!)
  const [receiptNumber, setReceiptNumber] = useState('')
  const [paidAt, setPaidAt] = useState('')
  const [saving, setSaving] = useState(false)
  const [billing, setBilling] = useState(false)

  const account = accounts.find((a) => a.student.id === studentId)
  const periodInvoices = useMemo(
    () =>
      allInvoices.filter(
        (candidate) =>
          candidate.studentId === studentId &&
          (feePeriod === MONTHLY_PAYMENT
            ? candidate.plan === 'MONTHLY'
            : candidate.plan !== 'MONTHLY' &&
              (candidate.termId ?? UNASSIGNED_TERM_ID) === feePeriod),
      ),
    [allInvoices, feePeriod, studentId],
  )
  const unpaid = useMemo(
    () => periodInvoices.filter((i) => invoiceBalance(i) > 0),
    [periodInvoices],
  )
  const invoice = unpaid.find((i) => i.id === invoiceId)
  const enteredAmount = Number(amount)
  const balanceAfterPayment = invoice
    ? Math.max(
        0,
        invoiceBalance(invoice) - (Number.isFinite(enteredAmount) ? enteredAmount : 0),
      )
    : 0

  useEffect(() => {
    if (invoiceId || unpaid.length === 0) return
    const next = unpaid.find((i) => i.period === currentMonthPeriod()) ?? unpaid[0]!
    setInvoiceId(next.id)
    setAmount(String(invoiceBalance(next)))
  }, [invoiceId, unpaid])

  function selectStudent(id: string) {
    setStudentId(id)
    const selectedAccount = accounts.find((a) => a.student.id === id)
    const nextPeriod = selectedAccount?.plan === 'MONTHLY' ? MONTHLY_PAYMENT : selectedTermId
    setFeePeriod(nextPeriod)
    const candidates = allInvoices.filter(
      (candidate) =>
        candidate.studentId === id &&
        (nextPeriod === MONTHLY_PAYMENT
          ? candidate.plan === 'MONTHLY'
          : candidate.plan !== 'MONTHLY' &&
            (candidate.termId ?? UNASSIGNED_TERM_ID) === nextPeriod),
    )
    const first =
      candidates.find((i) => i.period === currentMonthPeriod() && invoiceBalance(i) > 0) ??
      candidates.find((i) => invoiceBalance(i) > 0)
    setInvoiceId(first?.id ?? '')
    setAmount(first ? String(invoiceBalance(first)) : '')
  }

  function selectFeePeriod(value: string) {
    setFeePeriod(value)
    const candidates = allInvoices.filter(
      (candidate) =>
        candidate.studentId === studentId &&
        (value === MONTHLY_PAYMENT
          ? candidate.plan === 'MONTHLY'
          : candidate.plan !== 'MONTHLY' &&
            (candidate.termId ?? UNASSIGNED_TERM_ID) === value),
    )
    const first =
      candidates.find((i) => i.period === currentMonthPeriod() && invoiceBalance(i) > 0) ??
      candidates.find((i) => invoiceBalance(i) > 0)
    setInvoiceId(first?.id ?? '')
    setAmount(first ? String(invoiceBalance(first)) : '')
  }

  async function billCurrentMonth() {
    if (!account) return
    setBilling(true)
    try {
      const result = await notify.process(
        () => catalogService.billCurrentMonth(account.student.id),
        {
          loading: 'Billing current month…',
          success: (r) =>
            r.created || r.updated
              ? `Current month billed for ${fullName(account.student)}`
              : r.unchanged
                ? 'Current month is already billed'
                : 'No current-month invoice was due to bill',
          error: 'Could not bill the current month',
        },
      )
      setInvoiceId('')
      await onBilled()
      if (result.skipped) {
        notify.info(
          'No current-month invoice',
          'Check the student’s monthly payment plan and the current term dates.',
        )
      }
    } finally {
      setBilling(false)
    }
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
      .filter(
        (a) =>
          a.balance > 0 ||
          (a.student.status === 'ACTIVE' && a.plan === 'MONTHLY'),
      )
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
            Choose Term 1, Term 2, Term 3, or Monthly payment. Termly payments go to that term's
            invoice; monthly payments go to the selected month. Partial payments update only the
            chosen invoice. The receipt number is assigned automatically unless you type one from
            a manual receipt book.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {initialStudentId && account ? (
            <div className="rounded-lg border border-border px-3 py-2 text-sm">
              <p className="font-medium">{fullName(account.student)}</p>
              <p className="text-xs text-muted-foreground">
                {account.student.studentNumber} ·{' '}
                {account.plan === 'MONTHLY' ? `${currentMonthPeriod()} balance` : 'Term balance'}{' '}
                {formatMoney(account.balance, currency)}
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
                  {owing.length ? 'Select a student' : 'No students available'}
                </option>
                {owing.map((a) => (
                  <option key={a.student.id} value={a.student.id}>
                    {fullName(a.student)} · {a.student.studentNumber} ·{' '}
                    {a.balance > 0 ? formatMoney(a.balance, currency) : a.state}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {account ? (
            <div className="space-y-2">
              <Field>
                <Label htmlFor="payment-period">Fee period</Label>
                <Select
                  id="payment-period"
                  value={feePeriod}
                  onChange={(e) => selectFeePeriod(e.target.value)}
                >
                  {terms
                    .slice()
                    .sort((a, b) => a.startDate.localeCompare(b.startDate))
                    .map((term, index) => (
                      <option key={term.id} value={term.id}>
                        {term.name || `Term ${index + 1}`}
                      </option>
                    ))}
                  <option value={MONTHLY_PAYMENT}>Monthly payment</option>
                  {allInvoices.some((candidate) => candidate.studentId === studentId && !candidate.termId) ? (
                    <option value={UNASSIGNED_TERM_ID}>Unassigned / legacy term invoice</option>
                  ) : null}
                </Select>
              </Field>
              <Field>
                <Label htmlFor="payment-invoice">
                  {feePeriod === MONTHLY_PAYMENT ? 'Month to pay' : 'Invoice'}
                </Label>
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
                      {i.plan === 'MONTHLY'
                        ? `${i.period ?? 'Monthly invoice'}${i.termName ? ` · ${i.termName}` : ''}`
                        : `${i.termName ?? 'Term'} · termly fee`}{' '}
                      · balance {formatMoney(invoiceBalance(i), currency)}
                    </option>
                  ))}
                </Select>
                {invoice ? (
                  <p className="text-xs text-muted-foreground">
                    {invoice.category ? `${feeCategoryLabel(invoice.category)} · ` : ''}
                    {invoice.plan ? `${paymentPlanLabel(invoice.plan)} · ` : ''}
                    Due {formatDate(invoice.dueDate)}
                  </p>
                ) : null}
              </Field>
              {account.plan === 'MONTHLY' && selectedTermIsCurrent ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  loading={billing}
                  disabled={saving}
                  onClick={() => void billCurrentMonth()}
                >
                  <ReceiptText className="h-4 w-4" />
                  Bill current month
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <Label htmlFor="payment-amount">Amount ({currency})</Label>
              <Input
                id="payment-amount"
                type="number"
                inputMode="decimal"
                min={0}
                max={invoice ? invoiceBalance(invoice) : undefined}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {invoice ? (
                <p className="text-xs text-muted-foreground">
                  Balance after this payment: {formatMoney(balanceAfterPayment, currency)}
                </p>
              ) : null}
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
