import 'server-only'

import { getAdminDb } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'

/** Firestore collections for the HR, payroll and finance module (server access only). */
export const HR = {
  staff: 'hr_staff',
  scales: 'salary_scales',
  payroll: 'payroll',
  items: 'payroll_items',
  deductions: 'deductions',
  expenses: 'expenses',
  expenseCategories: 'expense_categories',
  revenues: 'revenues',
  attendanceRules: 'attendance_deductions',
  payslips: 'payslips',
} as const

export function actorName(session: SessionContext) {
  return session.profile.name || session.email || 'Administrator'
}

export function nowIso() {
  return new Date().toISOString()
}

/** Drop undefined fields — Firestore rejects them. */
export function clean<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as T
}

export async function readAll<T extends { id: string }>(collection: string): Promise<T[]> {
  const snap = await getAdminDb().collection(collection).get()
  return snap.docs.map((d) => ({ ...(d.data() as Omit<T, 'id'>), id: d.id }) as T)
}

/** Next code from a transactional counter, e.g. EMP-0008. */
export async function nextSequenceCode(counter: string, prefix: string, width = 4) {
  const db = getAdminDb()
  const ref = db.collection('counters').doc(counter)
  const value = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const next = Number(snap.data()?.value ?? 0) + 1
    tx.set(ref, { value: next, updatedAt: nowIso() }, { merge: true })
    return next
  })
  return `${prefix}-${String(value).padStart(width, '0')}`
}

export async function audit(
  session: SessionContext,
  action: string,
  entityType: string,
  entityId: string,
  requestId?: string,
  metadata?: Record<string, unknown>,
) {
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action,
    entityType,
    entityId,
    requestId,
    ...(metadata ? { metadata } : {}),
  })
}
