import { apiFetch } from '@/services/api/http-client'
import { USE_MOCK_API } from '@/services/api/client'
import { mockFinanceService, mockHrService } from '@/services/hr-mock'
import type {
  AttendanceDeductionSettings,
  DeductionInput,
  Expense,
  ExpenseCategory,
  ExpenseInput,
  FinanceSummary,
  HrEmployee,
  HrEmployeeInput,
  HrStaffBundle,
  PayrollDeduction,
  PayrollRun,
  PayrollRunDetail,
  PayrollSchoolInfo,
  Payslip,
  Revenue,
  RevenueInput,
  SalaryScaleInput,
  SalaryScaleStatus,
  SalaryScaleVersion,
} from '@/types'

export type PayrollAction = 'approve' | 'reopen' | 'lock'
export type DateRange = { from: string; to: string }
export type AttendanceRulesInput = Omit<AttendanceDeductionSettings, 'updatedAt' | 'updatedByName'>

export type HrService = {
  /** Letterhead details for PDF exports. */
  getSchool(): Promise<PayrollSchoolInfo>
  listStaff(): Promise<HrStaffBundle>
  createStaff(input: HrEmployeeInput): Promise<HrEmployee>
  updateStaff(id: string, input: HrEmployeeInput): Promise<HrEmployee>
  deleteStaff(id: string): Promise<void>
  listScales(): Promise<SalaryScaleVersion[]>
  createScale(input: SalaryScaleInput): Promise<SalaryScaleVersion>
  /** Adds a new version; earlier versions are kept. */
  reviseScale(scaleId: string, input: SalaryScaleInput): Promise<SalaryScaleVersion[]>
  setScaleStatus(scaleId: string, status: SalaryScaleStatus): Promise<SalaryScaleVersion[]>
  listPayrolls(): Promise<PayrollRun[]>
  getPayroll(id: string): Promise<PayrollRunDetail>
  generatePayroll(year: number, month: number): Promise<PayrollRunDetail>
  payrollAction(id: string, action: PayrollAction): Promise<PayrollRunDetail>
  deletePayroll(id: string): Promise<void>
  updatePayrollItem(
    id: string,
    itemId: string,
    counts: { absentDays: number; lateDays: number },
  ): Promise<PayrollRunDetail>
  listPayslips(filter: { period?: string; employeeId?: string }): Promise<Payslip[]>
  listDeductions(period?: string): Promise<PayrollDeduction[]>
  createDeduction(input: DeductionInput): Promise<PayrollDeduction>
  updateDeduction(id: string, input: Partial<DeductionInput>): Promise<PayrollDeduction>
  deleteDeduction(id: string): Promise<void>
  getAttendanceRules(): Promise<AttendanceDeductionSettings>
  updateAttendanceRules(input: AttendanceRulesInput): Promise<AttendanceDeductionSettings>
}

export type FinanceService = {
  listExpenses(range: DateRange): Promise<Expense[]>
  createExpense(input: ExpenseInput): Promise<Expense>
  updateExpense(id: string, input: ExpenseInput): Promise<Expense>
  deleteExpense(id: string): Promise<void>
  listExpenseCategories(): Promise<ExpenseCategory[]>
  createExpenseCategory(name: string): Promise<ExpenseCategory>
  deleteExpenseCategory(id: string): Promise<void>
  listRevenues(range: DateRange): Promise<Revenue[]>
  createRevenue(input: RevenueInput): Promise<Revenue>
  updateRevenue(id: string, input: RevenueInput): Promise<Revenue>
  deleteRevenue(id: string): Promise<void>
  getSummary(year: number): Promise<FinanceSummary>
}

const enc = encodeURIComponent
const get = <T,>(path: string) => apiFetch<T>(path, { skipCache: true })
const send = <T,>(path: string, method: string, body?: unknown) =>
  apiFetch<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const remove = async (path: string) => {
  await apiFetch<{ ok: boolean }>(path, { method: 'DELETE' })
}
const rangeQuery = (r: DateRange) => `?from=${enc(r.from)}&to=${enc(r.to)}`

