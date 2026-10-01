import { mockRequest } from '@/services/api/client'
import {
  DEFAULT_ATTENDANCE_RULES,
  DEFAULT_EXPENSE_CATEGORIES,
  SALARIES_CATEGORY,
} from '@/lib/hr/constants'
import { buildFinanceSummary, type FeePaymentLite } from '@/lib/hr/finance-summary'
import {
  buildPayrollItem,
  currentScaleVersion,
  finalizeItem,
  grossOf,
  nextCode,
  payrollExclusion,
  periodEnd,
  periodKey,
  periodLabel,
  periodOf,
  resolveScaleVersion,
  round2,
  summarizeItems,
} from '@/lib/hr/payroll-engine'
import type {
  AttendanceDeductionSettings,
  Expense,
  ExpenseCategory,
  ExpenseInput,
  HrEmployee,
  HrEmployeeInput,
  PayrollDeduction,
  PayrollItem,
  PayrollRun,
  PayrollRunDetail,
  PayrollSkippedEmployee,
  Payslip,
  Revenue,
  RevenueInput,
  SalaryScaleInput,
  SalaryScaleVersion,
} from '@/types'
import type { FinanceService, HrService } from '@/services/hr'

/** Demo mode: an in-memory school so the HR, payroll and finance pages can be explored offline. */

const SCHOOL = { name: 'Viste High School (demo)', motto: 'Excellence in all', address: 'Harare' }
const ACTOR = 'Demo administrator'

