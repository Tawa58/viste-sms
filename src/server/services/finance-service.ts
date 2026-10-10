import 'server-only'

import { getAdminDb } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import { assertCanAccessStudent, listAccessibleStudents } from '@/server/authorization/isolation'
import { badRequest, conflict, notFound } from '@/server/errors'
import { getDoc, newId } from '@/server/repositories/firestore-repo'
import { ensureCurrentAcademicCalendar } from '@/server/services/academic-calendar-service'
import { getFeePolicy } from '@/server/services/school-settings-service'
import { resolveEducationLevelId } from '@/lib/education-levels'
import {
  feeAmountFor,
  feeCategoryFor,
  hasAnyFee,
  monthlyInstalments,
  monthlyInvoiceId,
  termInvoiceId,
  invoiceBlocksPortal,
  invoicesForBillingPeriod,
  currentMonthPeriod,
  scholarshipAdjustedFeeAmount,
  invoiceBalance,
} from '@/lib/fees'
import type { PaymentCreateInput } from '@/server/validators/school'
import type {
  FeePolicy,
  Invoice,
  Payment,
  PaymentPlan,
  StudentScholarship,
  SchoolClass,
  Student,
  Term,
  TermBillingResult,
} from '@/types'

export type InvoiceDto = Invoice
export type PaymentDto = Payment

function invoiceStatus(
  total: number,
  paid: number,
  dueDate: string,
  scholarshipAmount = 0,
): Invoice['status'] {
  if (paid + scholarshipAmount >= total) return 'PAID'
  if (paid <= 0) {
    return Date.parse(dueDate) < Date.now() ? 'OVERDUE' : 'OPEN'
  }
  return Date.parse(dueDate) < Date.now() ? 'OVERDUE' : 'PARTIAL'
}

