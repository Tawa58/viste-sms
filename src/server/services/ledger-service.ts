import 'server-only'

import { getAdminDb } from '@/lib/firebase/admin'
import { DEFAULT_EXPENSE_CATEGORIES } from '@/lib/hr/constants'
import { buildFinanceSummary, type FeePaymentLite } from '@/lib/hr/finance-summary'
import { round2 } from '@/lib/hr/payroll-engine'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import { badRequest, conflict, notFound } from '@/server/errors'
import { getDoc, newId } from '@/server/repositories/firestore-repo'
import {
  HR,
  actorName,
  audit,
  clean,
  nextSequenceCode,
  nowIso,
  readAll,
} from '@/server/services/hr-common'
import type { ExpenseBody, RevenueBody } from '@/server/validators/hr'
import type { Expense, ExpenseCategory, FinanceSummary, Revenue } from '@/types'

const MAX_ROWS = 3000

async function inRange<T>(collection: string, from: string, to: string): Promise<T[]> {
  const snap = await getAdminDb()
    .collection(collection)
    .where('date', '>=', from)
    .where('date', '<=', to)
    .orderBy('date', 'desc')
    .limit(MAX_ROWS)
    .get()
  return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }))
}

/* ---------- Expenses ---------- */

export async function listExpenses(
  session: SessionContext,
  range: { from: string; to: string },
): Promise<Expense[]> {
  requirePermission(session, 'finance.read')
  const rows = await inRange<Expense>(HR.expenses, range.from, range.to)
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

function expenseFields(body: ExpenseBody) {
  return {
    date: body.date,
    category: body.category.trim(),
    description: body.description.trim(),
    quantity: body.quantity,
    unitPrice: round2(body.unitPrice),
    totalAmount: round2(body.quantity * body.unitPrice),
    supplier: body.supplier?.trim() ?? '',
    paymentMethod: body.paymentMethod,
    notes: body.notes?.trim() || undefined,
  }
}

export async function createExpense(
  session: SessionContext,
  body: ExpenseBody,
  requestId?: string,
): Promise<Expense> {
  requirePermission(session, 'finance.manage')
  const id = newId('exp')
  const now = nowIso()
  const row: Expense = clean({
    ...expenseFields(body),
    id,
    expenseNo: await nextSequenceCode('expense', 'EXP'),
    source: 'MANUAL',
    createdByName: actorName(session),
    createdAt: now,
    updatedAt: now,
  })
  await getAdminDb().collection(HR.expenses).doc(id).set(row)
  await audit(session, 'finance.expense_create', HR.expenses, id, requestId, {
    totalAmount: row.totalAmount,
    category: row.category,
  })
  return row
}

async function manualExpense(id: string) {
  const current = await getDoc<Expense>(HR.expenses, id)
  if (!current) throw notFound('Expense not found')
  if (current.source === 'PAYROLL') {
    throw conflict('Payroll expenses are posted automatically when a payroll is locked and can’t be changed here.')
  }
  return current
}

export async function updateExpense(
  session: SessionContext,
  id: string,
  body: ExpenseBody,
  requestId?: string,
): Promise<Expense> {
  requirePermission(session, 'finance.manage')
  const current = await manualExpense(id)
  const next: Expense = clean({
    ...current,
    ...expenseFields(body),
    notes: body.notes?.trim() || undefined,
    updatedAt: nowIso(),
  })
  await getAdminDb().collection(HR.expenses).doc(id).set(next)
  await audit(session, 'finance.expense_update', HR.expenses, id, requestId, {
    totalAmount: next.totalAmount,
  })
  return next
}

export async function deleteExpense(session: SessionContext, id: string, requestId?: string) {
  requirePermission(session, 'finance.manage')
  await manualExpense(id)
  await getAdminDb().collection(HR.expenses).doc(id).delete()
  await audit(session, 'finance.expense_delete', HR.expenses, id, requestId)
}

/* ---------- Expense categories ---------- */

export async function listExpenseCategories(session: SessionContext): Promise<ExpenseCategory[]> {
  requirePermission(session, 'finance.read')
  const custom = await readAll<ExpenseCategory>(HR.expenseCategories)
  const builtIn = DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
    id: `builtin-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name,
    builtIn: true,
  }))
  const seen = new Set(builtIn.map((c) => c.name.toLowerCase()))
  return [
    ...builtIn,
    ...custom
      .filter((c) => !seen.has(c.name.toLowerCase()))
      .map((c) => ({ id: c.id, name: c.name, builtIn: false }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ]
}

export async function createExpenseCategory(
  session: SessionContext,
  name: string,
  requestId?: string,
): Promise<ExpenseCategory> {
  requirePermission(session, 'finance.manage')
  const trimmed = name.trim().replace(/\s+/g, ' ')
  const all = await listExpenseCategories(session)
  if (all.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    throw conflict(`“${trimmed}” already exists`)
  }
  const id = newId('xcat')
  const row = { id, name: trimmed, builtIn: false, createdAt: nowIso(), createdByName: actorName(session) }
  await getAdminDb().collection(HR.expenseCategories).doc(id).set(row)
  await audit(session, 'finance.expense_category_create', HR.expenseCategories, id, requestId)
  return { id, name: trimmed, builtIn: false }
}

export async function deleteExpenseCategory(session: SessionContext, id: string, requestId?: string) {
  requirePermission(session, 'finance.manage')
  if (id.startsWith('builtin-')) throw badRequest('Built-in categories can’t be removed')
  const current = await getDoc<ExpenseCategory>(HR.expenseCategories, id)
  if (!current) throw notFound('Category not found')
  await getAdminDb().collection(HR.expenseCategories).doc(id).delete()
  await audit(session, 'finance.expense_category_delete', HR.expenseCategories, id, requestId)
}

/* ---------- Revenue ---------- */

export async function listRevenues(
  session: SessionContext,
  range: { from: string; to: string },
): Promise<Revenue[]> {
  requirePermission(session, 'finance.read')
  const rows = await inRange<Revenue>(HR.revenues, range.from, range.to)
  return rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

function revenueFields(body: RevenueBody) {
  return {
    date: body.date,
    source: body.source,
    description: body.description.trim(),
    amount: round2(body.amount),
    reference: body.reference?.trim() || undefined,
  }
}

export async function createRevenue(
  session: SessionContext,
  body: RevenueBody,
  requestId?: string,
): Promise<Revenue> {
  requirePermission(session, 'finance.manage')
  const id = newId('rev')
  const now = nowIso()
  const row: Revenue = clean({
    ...revenueFields(body),
    id,
    revenueNo: await nextSequenceCode('revenue', 'REV'),
    createdByName: actorName(session),
    createdAt: now,
    updatedAt: now,
  })
  await getAdminDb().collection(HR.revenues).doc(id).set(row)
  await audit(session, 'finance.revenue_create', HR.revenues, id, requestId, { amount: row.amount })
  return row
}

export async function updateRevenue(
  session: SessionContext,
  id: string,
  body: RevenueBody,
  requestId?: string,
): Promise<Revenue> {
  requirePermission(session, 'finance.manage')
  const current = await getDoc<Revenue>(HR.revenues, id)
  if (!current) throw notFound('Revenue entry not found')
  const next: Revenue = clean({ ...current, ...revenueFields(body), updatedAt: nowIso() })
  if (!body.reference?.trim()) delete next.reference
  await getAdminDb().collection(HR.revenues).doc(id).set(next)
  await audit(session, 'finance.revenue_update', HR.revenues, id, requestId, { amount: next.amount })
  return next
}

export async function deleteRevenue(session: SessionContext, id: string, requestId?: string) {
  requirePermission(session, 'finance.manage')
  const current = await getDoc<Revenue>(HR.revenues, id)
  if (!current) throw notFound('Revenue entry not found')
  await getAdminDb().collection(HR.revenues).doc(id).delete()
  await audit(session, 'finance.revenue_delete', HR.revenues, id, requestId)
}

/* ---------- Dashboard ---------- */

export async function getFinanceSummary(
  session: SessionContext,
  year: number,
): Promise<FinanceSummary> {
  requirePermission(session, 'finance.read')
  const db = getAdminDb()
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const [paymentsSnap, invoicesSnap, revenues, expenses] = await Promise.all([
    db
      .collection('payments')
      .where('paidAt', '>=', from)
      .where('paidAt', '<', `${year + 1}-01-01`)
      .select('amount', 'paidAt', 'status')
      .get(),
    db.collection('invoices').select('total', 'paid').get(),
    inRange<Revenue>(HR.revenues, from, to),
    inRange<Expense>(HR.expenses, from, to),
  ])
  const feePayments = paymentsSnap.docs.map((d) => {
    const p = d.data() as Partial<FeePaymentLite>
    return { amount: Number(p.amount) || 0, paidAt: String(p.paidAt ?? ''), status: String(p.status ?? '') }
  })
  const outstandingFees = invoicesSnap.docs.reduce((sum, d) => {
    const inv = d.data() as { total?: number; paid?: number }
    return sum + Math.max(0, (Number(inv.total) || 0) - (Number(inv.paid) || 0))
  }, 0)
  return buildFinanceSummary({ year, feePayments, revenues, expenses, outstandingFees })
}