const now = () => new Date().toISOString()
const today = () => now().slice(0, 10)
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
let seq = 0
const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`

function fail(message: string): never {
  throw new Error(message)
}

function monthsAgo(n: number) {
  const d = new Date()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - n)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 }
}

function seedScale(
  scaleId: string,
  category: SalaryScaleVersion['category'],
  position: string,
  grade: string,
  basic: number,
  housing: number,
  transport: number,
  other = 0,
  effectiveDate = '2025-01-01',
  version = 1,
  current = true,
): SalaryScaleVersion {
  const parts = {
    basicSalary: basic,
    housingAllowance: housing,
    transportAllowance: transport,
    otherAllowances: other,
  }
  return {
    id: `${scaleId}-v${version}`,
    scaleId,
    version,
    category,
    position,
    grade,
    ...parts,
    grossSalary: grossOf(parts),
    effectiveDate,
    status: 'ACTIVE',
    current,
    createdAt: `${effectiveDate}T08:00:00.000Z`,
    createdByName: ACTOR,
  }
}

function seedEmployee(
  n: number,
  fullName: string,
  gender: HrEmployee['gender'],
  position: string,
  department: string,
  category: HrEmployee['category'],
  salaryScaleId: string | undefined,
  extra: Partial<HrEmployee> = {},
): HrEmployee {
  const code = `EMP-${String(n).padStart(4, '0')}`
  return {
    id: `emp-${n}`,
    employeeNumber: code,
    fullName,
    nationalId: `63-${String(100000 + n * 7919).slice(0, 6)}-X-${String(10 + n)}`,
    gender,
    dateOfBirth: `19${80 + (n % 15)}-0${(n % 9) + 1}-1${n % 9}`,
    phone: `+263 77 ${String(2000000 + n * 13117).slice(0, 7)}`,
    email: `${fullName.split(' ')[0]!.toLowerCase()}@viste.school`,
    address: `${10 + n} Samora Machel Ave, Harare`,
    emergencyContact: { name: 'Next of kin', relationship: 'Spouse', phone: '+263 71 555 0100' },
    position,
    department,
    category,
    dateEmployed: `20${18 + (n % 6)}-01-10`,
    employmentType: 'PERMANENT',
    status: 'ACTIVE',
    ...(salaryScaleId ? { salaryScaleId } : {}),
    bank: { bankName: 'CBZ Bank', accountNumber: `0112${String(3000000 + n * 271)}`, branch: 'Kwame Nkrumah' },
    createdAt: '2025-01-15T08:00:00.000Z',
    updatedAt: '2025-01-15T08:00:00.000Z',
    createdByName: ACTOR,
    ...extra,
  }
}

const db = {
  scales: [
    seedScale('SS-0001', 'TEACHER', 'Teacher', 'A', 780, 50, 30, 0, '2025-01-01', 1, false),
    seedScale('SS-0001', 'TEACHER', 'Teacher', 'A', 800, 50, 30, 0, '2026-01-01', 2, true),
    seedScale('SS-0002', 'TEACHER', 'Senior Teacher', 'B', 950, 70, 40, 25),
    seedScale('SS-0003', 'ADMINISTRATIVE', 'Bursar', 'B', 900, 60, 40),
    seedScale('SS-0004', 'ANCILLARY', 'Lab Assistant', 'C', 450, 30, 20),
    seedScale('SS-0005', 'GENERAL_WORKER', 'Groundsman', 'D', 300, 20, 15),
  ] as SalaryScaleVersion[],
  employees: [
    seedEmployee(1, 'Tendai Moyo', 'FEMALE', 'Teacher', 'Sciences', 'TEACHER', 'SS-0001'),
    seedEmployee(2, 'Farai Chikore', 'MALE', 'Senior Teacher', 'Mathematics', 'TEACHER', 'SS-0002'),
    seedEmployee(3, 'Rudo Ncube', 'FEMALE', 'Teacher', 'Languages', 'TEACHER', 'SS-0001'),
    seedEmployee(4, 'Tatenda Dube', 'MALE', 'Bursar', 'Accounts', 'ADMINISTRATIVE', 'SS-0003'),
    seedEmployee(5, 'Chipo Mutasa', 'FEMALE', 'Lab Assistant', 'Sciences', 'ANCILLARY', 'SS-0004', {
      employmentType: 'CONTRACT',
    }),
    seedEmployee(6, 'Blessing Sithole', 'MALE', 'Groundsman', 'Estates', 'GENERAL_WORKER', 'SS-0005'),
    seedEmployee(7, 'Nyasha Gumbo', 'FEMALE', 'Teacher', 'Humanities', 'TEACHER', 'SS-0001', {
      status: 'ON_LEAVE',
    }),
    seedEmployee(8, 'Kudzai Marufu', 'MALE', 'Security Guard', 'Estates', 'GENERAL_WORKER', undefined, {
      employmentType: 'TEMPORARY',
    }),
  ] as HrEmployee[],
  deductions: [] as PayrollDeduction[],
  runs: [] as PayrollRun[],
  items: [] as PayrollItem[],
  payslips: [] as Payslip[],
  rules: { ...DEFAULT_ATTENDANCE_RULES } as AttendanceDeductionSettings,
  expenses: [] as Expense[],
  categories: [] as ExpenseCategory[],
  revenues: [] as Revenue[],
  feePayments: [] as FeePaymentLite[],
  outstandingFees: 18_450,
}

function addExpense(input: ExpenseInput, extra: Partial<Expense> = {}): Expense {
  const stamp = now()
  const row: Expense = {
    id: uid('exp'),
    expenseNo: nextCode('EXP', db.expenses.map((e) => e.expenseNo)),
    date: input.date,
    category: input.category,
    description: input.description,
    quantity: input.quantity,
    unitPrice: round2(input.unitPrice),
    totalAmount: round2(input.quantity * input.unitPrice),
    supplier: input.supplier ?? '',
    paymentMethod: input.paymentMethod,
    ...(input.notes ? { notes: input.notes } : {}),
    source: 'MANUAL',
    createdByName: ACTOR,
    createdAt: stamp,
    updatedAt: stamp,
    ...extra,
  }
  db.expenses.unshift(row)
  return row
}

function addRevenue(input: RevenueInput): Revenue {
  const stamp = now()
  const row: Revenue = {
    id: uid('rev'),
    revenueNo: nextCode('REV', db.revenues.map((r) => r.revenueNo)),
    date: input.date,
    source: input.source,
    description: input.description,
    amount: round2(input.amount),
    ...(input.reference ? { reference: input.reference } : {}),
    createdByName: ACTOR,
    createdAt: stamp,
    updatedAt: stamp,
  }
  db.revenues.unshift(row)
  return row
}

function runFor(period: string) {
  return db.runs.find((r) => r.id === period) ?? null
}

function detail(period: string): PayrollRunDetail {
  const run = runFor(period) ?? fail('Payroll not found')
  return clone({
    run,
    items: db.items
      .filter((i) => i.payrollId === period)
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
    school: SCHOOL,
  })
}

function saveTotals(period: string) {
  const run = runFor(period)
  if (!run) return
  run.totals = summarizeItems(db.items.filter((i) => i.payrollId === period))
  run.updatedAt = now()
}

function generate(year: number, month: number): PayrollRunDetail {
  const period = periodKey(year, month)
  const existing = runFor(period)
  if (existing && existing.status !== 'DRAFT') {
    fail(
      existing.status === 'LOCKED'
        ? `Payroll for ${periodLabel(period)} is locked and can't be regenerated.`
        : `Payroll for ${periodLabel(period)} is approved. Reopen it before regenerating.`,
    )
  }
  const previous = db.items.filter((i) => i.payrollId === period)
  const overrides = new Map(
    previous.filter((i) => i.attendance.overridden).map((i) => [i.employeeId, i.attendance]),
  )
  const items: PayrollItem[] = []
  const skipped: PayrollSkippedEmployee[] = []
  for (const employee of db.employees) {
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
    if (currentScaleVersion(db.scales, scaleId)?.status === 'INACTIVE') {
      skip(`Salary scale ${scaleId} is inactive`)
      continue
    }
    const scale = resolveScaleVersion(db.scales, scaleId, period)
    if (!scale) {
      skip(`Salary scale ${scaleId} is not effective until after this month`)
      continue
    }
    items.push(
      buildPayrollItem({
        payrollId: period,
        period,
        employee,
        scale,
        deductions: db.deductions.filter(
          (d) => d.employeeId === employee.id && d.period === period && d.status === 'PENDING',
        ),
        attendance: overrides.get(employee.id) ?? {
          tracked: false,
          absentDays: 0,
          lateDays: 0,
          overridden: false,
        },
        rules: db.rules,
      }),
    )
  }
  db.items = [...db.items.filter((i) => i.payrollId !== period), ...items]
  const stamp = now()
  const run: PayrollRun = {
    id: period,
    period,
    year,
    month,
    status: 'DRAFT',
    totals: summarizeItems(items),
    skipped,
    generatedAt: stamp,
    generatedByName: ACTOR,
    updatedAt: stamp,
  }
  db.runs = [run, ...db.runs.filter((r) => r.id !== period)].sort((a, b) =>
    b.period.localeCompare(a.period),
  )
  return detail(period)
}