/** Stored status goes stale as due dates pass, so recompute it on every read. */
function withLiveStatus(invoice: Invoice): Invoice {
  return {
    ...invoice,
    status: invoiceStatus(
      invoice.total,
      invoice.paid,
      invoice.dueDate,
      invoice.scholarshipAmount,
    ),
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function endOfMonth(isoDate: string) {
  const [year, month] = isoDate.slice(0, 7).split('-').map(Number)
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10)
}

/** The term in progress today; during holidays, the next term to start. */
export async function resolveBillingTerm(termId?: string): Promise<Term> {
  const calendar = await ensureCurrentAcademicCalendar()
  if (termId) {
    const term = calendar.terms.find((t) => t.id === termId) ?? (await getDoc<Term>('terms', termId))
    if (!term) throw notFound('Term not found')
    return term
  }
  const today = new Date().toISOString().slice(0, 10)
  const terms = [...calendar.terms].sort((a, b) => a.startDate.localeCompare(b.startDate))
  return (
    terms.find((t) => t.startDate <= today && today <= t.endDate) ??
    terms.find((t) => t.startDate > today) ??
    terms[terms.length - 1]!
  )
}

type BillOutcome = 'created' | 'updated' | 'unchanged' | 'skipped'

type PlannedInvoice = Pick<Invoice, 'id' | 'number' | 'dueDate' | 'period'> & {
  coverageStart: string
  coverageEnd: string
}

/** Monthly-plan invoice ids for a term, up to the largest months-per-term setting. */
const MAX_MONTHS_PER_TERM = 6

function planInvoiceIds(termId: string, studentId: string, plan: PaymentPlan): string[] {
  if (plan === 'TERMLY') return [termInvoiceId(termId, studentId)]
  return Array.from({ length: MAX_MONTHS_PER_TERM }, (_, i) =>
    monthlyInvoiceId(termId, studentId, i + 1),
  )
}

/** Termly: one invoice. Monthly: each scheduled instalment, including future months. */
function plannedInvoices(
  student: Student,
  term: Term,
  policy: FeePolicy,
  plan: PaymentPlan,
  currentMonthOnly = false,
): PlannedInvoice[] {
  const code = term.id.replace(/^term-/, '')
  if (plan === 'TERMLY') {
    return [
      {
        id: termInvoiceId(term.id, student.id),
        number: `INV-${code}-${student.studentNumber}`,
        dueDate: addDays(term.startDate, policy.overdueGraceDays),
        coverageStart: term.startDate,
        coverageEnd: term.endDate,
      },
    ]
  }
  const today = new Date().toISOString().slice(0, 10)
  const currentMonth = today.slice(0, 7)
  return monthlyInstalments(term.startDate, policy.monthsPerTerm, policy.overdueGraceDays)
    .filter((m) =>
      currentMonthOnly
        ? m.issueDate.slice(0, 7) === currentMonth && m.issueDate <= today
        : true,
    )
    .map((m) => ({
      id: monthlyInvoiceId(term.id, student.id, m.instalment),
      number: `INV-${code}-${student.studentNumber}-M${m.instalment}`,
      dueDate: m.dueDate,
      period: m.period,
      coverageStart: `${m.issueDate.slice(0, 7)}-01`,
      coverageEnd: endOfMonth(m.issueDate),
    }))
}

/**
 * Create or re-price the student's invoices for the term from the fee policy.
 * Switching plan replaces the other plan's invoices for the term unless money has
 * already been paid against them; then the term stays on that plan.
 */
async function billStudentForTerm(
  student: Student,
  educationLevelId: string | undefined,
  term: Term,
  policy: FeePolicy,
  currentMonthOnly = false,
): Promise<BillOutcome> {
  const db = getAdminDb()
  const invoicesRef = db.collection('invoices')
  const category = feeCategoryFor(student.residency, educationLevelId)
  const chosen: PaymentPlan = student.paymentPlan ?? 'TERMLY'
  const other: PaymentPlan = chosen === 'TERMLY' ? 'MONTHLY' : 'TERMLY'
  if (currentMonthOnly && chosen !== 'MONTHLY') return 'skipped'
  const planned = plannedInvoices(student, term, policy, chosen, currentMonthOnly)
  if (planned.length === 0) return 'skipped'
  const grantsSnapshot = await db
    .collection('studentScholarships')
    .where('studentId', '==', student.id)
    .where('active', '==', true)
    .get()
  const scholarships = grantsSnapshot.docs.map(
    (doc) => ({ id: doc.id, ...(doc.data() as Omit<StudentScholarship, 'id'>) }) as StudentScholarship,
  )

  return db.runTransaction(async (tx) => {
    const otherSnaps = currentMonthOnly
      ? []
      : (
          await tx.getAll(
            ...planInvoiceIds(term.id, student.id, other).map((id) => invoicesRef.doc(id)),
          )
        ).filter((s) => s.exists)
    const otherHasPayments = currentMonthOnly
      ? false
      : (
          await Promise.all(
            otherSnaps.map((s) =>
              ((s.data() as Invoice).paid ?? 0) > 0
                ? Promise.resolve(true)
                : tx
                    .get(db.collection('payments').where('invoiceId', '==', s.id).limit(1))
                    .then((q) => !q.empty),
            ),
          )
        ).some(Boolean)
    const plan = otherHasPayments ? other : chosen
    const baseAmount = feeAmountFor(policy.fees, category, plan)
    const invoicesToBill = currentMonthOnly
      ? planned
      : plannedInvoices(student, term, policy, plan)
    const adjustedAmounts = invoicesToBill.map((period) =>
      scholarshipAdjustedFeeAmount(
        baseAmount,
        period.coverageStart,
        period.coverageEnd,
        scholarships,
        term.id,
      ),
    )
    const amounts = invoicesToBill.map(() => baseAmount)
    const scholarshipAmounts = adjustedAmounts.map((adjusted) =>
      roundMoney(baseAmount - adjusted),
    )
    const snaps = await tx.getAll(...invoicesToBill.map((p) => invoicesRef.doc(p.id)))

    const repriced = new Map<string, number>()
    for (const [index, snap] of snaps.entries()) {
      const amount = amounts[index]!
      if (!snap.exists || baseAmount <= 0) continue
      const existing = snap.data() as Invoice
      if (
        existing.total === amount &&
        (existing.scholarshipAmount ?? 0) === scholarshipAmounts[index] &&
        existing.category === category &&
        (existing.plan ?? 'TERMLY') === plan
      ) {
        continue
      }
      const confirmed = await tx.get(
        db
          .collection('payments')
          .where('invoiceId', '==', snap.id)
          .where('status', '==', 'CONFIRMED'),
      )
      repriced.set(
        snap.id,
        roundMoney(confirmed.docs.reduce((sum, d) => sum + ((d.data() as Payment).amount ?? 0), 0)),
      )
    }

    if (baseAmount <= 0) return snaps.some((s) => s.exists) ? 'unchanged' : 'skipped'

    let created = 0
    let updated = 0
    invoicesToBill.forEach((p, i) => {
      const snap = snaps[i]!
      const amount = amounts[i]!
      const scholarshipAmount = scholarshipAmounts[i]!
      if (!snap.exists) {
        if (student.status !== 'ACTIVE') return
        const invoice: Invoice = {
          id: p.id,
          number: p.number,
          dueDate: p.dueDate,
          ...(p.period ? { period: p.period } : {}),
          studentId: student.id,
          total: amount,
          paid: 0,
          scholarshipAmount,
          status: invoiceStatus(amount, 0, p.dueDate, scholarshipAmount),
          termId: term.id,
          termName: term.name,
          category,
          plan,
          createdAt: new Date().toISOString(),
        }
        tx.set(snap.ref, invoice)
        created += 1
        return
      }
      const paid = repriced.get(snap.id)
      if (paid === undefined) return
      const existing = { ...(snap.data() as Invoice), id: snap.id }
      tx.set(snap.ref, {
        ...existing,
        total: amount,
        scholarshipAmount,
        category,
        plan,
        paid,
        status: invoiceStatus(amount, paid, existing.dueDate, scholarshipAmount),
      })
      updated += 1
    })

    if (!currentMonthOnly && plan === chosen && (created > 0 || snaps.some((s) => s.exists))) {
      for (const s of otherSnaps) {
        tx.delete(s.ref)
        updated += 1
      }
    }

    if (created > 0) return 'created'
    if (updated > 0) return 'updated'
    return snaps.some((s) => s.exists) ? 'unchanged' : 'skipped'
  })
}

async function classLevelMap(): Promise<Map<string, string | undefined>> {
  const snap = await getAdminDb().collection('classes').get()
  const map = new Map<string, string | undefined>()
  for (const doc of snap.docs) {
    const cls = doc.data() as SchoolClass
    map.set(doc.id, cls.educationLevelId || resolveEducationLevelId(cls.level))
  }
  return map
}

async function billActiveStudents(
  term: Term,
  policy: FeePolicy,
  include: (student: Student) => boolean = () => true,
): Promise<TermBillingResult> {
  const [studentsSnap, levels] = await Promise.all([
    getAdminDb().collection('students').where('status', '==', 'ACTIVE').get(),
    classLevelMap(),
  ])
  const students = studentsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<Student, 'id'>) }) as Student)
    .filter(include)

  const result: TermBillingResult = {
    termId: term.id,
    termName: term.name,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
  }
  let cursor = 0
  const worker = async () => {
    while (cursor < students.length) {
      const student = students[cursor++]!
      const level = student.educationLevelId || levels.get(student.classId)
      result[await billStudentForTerm(student, level, term, policy)] += 1
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, students.length) }, worker))
  return result
}

