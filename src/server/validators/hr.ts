import { z } from 'zod'
import { idSchema } from '@/server/validators/common'

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optionalDate = dateSchema.or(z.literal(''))
const text = (max: number) => z.string().trim().max(max)
const money = z.coerce.number().min(0).max(10_000_000)

export const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')

export const hrStaffSchema = z.object({
  fullName: text(160).min(2, 'Full name is required'),
  nationalId: text(40).min(3, 'National ID is required'),
  gender: z.enum(['MALE', 'FEMALE']),
  dateOfBirth: optionalDate,
  phone: text(40).min(5, 'Phone number is required'),
  email: z.string().trim().email().max(254).or(z.literal('')),
  address: text(300),
  emergencyContact: z.object({
    name: text(120),
    relationship: text(60),
    phone: text(40),
  }),
  position: text(120).min(2, 'Position is required'),
  department: text(120),
  category: z.enum(['TEACHER', 'ANCILLARY', 'ADMINISTRATIVE', 'GENERAL_WORKER']),
  dateEmployed: dateSchema,
  employmentType: z.enum(['PERMANENT', 'CONTRACT', 'PART_TIME', 'TEMPORARY']),
  status: z.enum(['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED']),
  salaryScaleId: text(40).optional().or(z.literal('')),
  bank: z.object({
    bankName: text(120),
    accountNumber: text(60),
    branch: text(120),
  }),
  linkedUid: text(128).optional().or(z.literal('')),
  notes: text(2000).optional().or(z.literal('')),
})

export const salaryScaleSchema = z.object({
  category: z.enum(['TEACHER', 'ANCILLARY', 'ADMINISTRATIVE', 'GENERAL_WORKER']),
  position: text(120).min(2, 'Position is required'),
  grade: text(40).min(1, 'Grade is required'),
  basicSalary: money,
  housingAllowance: money,
  transportAllowance: money,
  otherAllowances: money,
  effectiveDate: dateSchema,
  notes: text(1000).optional().or(z.literal('')),
})

export const salaryScaleUpdateSchema = z.discriminatedUnion('action', [
  salaryScaleSchema.extend({ action: z.literal('revise') }),
  z.object({ action: z.literal('status'), status: z.enum(['ACTIVE', 'INACTIVE']) }),
])

const deductionBase = z.object({
  employeeId: idSchema,
  reason: z.enum([
    'UNAUTHORIZED_ABSENCE',
    'LATE_COMING',
    'SALARY_ADVANCE',
    'LOAN',
    'PENALTY',
    'OTHER',
  ]),
  percentage: z.coerce.number().min(0).max(100).nullable().optional(),
  fixedAmount: money.nullable().optional(),
  date: dateSchema,
  notes: text(1000).optional().or(z.literal('')),
})

const hasAmount = (d: { percentage?: number | null; fixedAmount?: number | null }) =>
  (d.percentage ?? 0) > 0 || (d.fixedAmount ?? 0) > 0

export const deductionSchema = deductionBase.refine(hasAmount, {
  message: 'Enter a percentage or a fixed amount',
  path: ['percentage'],
})

export const deductionUpdateSchema = deductionBase.partial().refine(
  (d) => (d.percentage === undefined && d.fixedAmount === undefined) || hasAmount(d),
  { message: 'Enter a percentage or a fixed amount', path: ['percentage'] },
)

const attendanceRule = z.object({
  mode: z.enum(['PERCENT', 'FIXED']),
  value: z.coerce.number().min(0).max(100_000),
}).refine((r) => r.mode !== 'PERCENT' || r.value <= 100, {
  message: 'A percentage cannot exceed 100',
  path: ['value'],
})

export const attendanceRulesSchema = z.object({
  enabled: z.boolean(),
  absentDay: attendanceRule,
  lateComing: attendanceRule,
  percentBase: z.enum(['GROSS', 'BASIC']),
})

export const payrollGenerateSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
})

export const payrollActionSchema = z.object({
  action: z.enum(['approve', 'reopen', 'lock']),
})

export const payrollItemUpdateSchema = z.object({
  absentDays: z.coerce.number().int().min(0).max(31),
  lateDays: z.coerce.number().int().min(0).max(31),
})

export const expenseSchema = z.object({
  date: dateSchema,
  category: text(60).min(1, 'Category is required'),
  description: text(300).min(2, 'Description is required'),
  quantity: z.coerce.number().positive().max(1_000_000),
  unitPrice: money,
  supplier: text(160).optional().or(z.literal('')),
  paymentMethod: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHEQUE', 'CARD', 'OTHER']),
  notes: text(1000).optional().or(z.literal('')),
})

export const expenseCategorySchema = z.object({
  name: text(60).min(2, 'Category name is required'),
})

export const revenueSchema = z.object({
  date: dateSchema,
  source: z.enum(['SCHOOL_FEES', 'PROJECT_INCOME', 'DONATION', 'OTHER']),
  description: text(300).min(2, 'Description is required'),
  amount: z.coerce.number().positive().max(100_000_000),
  reference: text(120).optional().or(z.literal('')),
})

export const ledgerRangeSchema = z
  .object({ from: dateSchema, to: dateSchema })
  .refine((r) => r.from <= r.to, { message: '`from` must be before `to`' })

export type HrStaffInput = z.infer<typeof hrStaffSchema>
export type SalaryScaleBody = z.infer<typeof salaryScaleSchema>
export type SalaryScaleUpdateBody = z.infer<typeof salaryScaleUpdateSchema>
export type DeductionBody = z.infer<typeof deductionSchema>
export type DeductionUpdateBody = z.infer<typeof deductionUpdateSchema>
export type AttendanceRulesBody = z.infer<typeof attendanceRulesSchema>
export type ExpenseBody = z.infer<typeof expenseSchema>
export type RevenueBody = z.infer<typeof revenueSchema>
