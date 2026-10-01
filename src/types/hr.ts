/* HR, payroll and school finance (expenses / revenue). */

export type HrStaffCategory = 'TEACHER' | 'ANCILLARY' | 'ADMINISTRATIVE' | 'GENERAL_WORKER'
export type HrEmploymentType = 'PERMANENT' | 'CONTRACT' | 'PART_TIME' | 'TEMPORARY'
export type HrStaffStatus = 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'RESIGNED'
export type HrGender = 'MALE' | 'FEMALE'

export interface HrEmergencyContact {
  name: string
  relationship: string
  phone: string
}

export interface HrBankDetails {
  bankName: string
  accountNumber: string
  branch: string
}

/** One employee on the HR register (`hr_staff/{id}`), with or without a console login. */
export interface HrEmployee {
  id: string
  /** Auto-generated, e.g. EMP-0007. */
  employeeNumber: string
  fullName: string
  nationalId: string
  gender: HrGender
  dateOfBirth: string
  phone: string
  email: string
  address: string
  emergencyContact: HrEmergencyContact
  position: string
  department: string
  category: HrStaffCategory
  dateEmployed: string
  employmentType: HrEmploymentType
  status: HrStaffStatus
  /** Stable salary scale code (e.g. SS-0003); the version is resolved per payroll month. */
  salaryScaleId?: string
  bank: HrBankDetails
  /** Console login whose daily check-ins drive attendance deductions. */
  linkedUid?: string
  linkedName?: string
  notes?: string
  createdAt: string
  updatedAt: string
  createdByName?: string
}

export type HrEmployeeInput = Omit<
  HrEmployee,
  'id' | 'employeeNumber' | 'createdAt' | 'updatedAt' | 'createdByName' | 'linkedName'
>

/** Console accounts an employee record can be linked to for check-in tracking. */
export interface HrLinkableAccount {
  uid: string
  name: string
  role: string
  employeeNumber?: string
}

export interface HrStaffBundle {
  employees: HrEmployee[]
  accounts: HrLinkableAccount[]
}

export type SalaryScaleStatus = 'ACTIVE' | 'INACTIVE'

/**
 * One version of a salary scale (`salary_scales/{id}`). Editing a scale adds a new version with
 * its own effective date; earlier versions are kept so past payrolls stay reproducible.
 */
export interface SalaryScaleVersion {
  id: string
  /** Stable Salary Scale ID shared by every version, e.g. SS-0001. */
  scaleId: string
  version: number
  category: HrStaffCategory
  position: string
  grade: string
  basicSalary: number
  housingAllowance: number
  transportAllowance: number
  otherAllowances: number
  grossSalary: number
  effectiveDate: string
  status: SalaryScaleStatus
  /** The latest version of this scale. */
  current: boolean
  notes?: string
  createdAt: string
  createdByName?: string
}

export interface SalaryScaleInput {
  category: HrStaffCategory
  position: string
  grade: string
  basicSalary: number
  housingAllowance: number
  transportAllowance: number
  otherAllowances: number
  effectiveDate: string
  notes?: string
}

export type DeductionReason =
  | 'UNAUTHORIZED_ABSENCE'
  | 'LATE_COMING'
  | 'SALARY_ADVANCE'
  | 'LOAN'
  | 'PENALTY'
  | 'OTHER'

/** A one-off deduction applied to the payroll month of `date` (`deductions/{id}`). */
export interface PayrollDeduction {
  id: string
  /** e.g. DED-0012 */
  deductionNo: string
  employeeId: string
  employeeName: string
  employeeNumber: string
  reason: DeductionReason
  /** Percent of the salary base (gross by default). */
  percentage: number | null
  fixedAmount: number | null
  date: string
  /** YYYY-MM, derived from `date`. */
  period: string
  notes?: string
  addedBy: string
  addedByName: string
  /** APPLIED once the payroll for its month is locked. */
  status: 'PENDING' | 'APPLIED'
  payrollId?: string
  createdAt: string
  updatedAt: string
}

export interface DeductionInput {
  employeeId: string
  reason: DeductionReason
  percentage?: number | null
  fixedAmount?: number | null
  date: string
  notes?: string
}

export type AttendanceDeductionMode = 'PERCENT' | 'FIXED'

export interface AttendanceDeductionRule {
  mode: AttendanceDeductionMode
  value: number
}

/** Automatic attendance deductions (`attendance_deductions/rules`). */
export interface AttendanceDeductionSettings {
  enabled: boolean
  /** Per day absent without a notice. */
  absentDay: AttendanceDeductionRule
  /** Per late check-in. */
  lateComing: AttendanceDeductionRule
  /** What percentage deductions are calculated on. */
  percentBase: 'GROSS' | 'BASIC'
  updatedAt?: string
  updatedByName?: string
}

