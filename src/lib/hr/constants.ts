import type {
  AttendanceDeductionSettings,
  DeductionReason,
  ExpensePaymentMethod,
  HrEmploymentType,
  HrStaffCategory,
  HrStaffStatus,
  PayrollStatus,
  RevenueSource,
} from '@/types'

export const HR_CATEGORY_LABEL: Record<HrStaffCategory, string> = {
  TEACHER: 'Teacher',
  ANCILLARY: 'Ancillary / auxiliary',
  ADMINISTRATIVE: 'Administrative',
  GENERAL_WORKER: 'General worker',
}

export const HR_CATEGORIES = Object.keys(HR_CATEGORY_LABEL) as HrStaffCategory[]

export const EMPLOYMENT_TYPE_LABEL: Record<HrEmploymentType, string> = {
  PERMANENT: 'Permanent',
  CONTRACT: 'Contract',
  PART_TIME: 'Part-time',
  TEMPORARY: 'Temporary',
}

export const EMPLOYMENT_TYPES = Object.keys(EMPLOYMENT_TYPE_LABEL) as HrEmploymentType[]

export const HR_STATUS_LABEL: Record<HrStaffStatus, string> = {
  ACTIVE: 'Active',
  ON_LEAVE: 'On leave',
  SUSPENDED: 'Suspended',
  RESIGNED: 'Resigned',
}

export const HR_STATUSES = Object.keys(HR_STATUS_LABEL) as HrStaffStatus[]

export const DEDUCTION_REASON_LABEL: Record<DeductionReason, string> = {
  UNAUTHORIZED_ABSENCE: 'Unauthorized absence',
  LATE_COMING: 'Late coming',
  SALARY_ADVANCE: 'Salary advance',
  LOAN: 'Loan deduction',
  PENALTY: 'Penalty',
  OTHER: 'Other deduction',
}

export const DEDUCTION_REASONS = Object.keys(DEDUCTION_REASON_LABEL) as DeductionReason[]

export const PAYMENT_METHOD_LABEL: Record<ExpensePaymentMethod, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  MOBILE_MONEY: 'Mobile money',
  CHEQUE: 'Cheque',
  CARD: 'Card',
  OTHER: 'Other',
}

export const PAYMENT_METHODS = Object.keys(PAYMENT_METHOD_LABEL) as ExpensePaymentMethod[]

export const REVENUE_SOURCE_LABEL: Record<RevenueSource, string> = {
  SCHOOL_FEES: 'School fees',
  PROJECT_INCOME: 'Project income',
  DONATION: 'Donation',
  OTHER: 'Other income',
}

export const REVENUE_SOURCES = Object.keys(REVENUE_SOURCE_LABEL) as RevenueSource[]

export const PAYROLL_STATUS_LABEL: Record<PayrollStatus, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Approved',
  LOCKED: 'Locked',
}

/** Expense category that payroll posts to and the dashboard reads salary costs from. */
export const SALARIES_CATEGORY = 'Salaries'

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Stationery',
  'Food',
  'Fuel',
  'Maintenance',
  'Electricity',
  'Water',
  'Internet',
  'Teaching Materials',
  'Sports',
  'Projects',
  SALARIES_CATEGORY,
  'Other',
]

export const DEFAULT_ATTENDANCE_RULES: AttendanceDeductionSettings = {
  enabled: false,
  absentDay: { mode: 'PERCENT', value: 5 },
  lateComing: { mode: 'PERCENT', value: 2 },
  percentBase: 'GROSS',
}

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Payroll and ledger amounts always show cents. */
export function formatMoney(amount: number | null | undefined) {
  return moneyFormatter.format(Number.isFinite(amount) ? Number(amount) : 0)
}

export function formatPercentValue(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, '')}%`
}