/** Bill every active student for the term; re-running re-prices existing invoices. */
export async function generateTermInvoices(
  session: SessionContext,
  termId?: string,
  requestId?: string,
): Promise<TermBillingResult> {
  requirePermission(session, 'fees.create')
  const [term, policy] = await Promise.all([resolveBillingTerm(termId), getFeePolicy()])
  if (!hasAnyFee(policy.fees)) {
    throw badRequest('Set the fee amounts in Settings → Fees before billing.')
  }

  const result = await billActiveStudents(term, policy)

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'fees.bill_term',
    entityType: 'terms',
    entityId: term.id,
    requestId,
    metadata: { ...result },
  })
  return result
}

/** Bill this student's monthly invoice for the current calendar month only. */
export async function generateCurrentMonthInvoice(
  session: SessionContext,
  studentId: string,
  requestId?: string,
): Promise<TermBillingResult> {
  requirePermission(session, 'fees.create')
  const student = await assertCanAccessStudent(session, studentId)
  if (student.status !== 'ACTIVE') throw badRequest('Only active students can be billed')
  if (student.paymentPlan !== 'MONTHLY') {
    throw badRequest('Current-month billing is only available for students on the monthly plan')
  }
  const [term, policy] = await Promise.all([resolveBillingTerm(), getFeePolicy()])
  if (!hasAnyFee(policy.fees)) {
    throw badRequest('Set the fee amounts in Settings → Fees before billing.')
  }
  let level = student.educationLevelId
  if (!level) {
    const cls = await getDoc<SchoolClass>('classes', student.classId)
    level = cls?.educationLevelId || resolveEducationLevelId(cls?.level)
  }
  const outcome = await billStudentForTerm(student, level, term, policy, true)
  const result: TermBillingResult = {
    termId: term.id,
    termName: term.name,
    created: outcome === 'created' ? 1 : 0,
    updated: outcome === 'updated' ? 1 : 0,
    unchanged: outcome === 'unchanged' ? 1 : 0,
    skipped: outcome === 'skipped' ? 1 : 0,
  }
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'fees.bill_current_month',
    entityType: 'students',
    entityId: studentId,
    requestId,
    metadata: { ...result, studentId, month: new Date().toISOString().slice(0, 7) },
  })
  return result
}

