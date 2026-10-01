import { DEDUCTION_REASON_LABEL } from '@/lib/hr/constants'
import type {
  AttendanceDeductionRule,
  AttendanceDeductionSettings,
  HrEmployee,
  PayrollDeduction,
  PayrollDeductionLine,
  PayrollItem,
  PayrollItemAttendance,
  PayrollTotals,
  SalaryScaleInput,
  SalaryScaleVersion,
} from '@/types'

export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

type SalaryParts = Pick<
  SalaryScaleInput,
  'basicSalary' | 'housingAllowance' | 'transportAllowance' | 'otherAllowances'
>

export function allowancesOf(parts: SalaryParts) {
  return round2(
    (parts.housingAllowance || 0) + (parts.transportAllowance || 0) + (parts.otherAllowances || 0),
  )
}

/** Basic salary + housing + transport + other allowances. */
export function grossOf(parts: SalaryParts) {
  return round2((parts.basicSalary || 0) + allowancesOf(parts))
}

export function periodOf(date: string) {
  return date.slice(0, 7)
}

export function periodKey(year: number, month: number) {
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Last calendar day of a YYYY-MM period. */
export function periodEnd(period: string) {
  const [year, month] = period.split('-').map(Number)
  const last = new Date(Date.UTC(year!, month!, 0)).getUTCDate()
  return `${period}-${String(last).padStart(2, '0')}`
}

export function periodLabel(period: string) {
  const [year, month] = period.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, 1)).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** The version of a scale in force at the end of the payroll month (history is never rewritten). */
export function resolveScaleVersion(
  versions: SalaryScaleVersion[],
  scaleId: string,
  period: string,
): SalaryScaleVersion | null {
  const end = periodEnd(period)
  return (
    versions
      .filter((v) => v.scaleId === scaleId && v.effectiveDate <= end)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.version - a.version)[0] ??
    null
  )
}

export function currentScaleVersion(versions: SalaryScaleVersion[], scaleId: string) {
  return (
    versions
      .filter((v) => v.scaleId === scaleId)
      .sort((a, b) => b.version - a.version)[0] ?? null
  )
}

/** Gross (or basic) × percentage + fixed amount. */
export function deductionAmount(
  input: { percentage?: number | null; fixedAmount?: number | null },
  base: number,
) {
  const pct = input.percentage ? (base * input.percentage) / 100 : 0
  return round2(pct + (input.fixedAmount || 0))
}

function ruleAmount(rule: AttendanceDeductionRule, base: number) {
  return rule.mode === 'PERCENT' ? (base * rule.value) / 100 : rule.value
}

function attendanceLines(
  attendance: PayrollItemAttendance,
  rules: AttendanceDeductionSettings,
  base: number,
): PayrollDeductionLine[] {
  if (!rules.enabled || (!attendance.tracked && !attendance.overridden)) return []
  const lines: PayrollDeductionLine[] = []
  const add = (
    count: number,
    rule: AttendanceDeductionRule,
    reason: PayrollDeductionLine['reason'],
    what: string,
  ) => {
    if (count <= 0 || rule.value <= 0) return
    const unit = ruleAmount(rule, base)
    lines.push({
      source: 'ATTENDANCE',
      reason,
      label: `${what} × ${count}`,
      percentage: rule.mode === 'PERCENT' ? round2(rule.value * count) : null,
      fixedAmount: rule.mode === 'FIXED' ? round2(rule.value * count) : null,
      count,
      amount: round2(unit * count),
    })
  }
  add(attendance.absentDays, rules.absentDay, 'UNAUTHORIZED_ABSENCE', 'Absent day')
  add(attendance.lateDays, rules.lateComing, 'LATE_COMING', 'Late coming')
  return lines
}

function manualLine(d: PayrollDeduction, base: number): PayrollDeductionLine {
  return {
    source: 'MANUAL',
    deductionId: d.id,
    reason: d.reason,
    label: DEDUCTION_REASON_LABEL[d.reason],
    percentage: d.percentage,
    fixedAmount: d.fixedAmount,
    amount: deductionAmount(d, base),
    ...(d.notes ? { notes: d.notes } : {}),
  }
}