function lock(period: string) {
  const run = runFor(period) ?? fail('Payroll not found')
  if (run.status !== 'APPROVED') fail('Approve the payroll before locking it')
  const items = db.items.filter((i) => i.payrollId === period)
  const stamp = now()
  db.payslips = [
    ...db.payslips.filter((p) => p.payrollId !== period),
    ...items.map((i) => ({ ...clone(i), schoolName: SCHOOL.name, issuedAt: stamp })),
  ]
  const applied = new Set(items.flatMap((i) => i.deductions.map((d) => d.deductionId)))
  for (const d of db.deductions) {
    if (applied.has(d.id)) Object.assign(d, { status: 'APPLIED', payrollId: period, updatedAt: stamp })
  }
  addExpense(
    {
      date: periodEnd(period),
      category: SALARIES_CATEGORY,
      description: `Payroll — ${periodLabel(period)} (${items.length} employee${items.length === 1 ? '' : 's'})`,
      quantity: 1,
      unitPrice: run.totals.net,
      supplier: 'Staff salaries',
      paymentMethod: 'BANK_TRANSFER',
    },
    { source: 'PAYROLL', payrollId: period },
  )
  Object.assign(run, { status: 'LOCKED', lockedAt: stamp, lockedByName: ACTOR, updatedAt: stamp })
}