/** Daily job: raise the invoice for each month that has started for monthly-plan students. */
export async function raiseMonthlyInvoices(): Promise<TermBillingResult | null> {
  const [term, policy] = await Promise.all([resolveBillingTerm(), getFeePolicy()])
  if (!hasAnyFee(policy.fees)) return null
  return billActiveStudents(term, policy, (s) => s.paymentPlan === 'MONTHLY')
}

/**
 * Keep the student's term invoice in line with fees and scholarship coverage.
 * Ordinary profile sync remains non-blocking; a selected scholarship term must report failures.
 */
export async function syncStudentTermInvoice(
  student: Student,
  termId?: string,
): Promise<void> {
  try {
    const [currentTerm, policy] = await Promise.all([resolveBillingTerm(), getFeePolicy()])
    const term = termId ? await getDoc<Term>('terms', termId) : currentTerm
    if (!term) throw new Error(`Scholarship term not found: ${termId}`)
    let level = student.educationLevelId
    if (!level) {
      const cls = await getDoc<SchoolClass>('classes', student.classId)
      level = cls?.educationLevelId || resolveEducationLevelId(cls?.level)
    }
    await billStudentForTerm(student, level, term, policy)
  } catch (err) {
    console.error('[fees] could not sync term invoice', student.id, err)
    if (termId) throw err
  }
}

/** Server-authoritative paid sum from CONFIRMED payments only. */
export async function computeConfirmedPaid(invoiceId: string): Promise<number> {
  const snap = await getAdminDb()
    .collection('payments')
    .where('invoiceId', '==', invoiceId)
    .where('status', '==', 'CONFIRMED')
    .get()

  return snap.docs.reduce((sum, d) => {
    const amount = (d.data() as Payment).amount
    return sum + (typeof amount === 'number' ? amount : 0)
  }, 0)
}