export type PayrollStatus = 'DRAFT' | 'APPROVED' | 'LOCKED'

export interface PayrollTotals {
  employees: number
  basic: number
  allowances: number
  gross: number
  deductions: number
  net: number
}

export interface PayrollSkippedEmployee {
  employeeId: string
  employeeNumber: string
  name: string
  reason: string
}

/** One month's payroll (`payroll/{YYYY-MM}`). */
export interface PayrollRun {
  id: string
  period: string
  year: number
  month: number
  status: PayrollStatus
  totals: PayrollTotals
  skipped: PayrollSkippedEmployee[]
  generatedAt: string
  generatedByName: string
  approvedAt?: string
  approvedByName?: string
  lockedAt?: string
  lockedByName?: string
  updatedAt: string
}

export interface PayrollDeductionLine {
  source: 'MANUAL' | 'ATTENDANCE'
  deductionId?: string
  reason: DeductionReason
  label: string
  percentage: number | null
  fixedAmount: number | null
  /** Days or occurrences for attendance lines. */
  count?: number
  amount: number
  notes?: string
}

export interface PayrollItemAttendance {
  /** Linked to a console login with check-in records. */
  tracked: boolean
  absentDays: number
  lateDays: number
  /** Counts were entered by hand on the draft payroll. */
  overridden: boolean
}

/** One employee's line on a payroll (`payroll_items/{payrollId}_{employeeId}`). */
export interface PayrollItem {
  id: string
  payrollId: string
  period: string
  employeeId: string
  employeeNumber: string
  employeeName: string
  position: string
  department: string
  category: HrStaffCategory
  scaleId: string
  scaleVersion: number
  grade: string
  basicSalary: number
  housingAllowance: number
  transportAllowance: number
  otherAllowances: number
  allowancesTotal: number
  grossSalary: number
  attendance: PayrollItemAttendance
  deductions: PayrollDeductionLine[]
  deductionsTotal: number
  netSalary: number
  bank: HrBankDetails
}

export interface PayrollSchoolInfo {
  name: string
  motto?: string
  address?: string
  phone?: string
  email?: string
}

export interface PayrollRunDetail {
  run: PayrollRun
  items: PayrollItem[]
  school: PayrollSchoolInfo
}

/** Issued payslip snapshot, written when a payroll is locked (`payslips/{itemId}`). */
export interface Payslip extends PayrollItem {
  schoolName: string
  issuedAt: string
}

export type ExpensePaymentMethod =
  | 'CASH'
  | 'BANK_TRANSFER'
  | 'MOBILE_MONEY'
  | 'CHEQUE'
  | 'CARD'
  | 'OTHER'

export interface Expense {
  id: string
  /** e.g. EXP-0042 */
  expenseNo: string
  date: string
  category: string
  description: string
  quantity: number
  unitPrice: number
  totalAmount: number
  supplier: string
  paymentMethod: ExpensePaymentMethod
  notes?: string
  /** PAYROLL rows are posted automatically when a payroll is locked and can't be edited. */
  source: 'MANUAL' | 'PAYROLL'
  payrollId?: string
  createdByName: string
  createdAt: string
  updatedAt: string
}

export interface ExpenseInput {
  date: string
  category: string
  description: string
  quantity: number
  unitPrice: number
  supplier?: string
  paymentMethod: ExpensePaymentMethod
  notes?: string
}

export interface ExpenseCategory {
  id: string
  name: string
  builtIn: boolean
}

export type RevenueSource = 'SCHOOL_FEES' | 'PROJECT_INCOME' | 'DONATION' | 'OTHER'

export interface Revenue {
  id: string
  /** e.g. REV-0009 */
  revenueNo: string
  date: string
  source: RevenueSource
  description: string
  amount: number
  reference?: string
  createdByName: string
  createdAt: string
  updatedAt: string
}

export interface RevenueInput {
  date: string
  source: RevenueSource
  description: string
  amount: number
  reference?: string
}

export interface FinanceMonthPoint {
  /** YYYY-MM */
  month: string
  label: string
  /** Fee payments recorded in Fees & Payments. */
  feePayments: number
  /** Revenue register entries. */
  otherRevenue: number
  revenue: number
  expenses: number
  salaries: number
  net: number
}

export interface FinanceSummary {
  year: number
  totals: {
    revenue: number
    feePayments: number
    otherRevenue: number
    expenses: number
    salaries: number
    netBalance: number
    outstandingFees: number
  }
  months: FinanceMonthPoint[]
  revenueBySource: { source: string; amount: number }[]
  expensesByCategory: { category: string; amount: number }[]
}