export function percentBaseOf(
  item: Pick<PayrollItem, 'basicSalary' | 'grossSalary'>,
  rules: AttendanceDeductionSettings,
) {
  return rules.percentBase === 'BASIC' ? item.basicSalary : item.grossSalary
}

/** Recalculates deductions and net pay; manual lines are re-priced, attendance lines rebuilt. */
export function finalizeItem(
  item: Omit<PayrollItem, 'deductions' | 'deductionsTotal' | 'netSalary'> & {
    deductions?: PayrollDeductionLine[]
  },
  rules: AttendanceDeductionSettings,
  manual?: PayrollDeduction[],
): PayrollItem {
  const base = percentBaseOf(item, rules)
  const manualLines = manual
    ? manual.map((d) => manualLine(d, base))
    : (item.deductions ?? [])
        .filter((l) => l.source === 'MANUAL')
        .map((l) => ({ ...l, amount: deductionAmount(l, base) }))
  const deductions = [...manualLines, ...attendanceLines(item.attendance, rules, base)]
  const deductionsTotal = round2(deductions.reduce((sum, l) => sum + l.amount, 0))
  return {
    ...item,
    deductions,
    deductionsTotal,
    netSalary: round2(Math.max(0, item.grossSalary - deductionsTotal)),
  }
}

export function buildPayrollItem(args: {
  payrollId: string
  period: string
  employee: HrEmployee
  scale: SalaryScaleVersion
  deductions: PayrollDeduction[]
  attendance: PayrollItemAttendance
  rules: AttendanceDeductionSettings
}): PayrollItem {
  const { employee: e, scale: s } = args
  return finalizeItem(
    {
      id: `${args.payrollId}_${e.id}`,
      payrollId: args.payrollId,
      period: args.period,
      employeeId: e.id,
      employeeNumber: e.employeeNumber,
      employeeName: e.fullName,
      position: e.position,
      department: e.department,
      category: e.category,
      scaleId: s.scaleId,
      scaleVersion: s.version,
      grade: s.grade,
      basicSalary: round2(s.basicSalary),
      housingAllowance: round2(s.housingAllowance),
      transportAllowance: round2(s.transportAllowance),
      otherAllowances: round2(s.otherAllowances),
      allowancesTotal: allowancesOf(s),
      grossSalary: grossOf(s),
      attendance: args.attendance,
      bank: { ...e.bank },
    },
    args.rules,
    args.deductions,
  )
}

/** Why an employee is left off a payroll month, or null when they should be paid. */
export function payrollExclusion(employee: HrEmployee, period: string): string | null {
  if (employee.status === 'RESIGNED') return 'Resigned'
  if (employee.status === 'SUSPENDED') return 'Suspended'
  if (employee.dateEmployed && employee.dateEmployed > periodEnd(period)) {
    return 'Employed after this month'
  }
  if (!employee.salaryScaleId) return 'No salary scale assigned'
  return null
}

export function summarizeItems(items: PayrollItem[]): PayrollTotals {
  const sum = (pick: (i: PayrollItem) => number) => round2(items.reduce((s, i) => s + pick(i), 0))
  return {
    employees: items.length,
    basic: sum((i) => i.basicSalary),
    allowances: sum((i) => i.allowancesTotal),
    gross: sum((i) => i.grossSalary),
    deductions: sum((i) => i.deductionsTotal),
    net: sum((i) => i.netSalary),
  }
}

/** Next sequential code such as EMP-0008 from the codes already issued. */
export function nextCode(prefix: string, existing: (string | undefined)[], width = 4) {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`)
  const max = existing.reduce((m, code) => {
    const match = code ? pattern.exec(code) : null
    return match ? Math.max(m, Number(match[1])) : m
  }, 0)
  return `${prefix}-${String(max + 1).padStart(width, '0')}`
}