export async function listInvoices(
  session: SessionContext,
  studentId?: string,
): Promise<InvoiceDto[]> {
  requirePermission(session, 'fees.read')

  if (studentId) {
    await assertCanAccessStudent(session, studentId)
    return (await byStudents<Invoice>('invoices', [studentId])).map(withLiveStatus)
  }

  if (session.role === 'PARENT' || session.role === 'STUDENT') {
    const students = await listAccessibleStudents(session)
    const ids = students.map((s) => s.id)
    return (await byStudents<Invoice>('invoices', ids)).map(withLiveStatus)
  }

  const snap = await getAdminDb().collection('invoices').get()
  return snap.docs.map((d) => withLiveStatus({ ...(d.data() as Invoice), id: d.id }))
}

/** Firestore `in` queries accept at most 30 values. */
async function byStudents<T extends { id: string }>(
  collection: 'invoices' | 'payments',
  studentIds: string[],
): Promise<T[]> {
  const db = getAdminDb()
  const out: T[] = []
  for (let i = 0; i < studentIds.length; i += 30) {
    const snap = await db
      .collection(collection)
      .where('studentId', 'in', studentIds.slice(i, i + 30))
      .get()
    out.push(...snap.docs.map((d) => ({ ...(d.data() as Omit<T, 'id'>), id: d.id }) as T))
  }
  return out
}

export async function listPayments(
  session: SessionContext,
  studentId?: string,
): Promise<PaymentDto[]> {
  requirePermission(session, 'payments.read')

  if (studentId) {
    await assertCanAccessStudent(session, studentId)
    return byStudents<Payment>('payments', [studentId])
  }

  if (session.role === 'PARENT' || session.role === 'STUDENT') {
    const students = await listAccessibleStudents(session)
    return byStudents<Payment>('payments', students.map((s) => s.id))
  }

  const snap = await getAdminDb()
    .collection('payments')
    .orderBy('paidAt', 'desc')
    .limit(2000)
    .get()
  return snap.docs.map((d) => ({ ...(d.data() as Payment), id: d.id }))
}

/**
 * Create a CONFIRMED payment inside a transaction.
 * - Rejects duplicate receiptNumber
 * - Never trusts client totals; recalculates invoice.paid from CONFIRMED payments
 */