const apiHrService: HrService = {
  getSchool: () => apiFetch('/api/v1/hr/school', { cacheTtlMs: 5 * 60_000 }),
  listStaff: () => get('/api/v1/hr/staff'),
  createStaff: (input) => send('/api/v1/hr/staff', 'POST', input),
  updateStaff: (id, input) => send(`/api/v1/hr/staff/${enc(id)}`, 'PATCH', input),
  deleteStaff: (id) => remove(`/api/v1/hr/staff/${enc(id)}`),
  listScales: () => get('/api/v1/hr/salary-scales'),
  createScale: (input) => send('/api/v1/hr/salary-scales', 'POST', input),
  reviseScale: (scaleId, input) =>
    send(`/api/v1/hr/salary-scales/${enc(scaleId)}`, 'PATCH', { ...input, action: 'revise' }),
  setScaleStatus: (scaleId, status) =>
    send(`/api/v1/hr/salary-scales/${enc(scaleId)}`, 'PATCH', { action: 'status', status }),
  listPayrolls: () => get('/api/v1/payroll'),
  getPayroll: (id) => get(`/api/v1/payroll/${enc(id)}`),
  generatePayroll: (year, month) => send('/api/v1/payroll', 'POST', { year, month }),
  payrollAction: (id, action) => send(`/api/v1/payroll/${enc(id)}`, 'PATCH', { action }),
  deletePayroll: (id) => remove(`/api/v1/payroll/${enc(id)}`),
  updatePayrollItem: (id, itemId, counts) =>
    send(`/api/v1/payroll/${enc(id)}/items/${enc(itemId)}`, 'PATCH', counts),
  listPayslips: (filter) => {
    const params = new URLSearchParams()
    if (filter.period) params.set('period', filter.period)
    if (filter.employeeId) params.set('employeeId', filter.employeeId)
    const qs = params.toString()
    return get(`/api/v1/payroll/payslips${qs ? `?${qs}` : ''}`)
  },
  listDeductions: (period) =>
    get(`/api/v1/payroll/deductions${period ? `?period=${enc(period)}` : ''}`),
  createDeduction: (input) => send('/api/v1/payroll/deductions', 'POST', input),
  updateDeduction: (id, input) => send(`/api/v1/payroll/deductions/${enc(id)}`, 'PATCH', input),
  deleteDeduction: (id) => remove(`/api/v1/payroll/deductions/${enc(id)}`),
  getAttendanceRules: () => get('/api/v1/payroll/attendance-rules'),
  updateAttendanceRules: (input) => send('/api/v1/payroll/attendance-rules', 'PUT', input),
}

const apiFinanceService: FinanceService = {
  listExpenses: (range) => get(`/api/v1/finance/expenses${rangeQuery(range)}`),
  createExpense: (input) => send('/api/v1/finance/expenses', 'POST', input),
  updateExpense: (id, input) => send(`/api/v1/finance/expenses/${enc(id)}`, 'PATCH', input),
  deleteExpense: (id) => remove(`/api/v1/finance/expenses/${enc(id)}`),
  listExpenseCategories: () => get('/api/v1/finance/expense-categories'),
  createExpenseCategory: (name) => send('/api/v1/finance/expense-categories', 'POST', { name }),
  deleteExpenseCategory: (id) => remove(`/api/v1/finance/expense-categories/${enc(id)}`),
  listRevenues: (range) => get(`/api/v1/finance/revenues${rangeQuery(range)}`),
  createRevenue: (input) => send('/api/v1/finance/revenues', 'POST', input),
  updateRevenue: (id, input) => send(`/api/v1/finance/revenues/${enc(id)}`, 'PATCH', input),
  deleteRevenue: (id) => remove(`/api/v1/finance/revenues/${enc(id)}`),
  getSummary: (year) => get(`/api/v1/finance/summary?year=${year}`),
}

export const hrService: HrService = USE_MOCK_API ? mockHrService : apiHrService
export const financeService: FinanceService = USE_MOCK_API ? mockFinanceService : apiFinanceService
