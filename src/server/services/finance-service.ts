import 'server-only'

import { getAdminDb } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import { assertCanAccessStudent, listAccessibleStudents } from '@/server/authorization/isolation'
import { badRequest, conflict, notFound } from '@/server/errors'
import { getDoc, newId, queryCollection } from '@/server/repositories/firestore-repo'
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
} from '@/lib/fees'
import type { PaymentCreateInput } from '@/server/validators/school'
import type {
  FeePolicy,
  Invoice,
  Payment,
  PaymentPlan,
  SchoolClass,
  Student,
  Term,
  TermBillingResult,
} from '@/types'

export type InvoiceDto = Invoice
export type PaymentDto = Payment

function invoiceStatus(total: number, paid: number, dueDate: string): Invoice['status'] {
  if (paid >= total && total > 0) return 'PAID'
  if (paid <= 0) {
    return Date.parse(dueDate) < Date.now() ? 'OVERDUE' : 'OPEN'
  }
  return Date.parse(dueDate) < Date.now() ? 'OVERDUE' : 'PARTIAL'
}

/** Stored status goes stale as due dates pass, so recompute it on every read. */
function withLiveStatus(invoice: Invoice): Invoice {
  return { ...invoice, status: invoiceStatus(invoice.total, invoice.paid, invoice.dueDate) }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100
}

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
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

type PlannedInvoice = Pick<Invoice, 'id' | 'number' | 'dueDate' | 'period'>

/** Monthly-plan invoice ids for a term, up to the largest months-per-term setting. */
const MAX_MONTHS_PER_TERM = 6

function planInvoiceIds(termId: string, studentId: string, plan: PaymentPlan): string[] {
  if (plan === 'TERMLY') return [termInvoiceId(termId, studentId)]
  return Array.from({ length: MAX_MONTHS_PER_TERM }, (_, i) =>
    monthlyInvoiceId(termId, studentId, i + 1),
  )
}