export async function createPayment(
  session: SessionContext,
  input: PaymentCreateInput,
  requestId?: string,
): Promise<{
  payment: PaymentDto
  invoice: InvoiceDto
  feesCleared: boolean
  allocations: { payment: PaymentDto; invoice: InvoiceDto }[]
}> {
  requirePermission(session, 'payments.create')
  await assertCanAccessStudent(session, input.studentId)

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw badRequest('Payment amount must be a positive number')
  }

  const requestedAllocations = input.allocations?.length
    ? input.allocations.map((allocation) => ({
        invoiceId: allocation.invoiceId,
        amount: roundMoney(allocation.amount),
      }))
    : [{ invoiceId: input.invoiceId, amount: roundMoney(input.amount) }]
  const allocatedTotal = roundMoney(
    requestedAllocations.reduce((sum, allocation) => sum + allocation.amount, 0),
  )
  if (
    requestedAllocations[0]?.invoiceId !== input.invoiceId ||
    Math.abs(allocatedTotal - roundMoney(input.amount)) > 0.001 ||
    new Set(requestedAllocations.map((allocation) => allocation.invoiceId)).size !==
      requestedAllocations.length
  ) {
    throw badRequest('Payment allocations must uniquely cover the entered amount')
  }

  const db = getAdminDb()
  const policyRef = db.collection('settings').doc('feePolicy')

  const result = await db.runTransaction(async (tx) => {
    const invoiceRefs = requestedAllocations.map((allocation) =>
      db.collection('invoices').doc(allocation.invoiceId),
    )
    const invoiceSnaps = await tx.getAll(...invoiceRefs)
    if (invoiceSnaps.some((snap) => !snap.exists)) throw notFound('Invoice not found')
    const invoices = invoiceSnaps.map((snap) => ({
      id: snap.id,
      ...(snap.data() as Omit<Invoice, 'id'>),
    }))
    if (invoices.some((invoice) => invoice.studentId !== input.studentId)) {
      throw badRequest('Invoice does not belong to the given student')
    }
    if (
      requestedAllocations.length > 1 &&
      (invoices.some((invoice) => invoice.plan !== 'MONTHLY') ||
        invoices.some((invoice) => invoice.termId !== invoices[0]?.termId) ||
        invoices.some((invoice, index) =>
          index > 0 && invoice.dueDate < invoices[index - 1]!.dueDate,
        ))
    ) {
      throw badRequest('Split payments must follow monthly invoices in the same term')
    }

    const manualReceipt = input.receiptNumber?.trim() ?? ''
    const policySnap =
      !manualReceipt || requestedAllocations.length > 1
        ? await tx.get(policyRef)
        : null
    const policy = policySnap?.data() as Partial<FeePolicy> | undefined
    const nextReceipt = Math.max(1, Math.floor(Number(policy?.nextReceiptNumber) || 1001))
    const prefix = (policy?.receiptPrefix || 'VHS').toUpperCase()
    let generatedCount = 0
    const receiptNumbers = requestedAllocations.map((_, index) => {
      if (index === 0 && manualReceipt) return manualReceipt
      generatedCount += 1
      return `${prefix}-${nextReceipt + generatedCount - 1}`
    })

    const duplicateReceipts = await Promise.all(
      receiptNumbers.map((receipt) =>
        tx.get(db.collection('payments').where('receiptNumber', '==', receipt).limit(1)),
      ),
    )
    const duplicateIndex = duplicateReceipts.findIndex((snapshot) => !snapshot.empty)
    if (duplicateIndex >= 0) {
      const receipt = receiptNumbers[duplicateIndex]!
      throw conflict(
        manualReceipt && duplicateIndex === 0
          ? `Receipt ${receipt} already exists`
          : `Receipt ${receipt} already exists — raise "Next receipt number" in Settings → Fees.`,
      )
    }

    const confirmedPayments = await Promise.all(
      requestedAllocations.map((allocation) =>
        tx.get(
          db
            .collection('payments')
            .where('invoiceId', '==', allocation.invoiceId)
            .where('status', '==', 'CONFIRMED'),
        ),
      ),
    )

    const allocations = requestedAllocations.map((allocation, index) => {
      const invoice = invoices[index]!
      const alreadyPaid = roundMoney(
        confirmedPayments[index]!.docs.reduce(
          (sum, doc) => sum + ((doc.data() as Payment).amount ?? 0),
          0,
        ),
      )
      const balance = invoiceBalance({ ...invoice, paid: alreadyPaid })
      if (allocation.amount > balance + 0.001) {
        throw badRequest(
          balance > 0
            ? `Payment exceeds the ${balance.toFixed(2)} balance on ${invoice.number}.`
            : `${invoice.number} is already fully paid.`,
        )
      }
      const paid = roundMoney(alreadyPaid + allocation.amount)
      const nextInvoice: Invoice = {
        ...invoice,
        paid,
        status: invoiceStatus(
          invoice.total,
          paid,
          invoice.dueDate,
          invoice.scholarshipAmount,
        ),
      }
      const payment: Payment = {
        id: newId('pay'),
        studentId: input.studentId,
        invoiceId: invoice.id,
        amount: allocation.amount,
        method: input.method,
        status: 'CONFIRMED',
        paidAt: input.paidAt ?? new Date().toISOString(),
        receiptNumber: receiptNumbers[index]!,
        recordedByName: session.profile.name || session.profile.email,
      }
      return { payment, invoice: nextInvoice }
    })

    allocations.forEach(({ payment, invoice }) => {
      tx.set(db.collection('payments').doc(payment.id), payment)
      tx.set(db.collection('invoices').doc(invoice.id), invoice)
    })
    if (generatedCount > 0) {
      tx.set(policyRef, { nextReceiptNumber: nextReceipt + generatedCount }, { merge: true })
    }

    return allocations
  })

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'payment.create',
    entityType: 'payments',
    entityId: result[0]!.payment.id,
    requestId,
    metadata: {
      invoiceIds: result.map((allocation) => allocation.invoice.id),
      amount: allocatedTotal,
      receiptNumbers: result.map((allocation) => allocation.payment.receiptNumber),
    },
  })

  return {
    ...result[0]!,
    feesCleared: await isFeeCleared(input.studentId),
    allocations: result,
  }
}