function refreshDraft(period: string, employeeId: string) {
  const run = runFor(period)
  if (!run || run.status !== 'DRAFT') return
  const index = db.items.findIndex((i) => i.payrollId === period && i.employeeId === employeeId)
  if (index < 0) return
  db.items[index] = finalizeItem(
    db.items[index]!,
    db.rules,
    db.deductions.filter(
      (d) => d.employeeId === employeeId && d.period === period && d.status === 'PENDING',
    ),
  )
  saveTotals(period)
}

function assertPeriodOpen(period: string) {
  const run = runFor(period)
  if (run && run.status !== 'DRAFT') {
    fail(`Payroll for ${periodLabel(period)} is ${run.status.toLowerCase()}. Choose a date in an open month.`)
  }
}

function employeeOrFail(id: string) {
  return db.employees.find((e) => e.id === id) ?? fail('Employee not found')
}

/* ---------- seed history ---------- */

;(function seed() {
  const year = new Date().getUTCFullYear()
  const pays = [4200, 5100, 3900, 6100, 4800, 5600, 4400, 5200, 6000, 4700, 5300, 5900]
  const currentMonth = new Date().getUTCMonth() + 1
  for (let m = 1; m <= currentMonth; m += 1) {
    const period = periodKey(year, m)
    db.feePayments.push({ amount: pays[m - 1]!, paidAt: `${period}-12`, status: 'CONFIRMED' })
    addExpense({
      date: `${period}-05`,
      category: 'Electricity',
      description: 'ZESA prepaid tokens',
      quantity: 1,
      unitPrice: 180 + (m % 4) * 15,
      supplier: 'ZESA',
      paymentMethod: 'MOBILE_MONEY',
    })
    addExpense({
      date: `${period}-09`,
      category: 'Stationery',
      description: 'Exercise books (box)',
      quantity: 4 + (m % 3),
      unitPrice: 32.5,
      supplier: 'Kingstons',
      paymentMethod: 'CASH',
    })
    if (m % 3 === 0) {
      addRevenue({
        date: `${period}-20`,
        source: m % 2 ? 'DONATION' : 'PROJECT_INCOME',
        description: m % 2 ? 'Alumni association donation' : 'Tuck-shop project income',
        amount: 650 + m * 40,
      })
    }
  }
  addExpense({
    date: today(),
    category: 'Fuel',
    description: 'Diesel for school bus',
    quantity: 60,
    unitPrice: 1.62,
    supplier: 'Zuva Petroleum',
    paymentMethod: 'CARD',
  })

  for (const back of [3, 2, 1]) {
    const { year: y, month: m } = monthsAgo(back)
    generate(y, m)
    const run = runFor(periodKey(y, m))!
    Object.assign(run, { status: 'APPROVED', approvedAt: now(), approvedByName: ACTOR })
    lock(run.id)
  }

  const period = periodOf(today())
  const tendai = db.employees[0]!
  db.deductions.push({
    id: 'ded-1',
    deductionNo: 'DED-0001',
    employeeId: tendai.id,
    employeeName: tendai.fullName,
    employeeNumber: tendai.employeeNumber,
    reason: 'UNAUTHORIZED_ABSENCE',
    percentage: 5,
    fixedAmount: null,
    date: today(),
    period,
    notes: 'Absent without notice',
    addedBy: 'demo-user',
    addedByName: ACTOR,
    status: 'PENDING',
    createdAt: now(),
    updatedAt: now(),
  })
})()

/* ---------- services ---------- */

function scaleVersion(
  input: SalaryScaleInput,
  scaleId: string,
  version: number,
): SalaryScaleVersion {
  return {
    id: uid('ssv'),
    scaleId,
    version,
    category: input.category,
    position: input.position,
    grade: input.grade,
    basicSalary: round2(input.basicSalary),
    housingAllowance: round2(input.housingAllowance),
    transportAllowance: round2(input.transportAllowance),
    otherAllowances: round2(input.otherAllowances),
    grossSalary: grossOf(input),
    effectiveDate: input.effectiveDate,
    status: 'ACTIVE',
    current: true,
    ...(input.notes ? { notes: input.notes } : {}),
    createdAt: now(),
    createdByName: ACTOR,
  }
}

