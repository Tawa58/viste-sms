import 'server-only'

import type { DocumentReference, Query, WriteBatch } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebase/admin'
import { buildMonthReport } from '@/lib/checkin'
import { DEFAULT_ATTENDANCE_RULES, SALARIES_CATEGORY } from '@/lib/hr/constants'
import {
  buildPayrollItem,
  currentScaleVersion,
  finalizeItem,
  payrollExclusion,
  periodEnd,
  periodKey,
  periodLabel,
  periodOf,
  resolveScaleVersion,
  summarizeItems,
} from '@/lib/hr/payroll-engine'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission, sessionHasPermission } from '@/server/authorization/permissions'
import { badRequest, conflict, forbidden, notFound } from '@/server/errors'
import { schoolToday } from '@/server/lib/school-time'
import { getDoc, newId } from '@/server/repositories/firestore-repo'
import { getCheckinSettings } from '@/server/services/checkin-service'
import {
  HR,
  actorName,
  audit,
  clean,
  nextSequenceCode,
  nowIso,
  readAll,
} from '@/server/services/hr-common'
import { getSchoolProfile } from '@/server/services/school-settings-service'
import type {
  AttendanceRulesBody,
  DeductionBody,
  DeductionUpdateBody,
} from '@/server/validators/hr'
import type {
  AttendanceDeductionSettings,
  CheckinTermRange,
  Expense,
  HrEmployee,
  PayrollDeduction,
  PayrollItem,
  PayrollItemAttendance,
  PayrollRun,
  PayrollRunDetail,
  PayrollSchoolInfo,
  PayrollSkippedEmployee,
  Payslip,
  SalaryScaleVersion,
  StaffCheckin,
  StaffCheckinMessage,
} from '@/types'

type Op = (batch: WriteBatch) => void

async function commitOps(ops: Op[]) {
  const db = getAdminDb()
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch()
    for (const op of ops.slice(i, i + 400)) op(batch)
    await batch.commit()
  }
}

/* ---------- Attendance deduction rules ---------- */

export async function getAttendanceRules(): Promise<AttendanceDeductionSettings> {
  const row = await getDoc<AttendanceDeductionSettings & { id: string }>(HR.attendanceRules, 'rules')
  if (!row) return { ...DEFAULT_ATTENDANCE_RULES }
  const { id: _id, ...rest } = row
  return { ...DEFAULT_ATTENDANCE_RULES, ...rest }
}

export async function getAttendanceRulesService(session: SessionContext) {
  requirePermission(session, 'payroll.read')
  return getAttendanceRules()
}

export async function updateAttendanceRules(
  session: SessionContext,
  body: AttendanceRulesBody,
  requestId?: string,
): Promise<AttendanceDeductionSettings> {
  requirePermission(session, 'payroll.manage')
  const row: AttendanceDeductionSettings = {
    ...body,
    updatedAt: nowIso(),
    updatedByName: actorName(session),
  }
  await getAdminDb().collection(HR.attendanceRules).doc('rules').set(row)
  await audit(session, 'payroll.attendance_rules_update', HR.attendanceRules, 'rules', requestId, {
    enabled: body.enabled,
    absentDay: body.absentDay,
    lateComing: body.lateComing,
  })
  return row
}

/* ---------- Attendance counts from daily check-in ---------- */

async function attendanceByUid(period: string, uids: string[]) {
  const counts = new Map<string, { absentDays: number; lateDays: number }>()
  if (uids.length === 0) return counts
  const db = getAdminDb()
  const start = `${period}-01`
  const end = periodEnd(period)
  const [settings, termsSnap, recordsSnap, noticesSnap] = await Promise.all([
    getCheckinSettings(),
    db.collection('terms').get(),
    db.collection('staffCheckins').where('date', '>=', start).where('date', '<=', end).get(),
    db.collection('staffCheckinMessages').where('absenceDate', '>=', start).where('absenceDate', '<=', end).get(),
  ])
  const terms = termsSnap.docs
    .map((d) => d.data() as { startDate?: string; endDate?: string })
    .filter((t): t is CheckinTermRange => Boolean(t.startDate && t.endDate))
  const records = recordsSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as StaffCheckin)
  const notices = noticesSnap.docs.map((d) => ({ ...d.data(), id: d.id }) as StaffCheckinMessage)
  const today = schoolToday()
  const through = end < today ? end : today
  for (const uid of uids) {
    const report = buildMonthReport({
      month: period,
      records: records.filter((r) => r.uid === uid),
      notices: notices.filter((n) => n.uid === uid),
      settings,
      terms,
      today: through,
    })
    counts.set(uid, { absentDays: report.absent, lateDays: report.late })
  }
  return counts
}