export async function getInvoice(session: SessionContext, id: string): Promise<InvoiceDto> {
  requirePermission(session, 'fees.read')
  const invoice = await getDoc<Invoice>('invoices', id)
  if (!invoice) throw notFound('Invoice not found')
  await assertCanAccessStudent(session, invoice.studentId)
  return invoice
}

/** Fee clearance ignores future monthly instalments while keeping current fees enforceable. */
export async function isFeeCleared(studentId: string): Promise<boolean> {
  const [invoices, term] = await Promise.all([
    getAdminDb()
      .collection('invoices')
      .where('studentId', '==', studentId)
      .get(),
    resolveBillingTerm(),
  ])

  if (invoices.empty) return true

  const currentInvoices = invoicesForBillingPeriod(
    invoices.docs.map((doc) => ({ ...(doc.data() as Invoice), id: doc.id })),
    term.id,
    currentMonthPeriod(),
  )
  for (const inv of currentInvoices) {
    if (!invoiceBlocksPortal(inv)) continue
    const paid = await computeConfirmedPaid(inv.id)
    const outstanding = invoiceBalance({ ...inv, paid })
    if (outstanding > 0) return false
  }
  return true
}

export async function reversePayment(
  session: SessionContext,
  paymentId: string,
  requestId?: string,
): Promise<PaymentDto> {
  requirePermission(session, 'payments.reverse')
  const db = getAdminDb()

  const result = await db.runTransaction(async (tx) => {
    const paymentRef = db.collection('payments').doc(paymentId)
    const paymentSnap = await tx.get(paymentRef)
    if (!paymentSnap.exists) throw notFound('Payment not found')
    const payment = { id: paymentSnap.id, ...(paymentSnap.data() as Omit<Payment, 'id'>) }

    if (payment.status !== 'CONFIRMED') {
      throw badRequest('Only CONFIRMED payments can be reversed')
    }

    const invoiceRef = db.collection('invoices').doc(payment.invoiceId)
    const invoiceSnap = await tx.get(invoiceRef)
    if (!invoiceSnap.exists) throw notFound('Invoice not found')
    const invoice = { id: invoiceSnap.id, ...(invoiceSnap.data() as Omit<Invoice, 'id'>) }

    const confirmedSnap = await tx.get(
      db
        .collection('payments')
        .where('invoiceId', '==', payment.invoiceId)
        .where('status', '==', 'CONFIRMED'),
    )

    let paid = 0
    for (const d of confirmedSnap.docs) {
      if (d.id === paymentId) continue
      paid += (d.data() as Payment).amount ?? 0
    }

    paid = roundMoney(paid)
    const reversed: Payment = { ...payment, status: 'REVERSED' }
    const nextInvoice: Invoice = {
      ...invoice,
      paid,
      status: invoiceStatus(
        invoice.total,
        paid,
        invoice.dueDate,
        invoice.scholarshipAmount,
      ),
    }

    tx.set(paymentRef, reversed)
    tx.set(invoiceRef, nextInvoice)
    return reversed
  })

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'payment.reverse',
    entityType: 'payments',
    entityId: paymentId,
    requestId,
  })

  return result
}

export const listInvoicesService = listInvoices
export const listPaymentsService = listPayments
export const createPaymentService = createPayment
export const reversePaymentService = async (
  session: SessionContext,
  id: string | string[] | undefined,
  requestId?: string,
) => {
  const paymentId = Array.isArray(id) ? id[0] : id
  if (!paymentId) throw notFound('Payment id required')
  return reversePayment(session, paymentId, requestId)
}