function checkEmployeeInput(input: HrEmployeeInput, id?: string) {
  if (db.employees.some((e) => e.id !== id && e.nationalId.toLowerCase() === input.nationalId.trim().toLowerCase())) {
    fail('Another employee already has this national ID')
  }
  if (input.salaryScaleId) {
    const current = currentScaleVersion(db.scales, input.salaryScaleId)
    if (!current) fail('Salary scale not found')
    if (current.status !== 'ACTIVE') fail('That salary scale is inactive')
  }
}

function sortScales(list: SalaryScaleVersion[]) {
  return [...list].sort((a, b) => a.scaleId.localeCompare(b.scaleId) || b.version - a.version)
}

export const mockHrService: HrService = {
  getSchool: async () => mockRequest({ ...SCHOOL }, 50),
  listStaff: async () =>
    mockRequest(
      clone({
        employees: [...db.employees].sort((a, b) => a.fullName.localeCompare(b.fullName)),
        accounts: [{ uid: 'demo-user', name: 'Demo teacher', role: 'TEACHER' }],
      }),
    ),
  createStaff: async (input) => {
    checkEmployeeInput(input)
    const stamp = now()
    const row: HrEmployee = {
      ...clone(input),
      id: uid('emp'),
      employeeNumber: nextCode('EMP', db.employees.map((e) => e.employeeNumber)),
      ...(input.linkedUid ? { linkedName: 'Demo teacher' } : {}),
      createdAt: stamp,
      updatedAt: stamp,
      createdByName: ACTOR,
    }
    if (!row.salaryScaleId) delete row.salaryScaleId
    if (!row.linkedUid) delete row.linkedUid
    db.employees.push(row)
    return mockRequest(clone(row))
  },
  updateStaff: async (id, input) => {
    const current = employeeOrFail(id)
    checkEmployeeInput(input, id)
    const next: HrEmployee = {
      ...current,
      ...clone(input),
      ...(input.linkedUid ? { linkedName: 'Demo teacher' } : {}),
      updatedAt: now(),
    }
    if (!input.salaryScaleId) delete next.salaryScaleId
    if (!input.linkedUid) {
      delete next.linkedUid
      delete next.linkedName
    }
    db.employees = db.employees.map((e) => (e.id === id ? next : e))
    return mockRequest(clone(next))
  },
  deleteStaff: async (id) => {
    employeeOrFail(id)
    if (db.items.some((i) => i.employeeId === id)) {
      fail('This employee has payroll history. Mark the employee as Resigned instead of deleting.')
    }
    db.employees = db.employees.filter((e) => e.id !== id)
    await mockRequest(null)
  },

  listScales: async () => mockRequest(clone(sortScales(db.scales))),
  createScale: async (input) => {
    const scaleId = nextCode('SS', db.scales.map((s) => s.scaleId))
    const row = scaleVersion(input, scaleId, 1)
    db.scales.push(row)
    return mockRequest(clone(row))
  },
  reviseScale: async (scaleId, input) => {
    const current = currentScaleVersion(db.scales, scaleId) ?? fail('Salary scale not found')
    if (input.effectiveDate < current.effectiveDate) {
      fail(`The new version must take effect on or after ${current.effectiveDate}`)
    }
    for (const v of db.scales) if (v.scaleId === scaleId) v.current = false
    db.scales.push({ ...scaleVersion(input, scaleId, current.version + 1), status: current.status })
    return mockRequest(clone(sortScales(db.scales.filter((v) => v.scaleId === scaleId))))
  },
  setScaleStatus: async (scaleId, status) => {
    const versions = db.scales.filter((v) => v.scaleId === scaleId)
    if (!versions.length) fail('Salary scale not found')
    for (const v of versions) v.status = status
    return mockRequest(clone(sortScales(versions)))
  },

  listPayrolls: async () => mockRequest(clone(db.runs)),
  getPayroll: async (id) => mockRequest(detail(id)),
  generatePayroll: async (year, month) => mockRequest(generate(year, month), 700),
  payrollAction: async (id, action) => {
    const run = runFor(id) ?? fail('Payroll not found')
    const stamp = now()
    if (action === 'approve') {
      if (run.status !== 'DRAFT') fail('Only a draft payroll can be approved')
      if (run.totals.employees === 0) fail('This payroll has no employees to pay')
      Object.assign(run, { status: 'APPROVED', approvedAt: stamp, approvedByName: ACTOR, updatedAt: stamp })
    } else if (action === 'reopen') {
      if (run.status !== 'APPROVED') fail('Only an approved payroll can be reopened')
      delete run.approvedAt
      delete run.approvedByName
      Object.assign(run, { status: 'DRAFT', updatedAt: stamp })
    } else {
      lock(id)
    }
    return mockRequest(detail(id))
  },
  deletePayroll: async (id) => {
    const run = runFor(id) ?? fail('Payroll not found')
    if (run.status !== 'DRAFT') fail('Only a draft payroll can be deleted')
    db.runs = db.runs.filter((r) => r.id !== id)
    db.items = db.items.filter((i) => i.payrollId !== id)
    await mockRequest(null)
  },
  updatePayrollItem: async (id, itemId, counts) => {
    const run = runFor(id) ?? fail('Payroll not found')
    if (run.status !== 'DRAFT') fail('Only a draft payroll can be adjusted')
    const index = db.items.findIndex((i) => i.id === itemId)
    if (index < 0) fail('Payroll line not found')
    const item = db.items[index]!
    db.items[index] = finalizeItem(
      { ...item, attendance: { ...item.attendance, ...counts, overridden: true } },
      db.rules,
    )
    saveTotals(id)
    return mockRequest(detail(id))
  },
  listPayslips: async (filter) =>
    mockRequest(
      clone(
        db.payslips
          .filter((p) => (!filter.period || p.period === filter.period) && (!filter.employeeId || p.employeeId === filter.employeeId))
          .sort((a, b) => b.period.localeCompare(a.period) || a.employeeName.localeCompare(b.employeeName)),
      ),
    ),

  listDeductions: async (period) =>
    mockRequest(
      clone(
        db.deductions
          .filter((d) => !period || d.period === period)
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      ),
    ),
  createDeduction: async (input) => {
    const employee = employeeOrFail(input.employeeId)
    const period = periodOf(input.date)
    assertPeriodOpen(period)
    const stamp = now()
    const row: PayrollDeduction = {
      id: uid('ded'),
      deductionNo: nextCode('DED', db.deductions.map((d) => d.deductionNo)),
      employeeId: employee.id,
      employeeName: employee.fullName,
      employeeNumber: employee.employeeNumber,
      reason: input.reason,
      percentage: input.percentage || null,
      fixedAmount: input.fixedAmount || null,
      date: input.date,
      period,
      ...(input.notes ? { notes: input.notes } : {}),
      addedBy: 'demo-user',
      addedByName: ACTOR,
      status: 'PENDING',
      createdAt: stamp,
      updatedAt: stamp,
    }
    db.deductions.unshift(row)
    refreshDraft(period, employee.id)
    return mockRequest(clone(row))
  },
  updateDeduction: async (id, input) => {
    const current = db.deductions.find((d) => d.id === id) ?? fail('Deduction not found')
    if (current.status === 'APPLIED') fail('This deduction was applied to a locked payroll')
    assertPeriodOpen(current.period)
    const employee = employeeOrFail(input.employeeId ?? current.employeeId)
    const date = input.date ?? current.date
    const period = periodOf(date)
    assertPeriodOpen(period)
    const next: PayrollDeduction = {
      ...current,
      employeeId: employee.id,
      employeeName: employee.fullName,
      employeeNumber: employee.employeeNumber,
      reason: input.reason ?? current.reason,
      percentage: input.percentage !== undefined ? input.percentage || null : current.percentage,
      fixedAmount: input.fixedAmount !== undefined ? input.fixedAmount || null : current.fixedAmount,
      date,
      period,
      updatedAt: now(),
    }
    if (input.notes !== undefined) {
      if (input.notes) next.notes = input.notes
      else delete next.notes
    }
    db.deductions = db.deductions.map((d) => (d.id === id ? next : d))
    refreshDraft(current.period, current.employeeId)
    refreshDraft(period, employee.id)
    return mockRequest(clone(next))
  },
  deleteDeduction: async (id) => {
    const current = db.deductions.find((d) => d.id === id) ?? fail('Deduction not found')
    if (current.status === 'APPLIED') fail('This deduction was applied to a locked payroll')
    assertPeriodOpen(current.period)
    db.deductions = db.deductions.filter((d) => d.id !== id)
    refreshDraft(current.period, current.employeeId)
    await mockRequest(null)
  },
  getAttendanceRules: async () => mockRequest(clone(db.rules)),
  updateAttendanceRules: async (input) => {
    db.rules = { ...input, updatedAt: now(), updatedByName: ACTOR }
    return mockRequest(clone(db.rules))
  },
}