/** Termly: one invoice. Monthly: the first month plus every month that has started. */
function plannedInvoices(
  student: Student,
  term: Term,
  policy: FeePolicy,
  plan: PaymentPlan,
): PlannedInvoice[] {
  const code = term.id.replace(/^term-/, '')
  if (plan === 'TERMLY') {
    return [
      {
        id: termInvoiceId(term.id, student.id),
        number: `INV-${code}-${student.studentNumber}`,
        dueDate: addDays(term.startDate, policy.overdueGraceDays),
      },
    ]
  }
  const today = new Date().toISOString().slice(0, 10)
  return monthlyInstalments(term.startDate, policy.monthsPerTerm, policy.overdueGraceDays)
    .filter((m) => m.instalment === 1 || m.issueDate <= today)
    .map((m) => ({
      id: monthlyInvoiceId(term.id, student.id, m.instalment),
      number: `INV-${code}-${student.studentNumber}-M${m.instalment}`,
      dueDate: m.dueDate,
      period: m.period,
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
): Promise<BillOutcome> {
  const db = getAdminDb()
  const invoicesRef = db.collection('invoices')
  const category = feeCategoryFor(student.residency, educationLevelId)
  const chosen: PaymentPlan = student.paymentPlan ?? 'TERMLY'
  const other: PaymentPlan = chosen === 'TERMLY' ? 'MONTHLY' : 'TERMLY'

  return db.runTransaction(async (tx) => {
    const otherSnaps = (
      await tx.getAll(...planInvoiceIds(term.id, student.id, other).map((id) => invoicesRef.doc(id)))
    ).filter((s) => s.exists)
    const otherHasPayments = (
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
    const amount = feeAmountFor(policy.fees, category, plan)
    const planned = plannedInvoices(student, term, policy, plan)
    const snaps = await tx.getAll(...planned.map((p) => invoicesRef.doc(p.id)))

    const repriced = new Map<string, number>()
    for (const snap of snaps) {
      if (!snap.exists || amount <= 0) continue
      const existing = snap.data() as Invoice
      if (
        existing.total === amount &&
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

    if (amount <= 0) return snaps.some((s) => s.exists) ? 'unchanged' : 'skipped'

    let created = 0
    let updated = 0
    planned.forEach((p, i) => {
      const snap = snaps[i]!
      if (!snap.exists) {
        if (student.status !== 'ACTIVE') return
        const invoice: Invoice = {
          ...p,
          studentId: student.id,
          total: amount,
          paid: 0,
          status: invoiceStatus(amount, 0, p.dueDate),
          termId: term.id,
          termName: term.name,
          category,
          plan,
          createdAt: new Date().toISOString(),
        }
        if (!invoice.period) delete invoice.period
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
        category,
        plan,
        paid,
        status: invoiceStatus(amount, paid, existing.dueDate),
      })
      updated += 1
    })

    if (plan === chosen && (created > 0 || snaps.some((s) => s.exists))) {
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

/** Daily job: raise the invoice for each month that has started for monthly-plan students. */
export async function raiseMonthlyInvoices(): Promise<TermBillingResult | null> {
  const [term, policy] = await Promise.all([resolveBillingTerm(), getFeePolicy()])
  if (!hasAnyFee(policy.fees)) return null
  return billActiveStudents(term, policy, (s) => s.paymentPlan === 'MONTHLY')
}

/**
 * Keep the student's current-term invoice in line with their fee category after
 * registration or a profile edit. Never blocks the student save.
 */
export async function syncStudentTermInvoice(student: Student): Promise<void> {
  try {
    const [term, policy] = await Promise.all([resolveBillingTerm(), getFeePolicy()])
    let level = student.educationLevelId
    if (!level) {
      const cls = await getDoc<SchoolClass>('classes', student.classId)
      level = cls?.educationLevelId || resolveEducationLevelId(cls?.level)
    }
    await billStudentForTerm(student, level, term, policy)
  } catch (err) {
    console.error('[fees] could not sync term invoice', student.id, err)
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
): Promise<{ payment: PaymentDto; invoice: InvoiceDto; feesCleared: boolean }> {
  requirePermission(session, 'payments.create')
  await assertCanAccessStudent(session, input.studentId)

  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw badRequest('Payment amount must be a positive number')
  }

  const db = getAdminDb()
  const amount = roundMoney(input.amount)
  const policyRef = db.collection('settings').doc('feePolicy')

  const result = await db.runTransaction(async (tx) => {
    const invoiceRef = db.collection('invoices').doc(input.invoiceId)
    const invoiceSnap = await tx.get(invoiceRef)
    if (!invoiceSnap.exists) throw notFound('Invoice not found')
    const invoice = { id: invoiceSnap.id, ...(invoiceSnap.data() as Omit<Invoice, 'id'>) }

    if (invoice.studentId !== input.studentId) {
      throw badRequest('Invoice does not belong to the given student')
    }

    // All reads before writes (Firestore transaction rule)
    let receipt = input.receiptNumber?.trim() ?? ''
    let nextReceiptNumber: number | null = null
    if (!receipt) {
      const policySnap = await tx.get(policyRef)
      const policy = policySnap.data() as Partial<FeePolicy> | undefined
      const next = Math.max(1, Math.floor(Number(policy?.nextReceiptNumber) || 1001))
      receipt = `${(policy?.receiptPrefix || 'VHS').toUpperCase()}-${next}`
      nextReceiptNumber = next + 1
    }

    const dupSnap = await tx.get(
      db.collection('payments').where('receiptNumber', '==', receipt).limit(1),
    )
    if (!dupSnap.empty) {
      throw conflict(
        nextReceiptNumber
          ? `Receipt ${receipt} already exists — raise "Next receipt number" in Settings → Fees.`
          : `Receipt ${receipt} already exists`,
      )
    }

    const confirmedSnap = await tx.get(
      db
        .collection('payments')
        .where('invoiceId', '==', input.invoiceId)
        .where('status', '==', 'CONFIRMED'),
    )

    let alreadyPaid = 0
    for (const d of confirmedSnap.docs) {
      alreadyPaid += (d.data() as Payment).amount ?? 0
    }
    const balance = roundMoney((invoice.total ?? 0) - alreadyPaid)
    if (amount > balance + 0.001) {
      throw badRequest(
        balance > 0
          ? `Amount is more than the balance of ${balance.toFixed(2)} on ${invoice.number}.`
          : `${invoice.number} is already fully paid.`,
      )
    }
    const paid = roundMoney(alreadyPaid + amount)

    const paymentId = newId('pay')
    const paymentRef = db.collection('payments').doc(paymentId)
    const payment: Payment = {
      id: paymentId,
      studentId: input.studentId,
      invoiceId: input.invoiceId,
      amount,
      method: input.method,
      status: 'CONFIRMED',
      paidAt: input.paidAt ?? new Date().toISOString(),
      receiptNumber: receipt,
      recordedByName: session.profile.name || session.profile.email,
    }

    const nextInvoice: Invoice = {
      ...invoice,
      paid,
      status: invoiceStatus(invoice.total, paid, invoice.dueDate),
    }

    tx.set(paymentRef, payment)
    tx.set(invoiceRef, nextInvoice)
    if (nextReceiptNumber) {
      tx.set(policyRef, { nextReceiptNumber }, { merge: true })
    }

    return { payment, invoice: nextInvoice }
  })

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'payment.create',
    entityType: 'payments',
    entityId: result.payment.id,
    requestId,
    metadata: {
      invoiceId: input.invoiceId,
      amount,
      receiptNumber: result.payment.receiptNumber,
    },
  })

  return { ...result, feesCleared: await isFeeCleared(input.studentId) }
}

export async function getInvoice(session: SessionContext, id: string): Promise<InvoiceDto> {
  requirePermission(session, 'fees.read')
  const invoice = await getDoc<Invoice>('invoices', id)
  if (!invoice) throw notFound('Invoice not found')
  await assertCanAccessStudent(session, invoice.studentId)
  return invoice
}

/** Fee clearance: PAID or outstanding === 0 (using server paid sum). */
export async function isFeeCleared(studentId: string): Promise<boolean> {
  const invoices = await getAdminDb()
    .collection('invoices')
    .where('studentId', '==', studentId)
    .get()

  if (invoices.empty) return true

  for (const doc of invoices.docs) {
    const inv = doc.data() as Invoice
    const paid = await computeConfirmedPaid(doc.id)
    const outstanding = Math.max(0, (inv.total ?? 0) - paid)
    if (inv.status !== 'PAID' && outstanding > 0) return false
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
      status: invoiceStatus(invoice.total, paid, invoice.dueDate),
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