/* ---------- Payroll runs ---------- */

async function schoolInfo(): Promise<PayrollSchoolInfo> {
  const p = await getSchoolProfile()
  return clean({
    name: p.name,
    motto: p.motto || undefined,
    address: p.address || undefined,
    phone: p.phone || undefined,
    email: p.email || undefined,
  })
}

/** Letterhead details for HR / payroll / finance PDF exports. */
export async function getLetterheadSchool(session: SessionContext): Promise<PayrollSchoolInfo> {
  const allowed = (['hr.read', 'payroll.read', 'finance.read'] as const).some((p) =>
    sessionHasPermission(session, p),
  )
  if (!allowed) throw forbidden('Missing permission: finance.read')
  return schoolInfo()
}

async function itemsFor(payrollId: string): Promise<PayrollItem[]> {
  const snap = await getAdminDb().collection(HR.items).where('payrollId', '==', payrollId).get()
  return snap.docs
    .map((d) => ({ ...(d.data() as PayrollItem), id: d.id }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
}

async function getRun(id: string) {
  return getDoc<PayrollRun>(HR.payroll, id)
}

export async function listPayrollRuns(session: SessionContext): Promise<PayrollRun[]> {
  requirePermission(session, 'payroll.read')
  const rows = await readAll<PayrollRun>(HR.payroll)
  return rows.sort((a, b) => b.period.localeCompare(a.period))
}

export async function getPayrollRunDetail(
  session: SessionContext,
  id: string,
): Promise<PayrollRunDetail> {
  requirePermission(session, 'payroll.read')
  const [run, items, school] = await Promise.all([getRun(id), itemsFor(id), schoolInfo()])
  if (!run) throw notFound('Payroll not found')
  return { run, items, school }
}

async function pendingDeductions(period: string, employeeId?: string) {
  const snap = await getAdminDb().collection(HR.deductions).where('period', '==', period).get()
  return snap.docs
    .map((d) => ({ ...(d.data() as PayrollDeduction), id: d.id }))
    .filter((d) => (!employeeId || d.employeeId === employeeId) && d.status !== 'APPLIED')
}

export async function generatePayroll(
  session: SessionContext,
  input: { year: number; month: number },
  requestId?: string,
): Promise<PayrollRunDetail> {
  requirePermission(session, 'payroll.manage')
  const period = periodKey(input.year, input.month)
  const existing = await getRun(period)
  if (existing && existing.status !== 'DRAFT') {
    throw conflict(
      existing.status === 'LOCKED'
        ? `Payroll for ${periodLabel(period)} is locked and can't be regenerated.`
        : `Payroll for ${periodLabel(period)} is approved. Reopen it before regenerating.`,
    )
  }

  const [employees, scales, rules, deductions, previousItems] = await Promise.all([
    readAll<HrEmployee>(HR.staff),
    readAll<SalaryScaleVersion>(HR.scales),
    getAttendanceRules(),
    pendingDeductions(period),
    existing ? itemsFor(period) : Promise.resolve([] as PayrollItem[]),
  ])
  const overrides = new Map(
    previousItems.filter((i) => i.attendance.overridden).map((i) => [i.employeeId, i.attendance]),
  )
  const linked = rules.enabled
    ? employees.filter((e) => e.linkedUid).map((e) => e.linkedUid as string)
    : []
  const attendance = await attendanceByUid(period, linked)

  const items: PayrollItem[] = []
  const skipped: PayrollSkippedEmployee[] = []
  for (const employee of employees) {
    const skip = (reason: string) =>
      skipped.push({
        employeeId: employee.id,
        employeeNumber: employee.employeeNumber,
        name: employee.fullName,
        reason,
      })
    const exclusion = payrollExclusion(employee, period)
    if (exclusion) {
      if (employee.status !== 'RESIGNED') skip(exclusion)
      continue
    }
    const scaleId = employee.salaryScaleId as string
    if (currentScaleVersion(scales, scaleId)?.status === 'INACTIVE') {
      skip(`Salary scale ${scaleId} is inactive`)
      continue
    }
    const scale = resolveScaleVersion(scales, scaleId, period)
    if (!scale) {
      skip(`Salary scale ${scaleId} is not effective until after this month`)
      continue
    }
    const counted = employee.linkedUid ? attendance.get(employee.linkedUid) : undefined
    const itemAttendance: PayrollItemAttendance = overrides.get(employee.id) ?? {
      tracked: Boolean(counted),
      absentDays: counted?.absentDays ?? 0,
      lateDays: counted?.lateDays ?? 0,
      overridden: false,
    }
    items.push(
      buildPayrollItem({
        payrollId: period,
        period,
        employee,
        scale,
        deductions: deductions.filter((d) => d.employeeId === employee.id),
        attendance: itemAttendance,
        rules,
      }),
    )
  }
  items.sort((a, b) => a.employeeName.localeCompare(b.employeeName))

  const now = nowIso()
  const run: PayrollRun = {
    id: period,
    period,
    year: input.year,
    month: input.month,
    status: 'DRAFT',
    totals: summarizeItems(items),
    skipped,
    generatedAt: now,
    generatedByName: actorName(session),
    updatedAt: now,
  }
  const db = getAdminDb()
  const keep = new Set(items.map((i) => i.id))
  await commitOps([
    ...previousItems
      .filter((i) => !keep.has(i.id))
      .map<Op>((i) => (b) => b.delete(db.collection(HR.items).doc(i.id))),
    ...items.map<Op>((i) => (b) => b.set(db.collection(HR.items).doc(i.id), i)),
    (b) => b.set(db.collection(HR.payroll).doc(period), run),
  ])
  await audit(session, existing ? 'payroll.regenerate' : 'payroll.generate', HR.payroll, period, requestId, {
    employees: items.length,
    net: run.totals.net,
  })
  return { run, items, school: await schoolInfo() }
}

async function saveTotals(run: PayrollRun, items: PayrollItem[]) {
  const next = { ...run, totals: summarizeItems(items), updatedAt: nowIso() }
  await getAdminDb().collection(HR.payroll).doc(run.id).set(next)
  return next
}

export async function updatePayrollItemAttendance(
  session: SessionContext,
  payrollId: string,
  itemId: string,
  counts: { absentDays: number; lateDays: number },
  requestId?: string,
): Promise<PayrollRunDetail> {
  requirePermission(session, 'payroll.manage')
  const run = await getRun(payrollId)
  if (!run) throw notFound('Payroll not found')
  if (run.status !== 'DRAFT') throw conflict('Only a draft payroll can be adjusted')
  const [items, rules] = await Promise.all([itemsFor(payrollId), getAttendanceRules()])
  const index = items.findIndex((i) => i.id === itemId)
  if (index < 0) throw notFound('Payroll line not found')
  const item = items[index]!
  const next = finalizeItem(
    { ...item, attendance: { ...item.attendance, ...counts, overridden: true } },
    rules,
  )
  items[index] = next
  await getAdminDb().collection(HR.items).doc(itemId).set(next)
  const saved = await saveTotals(run, items)
  await audit(session, 'payroll.item_attendance', HR.items, itemId, requestId, counts)
  return { run: saved, items, school: await schoolInfo() }
}

export async function payrollAction(
  session: SessionContext,
  id: string,
  action: 'approve' | 'reopen' | 'lock',
  requestId?: string,
): Promise<PayrollRunDetail> {
  requirePermission(session, 'payroll.approve')
  const run = await getRun(id)
  if (!run) throw notFound('Payroll not found')
  const db = getAdminDb()
  const now = nowIso()
  const who = actorName(session)

  if (action === 'approve') {
    if (run.status !== 'DRAFT') throw conflict('Only a draft payroll can be approved')
    if (run.totals.employees === 0) throw badRequest('This payroll has no employees to pay')
    const next: PayrollRun = { ...run, status: 'APPROVED', approvedAt: now, approvedByName: who, updatedAt: now }
    await db.collection(HR.payroll).doc(id).set(next)
    await audit(session, 'payroll.approve', HR.payroll, id, requestId, { net: run.totals.net })
    return getPayrollRunDetail(session, id)
  }

  if (action === 'reopen') {
    if (run.status !== 'APPROVED') throw conflict('Only an approved payroll can be reopened')
    const { approvedAt: _a, approvedByName: _b, ...rest } = run
    await db.collection(HR.payroll).doc(id).set({ ...rest, status: 'DRAFT', updatedAt: now })
    await audit(session, 'payroll.reopen', HR.payroll, id, requestId)
    return getPayrollRunDetail(session, id)
  }

  if (run.status !== 'APPROVED') throw conflict('Approve the payroll before locking it')
  const [items, school] = await Promise.all([itemsFor(id), schoolInfo()])
  const expenseId = newId('exp')
  const expense: Expense = {
    id: expenseId,
    expenseNo: await nextSequenceCode('expense', 'EXP'),
    date: periodEnd(run.period),
    category: SALARIES_CATEGORY,
    description: `Payroll — ${periodLabel(run.period)} (${items.length} employee${items.length === 1 ? '' : 's'})`,
    quantity: 1,
    unitPrice: run.totals.net,
    totalAmount: run.totals.net,
    supplier: 'Staff salaries',
    paymentMethod: 'BANK_TRANSFER',
    source: 'PAYROLL',
    payrollId: id,
    createdByName: who,
    createdAt: now,
    updatedAt: now,
  }
  const deductionIds = new Set(
    items.flatMap((i) => i.deductions.map((d) => d.deductionId).filter(Boolean) as string[]),
  )
  const ref = (collection: string, docId: string): DocumentReference =>
    db.collection(collection).doc(docId)
  await commitOps([
    ...items.map<Op>((i) => (b) => {
      const slip: Payslip = { ...i, schoolName: school.name, issuedAt: now }
      b.set(ref(HR.payslips, i.id), slip)
    }),
    ...[...deductionIds].map<Op>((dId) => (b) =>
      b.update(ref(HR.deductions, dId), { status: 'APPLIED', payrollId: id, updatedAt: now }),
    ),
    (b) => b.set(ref(HR.expenses, expenseId), expense),
    (b) =>
      b.set(ref(HR.payroll, id), {
        ...run,
        status: 'LOCKED',
        lockedAt: now,
        lockedByName: who,
        updatedAt: now,
      } satisfies PayrollRun),
  ])
  await audit(session, 'payroll.lock', HR.payroll, id, requestId, {
    net: run.totals.net,
    payslips: items.length,
    expenseId,
  })
  return getPayrollRunDetail(session, id)
}

export async function deletePayrollRun(session: SessionContext, id: string, requestId?: string) {
  requirePermission(session, 'payroll.manage')
  const run = await getRun(id)
  if (!run) throw notFound('Payroll not found')
  if (run.status !== 'DRAFT') throw conflict('Only a draft payroll can be deleted')
  const items = await itemsFor(id)
  const db = getAdminDb()
  await commitOps([
    ...items.map<Op>((i) => (b) => b.delete(db.collection(HR.items).doc(i.id))),
    (b) => b.delete(db.collection(HR.payroll).doc(id)),
  ])
  await audit(session, 'payroll.delete', HR.payroll, id, requestId)
}

export async function listPayslips(
  session: SessionContext,
  filter: { period?: string; employeeId?: string },
): Promise<Payslip[]> {
  requirePermission(session, 'payroll.read')
  let query: Query = getAdminDb().collection(HR.payslips)
  if (filter.period) query = query.where('period', '==', filter.period)
  else if (filter.employeeId) query = query.where('employeeId', '==', filter.employeeId)
  else throw badRequest('Choose a month or an employee')
  const snap = await query.limit(1000).get()
  return snap.docs
    .map((d) => ({ ...(d.data() as Payslip), id: d.id }))
    .filter((p) => !filter.employeeId || p.employeeId === filter.employeeId)
    .sort((a, b) => b.period.localeCompare(a.period) || a.employeeName.localeCompare(b.employeeName))
}

/* ---------- Deductions ---------- */

async function assertPeriodOpen(period: string) {
  const run = await getRun(period)
  if (run?.status === 'LOCKED') {
    throw conflict(`Payroll for ${periodLabel(period)} is locked; its deductions can't change.`)
  }
  if (run?.status === 'APPROVED') {
    throw conflict(`Payroll for ${periodLabel(period)} is approved. Reopen it before changing deductions.`)
  }
}

/** Keeps an open draft payroll in step when a deduction is added, edited or removed. */
async function refreshDraftItem(period: string, employeeId: string) {
  const run = await getRun(period)
  if (!run || run.status !== 'DRAFT') return
  const itemId = `${period}_${employeeId}`
  const [items, rules, deductions] = await Promise.all([
    itemsFor(period),
    getAttendanceRules(),
    pendingDeductions(period, employeeId),
  ])
  const index = items.findIndex((i) => i.id === itemId)
  if (index < 0) return
  const next = finalizeItem(items[index]!, rules, deductions)
  items[index] = next
  await getAdminDb().collection(HR.items).doc(itemId).set(next)
  await saveTotals(run, items)
}

export async function listDeductions(
  session: SessionContext,
  period?: string,
): Promise<PayrollDeduction[]> {
  requirePermission(session, 'payroll.read')
  const col = getAdminDb().collection(HR.deductions)
  const snap = period
    ? await col.where('period', '==', period).get()
    : await col.orderBy('date', 'desc').limit(500).get()
  return snap.docs
    .map((d) => ({ ...(d.data() as PayrollDeduction), id: d.id }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
}

async function employeeOrThrow(id: string) {
  const employee = await getDoc<HrEmployee>(HR.staff, id)
  if (!employee) throw badRequest('Employee not found')
  return employee
}

export async function createDeduction(
  session: SessionContext,
  body: DeductionBody,
  requestId?: string,
): Promise<PayrollDeduction> {
  requirePermission(session, 'payroll.manage')
  const period = periodOf(body.date)
  const [employee] = await Promise.all([employeeOrThrow(body.employeeId), assertPeriodOpen(period)])
  const id = newId('ded')
  const now = nowIso()
  const row: PayrollDeduction = clean({
    id,
    deductionNo: await nextSequenceCode('deduction', 'DED'),
    employeeId: employee.id,
    employeeName: employee.fullName,
    employeeNumber: employee.employeeNumber,
    reason: body.reason,
    percentage: body.percentage || null,
    fixedAmount: body.fixedAmount || null,
    date: body.date,
    period,
    notes: body.notes?.trim() || undefined,
    addedBy: session.uid,
    addedByName: actorName(session),
    status: 'PENDING',
    createdAt: now,
    updatedAt: now,
  })
  await getAdminDb().collection(HR.deductions).doc(id).set(row)
  await refreshDraftItem(period, employee.id)
  await audit(session, 'payroll.deduction_create', HR.deductions, id, requestId, {
    employeeId: employee.id,
    percentage: row.percentage,
    fixedAmount: row.fixedAmount,
  })
  return row
}

export async function updateDeduction(
  session: SessionContext,
  id: string,
  body: DeductionUpdateBody,
  requestId?: string,
): Promise<PayrollDeduction> {
  requirePermission(session, 'payroll.manage')
  const current = await getDoc<PayrollDeduction>(HR.deductions, id)
  if (!current) throw notFound('Deduction not found')
  if (current.status === 'APPLIED') throw conflict('This deduction was paid out on a locked payroll')
  const period = body.date ? periodOf(body.date) : current.period
  await assertPeriodOpen(current.period)
  if (period !== current.period) await assertPeriodOpen(period)
  const employee =
    body.employeeId && body.employeeId !== current.employeeId
      ? await employeeOrThrow(body.employeeId)
      : null
  const next: PayrollDeduction = clean({
    ...current,
    ...(employee
      ? { employeeId: employee.id, employeeName: employee.fullName, employeeNumber: employee.employeeNumber }
      : {}),
    reason: body.reason ?? current.reason,
    percentage: body.percentage !== undefined ? body.percentage || null : current.percentage,
    fixedAmount: body.fixedAmount !== undefined ? body.fixedAmount || null : current.fixedAmount,
    date: body.date ?? current.date,
    period,
    notes: body.notes !== undefined ? body.notes.trim() || undefined : current.notes,
    updatedAt: nowIso(),
  })
  if (!next.percentage && !next.fixedAmount) throw badRequest('Enter a percentage or a fixed amount')
  await getAdminDb().collection(HR.deductions).doc(id).set(next)
  await refreshDraftItem(current.period, current.employeeId)
  if (period !== current.period || next.employeeId !== current.employeeId) {
    await refreshDraftItem(period, next.employeeId)
  }
  await audit(session, 'payroll.deduction_update', HR.deductions, id, requestId, {
    percentage: next.percentage,
    fixedAmount: next.fixedAmount,
  })
  return next
}

export async function deleteDeduction(session: SessionContext, id: string, requestId?: string) {
  requirePermission(session, 'payroll.manage')
  const current = await getDoc<PayrollDeduction>(HR.deductions, id)
  if (!current) throw notFound('Deduction not found')
  if (current.status === 'APPLIED') throw conflict('This deduction was paid out on a locked payroll')
  await assertPeriodOpen(current.period)
  await getAdminDb().collection(HR.deductions).doc(id).delete()
  await refreshDraftItem(current.period, current.employeeId)
  await audit(session, 'payroll.deduction_delete', HR.deductions, id, requestId)
}