function manualExpenseOrFail(id: string) {
  const row = db.expenses.find((e) => e.id === id) ?? fail('Expense not found')
  if (row.source === 'PAYROLL') {
    fail('Payroll expenses are posted automatically when a payroll is locked and can’t be changed here.')
  }
  return row
}

const inRange = (date: string, range: { from: string; to: string }) =>
  date >= range.from && date <= range.to

export const mockFinanceService: FinanceService = {
  listExpenses: async (range) =>
    mockRequest(
      clone(
        db.expenses
          .filter((e) => inRange(e.date, range))
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      ),
    ),
  createExpense: async (input) => mockRequest(clone(addExpense(input))),
  updateExpense: async (id, input) => {
    const current = manualExpenseOrFail(id)
    const next: Expense = {
      ...current,
      ...input,
      supplier: input.supplier ?? '',
      unitPrice: round2(input.unitPrice),
      totalAmount: round2(input.quantity * input.unitPrice),
      updatedAt: now(),
    }
    if (!input.notes) delete next.notes
    db.expenses = db.expenses.map((e) => (e.id === id ? next : e))
    return mockRequest(clone(next))
  },
  deleteExpense: async (id) => {
    manualExpenseOrFail(id)
    db.expenses = db.expenses.filter((e) => e.id !== id)
    await mockRequest(null)
  },
  listExpenseCategories: async () =>
    mockRequest([
      ...DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
        id: `builtin-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        name,
        builtIn: true,
      })),
      ...clone(db.categories),
    ]),
  createExpenseCategory: async (name) => {
    const trimmed = name.trim().replace(/\s+/g, ' ')
    const taken = [...DEFAULT_EXPENSE_CATEGORIES, ...db.categories.map((c) => c.name)]
    if (taken.some((c) => c.toLowerCase() === trimmed.toLowerCase())) fail(`“${trimmed}” already exists`)
    const row = { id: uid('xcat'), name: trimmed, builtIn: false }
    db.categories.push(row)
    return mockRequest(clone(row))
  },
  deleteExpenseCategory: async (id) => {
    if (id.startsWith('builtin-')) fail('Built-in categories can’t be removed')
    db.categories = db.categories.filter((c) => c.id !== id)
    await mockRequest(null)
  },
  listRevenues: async (range) =>
    mockRequest(
      clone(
        db.revenues
          .filter((r) => inRange(r.date, range))
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
      ),
    ),
  createRevenue: async (input) => mockRequest(clone(addRevenue(input))),
  updateRevenue: async (id, input) => {
    const current = db.revenues.find((r) => r.id === id) ?? fail('Revenue entry not found')
    const next: Revenue = { ...current, ...input, amount: round2(input.amount), updatedAt: now() }
    if (!input.reference) delete next.reference
    db.revenues = db.revenues.map((r) => (r.id === id ? next : r))
    return mockRequest(clone(next))
  },
  deleteRevenue: async (id) => {
    db.revenues = db.revenues.filter((r) => r.id !== id)
    await mockRequest(null)
  },
  getSummary: async (year) =>
    mockRequest(
      buildFinanceSummary({
        year,
        feePayments: db.feePayments.filter((p) => p.paidAt.startsWith(String(year))),
        revenues: db.revenues.filter((r) => r.date.startsWith(String(year))),
        expenses: db.expenses.filter((e) => e.date.startsWith(String(year))),
        outstandingFees: db.outstandingFees,
      }),
    ),
}