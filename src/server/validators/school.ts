import { z } from 'zod'
import { emailSchema, idSchema, isoDateSchema } from '@/server/validators/common'

export const studentStatusSchema = z.enum([
  'ACTIVE',
  'INACTIVE',
  'GRADUATED',
  'TRANSFERRED',
  'SUSPENDED',
  'WITHDRAWN',
  'ARCHIVED',
])

export const studentCreateSchema = z.object({
  /** Optional on create — server assigns VHS-{year}-{001} when blank. */
  studentNumber: z.string().max(64).optional().or(z.literal('')),
  admissionNumber: z.string().max(64).optional().or(z.literal('')),
  firstName: z.string().min(1).max(100),
  middleName: z.string().max(100).optional(),
  lastName: z.string().min(1).max(100),
  dateOfBirth: isoDateSchema,
  gender: z.enum(['Male', 'Female']),
  // Students often have no email — blank/whitespace is treated as "not provided".
  email: z.preprocess(
    (v) => (typeof v === 'string' && !v.trim() ? '' : v),
    emailSchema.optional().or(z.literal('')),
  ),
  phone: z.string().max(40).optional(),
  address: z.string().min(1).max(500),
  admissionDate: isoDateSchema,
  status: studentStatusSchema.default('ACTIVE'),
  residency: z.enum(['DAY', 'BOARDER', 'NON_FORMAL']).optional(),
  paymentPlan: z.enum(['TERMLY', 'MONTHLY']).optional(),
  classId: idSchema,
  streamId: idSchema.optional().or(z.literal('')),
  educationLevelId: z.string().min(1).max(40).optional(),
  academicYearId: idSchema.optional(),
  termId: idSchema.optional(),
  subjectIds: z.array(idSchema).default([]),
  sportIds: z.array(idSchema).default([]),
  clubIds: z.array(idSchema).default([]),
  houseId: idSchema.optional().or(z.literal('')),
  guardianIds: z.array(idSchema).default([]),
  profilePhotoId: idSchema.optional(),
  /** Inline guardians created during registration (optional). */
  newGuardians: z
    .array(
      z.object({
        firstName: z.string().min(1).max(100),
        lastName: z.string().min(1).max(100),
        relationship: z.string().min(1).max(80),
        email: emailSchema.optional().or(z.literal('')),
        phone: z.string().min(3).max(40),
        address: z.string().max(500).optional(),
        occupation: z.string().max(120).optional(),
        emergencyContact: z.boolean().optional(),
      }),
    )
    .optional(),
})

export const studentUpdateSchema = studentCreateSchema
  .omit({ newGuardians: true })
  .partial()

export const classStatusSchema = z.enum(['ACTIVE', 'ARCHIVED'])

export const classCreateSchema = z.object({
  name: z.string().min(1).max(120),
  educationLevelId: z.string().min(1).max(40),
  /** Optional — server uses the current academic year when omitted. */
  academicYearId: idSchema.optional().or(z.literal('')),
  termId: idSchema.optional().or(z.literal('')),
  /** Preferred: Term 1 / 2 / 3 — resolved against the academic year. */
  termSequence: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  classTeacherId: idSchema.optional().or(z.literal('')),
  subjectIds: z.array(idSchema).default([]),
  description: z.string().max(1000).optional(),
  capacity: z.number().int().min(1).max(200).optional(),
  status: classStatusSchema.default('ACTIVE'),
})

export const classUpdateSchema = classCreateSchema.partial()

export const subjectCreateSchema = z.object({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(120),
  category: z.string().min(1).max(80),
  educationLevelIds: z.array(z.string().min(1).max(40)).default([]),
  teacherIds: z.array(idSchema).default([]),
  active: z.boolean().default(true),
})

export const subjectUpdateSchema = subjectCreateSchema.partial()

export const sportKitItemSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  quantity: z.coerce.number().int().min(0).max(100_000),
  jerseyNumbers: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
})

export const sportCreateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  active: z.boolean().default(true),
  coachStaffId: idSchema.optional().or(z.literal('')),
  leaderStaffId: idSchema.optional().or(z.literal('')),
  medicStaffIds: z.array(idSchema).default([]),
  officialStaffIds: z.array(idSchema).default([]),
  kits: z.array(sportKitItemSchema).default([]),
})

export const sportUpdateSchema = sportCreateSchema.partial()

export const clubCreateSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(['CLUB', 'SOCIETY', 'ACTIVITY', 'OTHER']).default('CLUB'),
  description: z.string().max(500).optional(),
  active: z.boolean().default(true),
})

export const clubUpdateSchema = clubCreateSchema.partial()

export const houseCreateSchema = z.object({
  name: z.string().min(1).max(120),
  color: z.string().max(40).optional(),
  active: z.boolean().default(true),
})

export const houseUpdateSchema = houseCreateSchema.partial()

export const exemptionCreateSchema = z.object({
  studentId: idSchema,
  type: z.enum(['SUBJECT', 'SPORT', 'ACTIVITY', 'OTHER']),
  targetId: idSchema.optional().or(z.literal('')),
  targetLabel: z.string().min(1).max(160),
  reason: z.string().min(1).max(500),
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional().or(z.literal('')),
  notes: z.string().max(1000).optional(),
})

export const scholarshipCreateSchema = z
  .object({
    grantor: z.string().trim().min(2).max(160),
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional(),
    feeCoveragePercent: z.number().min(0).max(100).default(100),
    benefits: z
      .array(z.enum(['TRANSPORT', 'BOARDING', 'BOOKS', 'UNIFORM', 'MEALS', 'OTHER']))
      .default([]),
    otherBenefits: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'End date must be on or after the start date',
        path: ['endDate'],
      })
    }
  })

export const libraryBookSchema = z.object({
  title: z.string().trim().min(1).max(200),
  author: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(100),
  isbn: z.string().trim().max(32).optional(),
  publisher: z.string().trim().max(160).optional(),
  publicationYear: z.number().int().min(1400).max(new Date().getFullYear() + 1).optional(),
  shelfLocation: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
  copies: z.number().int().min(1).max(10000),
})

export const libraryLoanSchema = z.object({
  bookId: idSchema,
  studentId: idSchema,
  dueAt: isoDateSchema,
  borrowerPhone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
})

export type LibraryBookInput = z.infer<typeof libraryBookSchema>
export type LibraryLoanInput = z.infer<typeof libraryLoanSchema>

export const transferStudentSchema = z.object({
  studentId: idSchema,
  toClassId: idSchema,
  reason: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  date: isoDateSchema.optional(),
})

export const guardianCreateSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  relationship: z.string().min(1).max(80),
  email: emailSchema.optional().or(z.literal('')),
  phone: z.string().min(3).max(40),
  address: z.string().min(1).max(500).default('—'),
  studentIds: z.array(idSchema).default([]),
  occupation: z.string().max(120).optional(),
  emergencyContact: z.boolean().optional(),
})

export const guardianUpdateSchema = guardianCreateSchema.partial()

export const staffCategorySchema = z.enum([
  'TEACHER',
  'COACH',
  'SPORTS_OFFICIAL',
  'MEDIC',
  'ADMINISTRATION',
  'SUPPORT_STAFF',
  'ACCOUNTANT',
  'LIBRARIAN',
  'OTHER',
])

export const staffCreateSchema = z.object({
  employeeNumber: z.string().min(1).max(64),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: emailSchema,
  phone: z.string().min(3).max(40),
  department: z.string().min(1).max(120),
  title: z.string().min(1).max(120),
  category: staffCategorySchema.default('TEACHER'),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  subjectIds: z.array(idSchema).default([]),
  classIds: z.array(idSchema).default([]),
  hireDate: isoDateSchema,
  /** Optional — server auto-generates a temporary password when omitted. */
  password: z.string().min(8).max(128).optional(),
  profilePhotoId: idSchema.nullable().optional(),
})

export const staffUpdateSchema = staffCreateSchema
  .omit({ password: true })
  .partial()
  .extend({
    password: z.string().min(8).max(128).optional(),
    profilePhotoId: idSchema.nullable().optional(),
  })

export const staffSuspendSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  /** Inclusive end date (YYYY-MM-DD). Omit / null = indefinite until admin reactivates. */
  endsAt: isoDateSchema.nullable().optional(),
})

export type StaffSuspendInput = z.infer<typeof staffSuspendSchema>

export const attendanceUpsertSchema = z.object({
  date: isoDateSchema,
  studentId: idSchema,
  classId: idSchema,
  streamId: idSchema,
  subjectId: idSchema.optional(),
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'AUTHORIZED_ABSENCE']),
  kind: z.enum(['DAILY', 'PERIOD']).optional(),
})

export const attendanceRegisterSchema = z.object({
  date: isoDateSchema,
  classId: idSchema,
  entries: z
    .array(
      z.object({
        studentId: idSchema,
        streamId: idSchema,
        status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
      }),
    )
    .min(1)
    .max(200),
})

export type AttendanceRegisterInput = z.infer<typeof attendanceRegisterSchema>

export const paymentCreateSchema = z.object({
  studentId: idSchema,
  invoiceId: idSchema,
  amount: z.number().positive().max(1_000_000),
  method: z.string().min(1).max(80),
  /** Blank → next number from the fee policy receipt counter. */
  receiptNumber: z.string().trim().max(80).optional(),
  paidAt: isoDateSchema.optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
})

export const markUpsertSchema = z.object({
  assessmentId: idSchema,
  studentId: idSchema,
  score: z.number().min(0).max(1000),
  /** Optional — server assigns from grading scale when omitted. */
  grade: z.string().min(1).max(8).optional(),
  commentMode: z.enum(['NONE', 'AUTO', 'CUSTOM']).optional(),
  comment: z.string().max(1000).optional(),
})

const markEntrySchema = z.object({
  studentId: idSchema,
  score: z.number().min(0).max(1000),
  commentMode: z.enum(['NONE', 'AUTO', 'CUSTOM']).default('NONE'),
  comment: z.string().max(1000).optional(),
})

/**
 * Class + subject mark batch for monthly, weekly, mock, or termly assessments.
 * Teachers save draft or submit for admin approval (not directly published).
 */
export const classSubjectMarksSchema = z
  .object({
    classId: idSchema,
    subjectId: idSchema,
    periodType: z.enum(['DAILY', 'MONTHLY', 'WEEKLY', 'MOCK', 'TERMLY']).default('MONTHLY'),
    /** YYYY-MM-DD — required for DAILY exercises */
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** YYYY-MM — required for MONTHLY and MOCK */
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .optional(),
    /** YYYY-MM-DD (week start) — required for WEEKLY */
    weekOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    /** Required for TERMLY */
    termId: idSchema.optional(),
    maxScore: z.number().min(1).max(1000).default(100),
    entries: z.array(markEntrySchema).min(1).max(200),
    /**
     * draft = DRAFT
     * submit = SUBMITTED (awaiting admin approval to release to portal)
     */
    action: z.enum(['draft', 'submit']).default('draft'),
  })
  .superRefine((val, ctx) => {
    if (val.periodType === 'DAILY' && !val.date) {
      ctx.addIssue({
        code: 'custom',
        message: 'Date is required for daily exercises',
        path: ['date'],
      })
    }
    if ((val.periodType === 'MONTHLY' || val.periodType === 'MOCK') && !val.month) {
      ctx.addIssue({
        code: 'custom',
        message: 'Month is required for monthly / mock tests',
        path: ['month'],
      })
    }
    if (val.periodType === 'WEEKLY' && !val.weekOf) {
      ctx.addIssue({
        code: 'custom',
        message: 'Week start date is required for weekly tests',
        path: ['weekOf'],
      })
    }
    if (val.periodType === 'TERMLY' && !val.termId) {
      ctx.addIssue({
        code: 'custom',
        message: 'Term is required for termly results',
        path: ['termId'],
      })
    }
    val.entries.forEach((entry, index) => {
      if (entry.score > val.maxScore) {
        ctx.addIssue({
          code: 'custom',
          message: `Score cannot exceed the maximum mark of ${val.maxScore}`,
          path: ['entries', index, 'score'],
        })
      }
    })
  })

/** @deprecated Prefer classSubjectMarksSchema — kept for older monthly payloads. */
export const monthlyMarksSchema = z.object({
  classId: idSchema,
  subjectId: idSchema,
  /** YYYY-MM */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  maxScore: z.number().min(1).max(1000).default(100),
  entries: z
    .array(
      z.object({
        studentId: idSchema,
        score: z.number().min(0).max(1000),
        commentMode: z.enum(['NONE', 'AUTO', 'CUSTOM']).optional(),
        comment: z.string().max(1000).optional(),
      }),
    )
    .min(1)
    .max(200),
  /** Legacy: true maps to submit (admin still must approve for portal). */
  publish: z.boolean().optional(),
  action: z.enum(['draft', 'submit']).optional(),
})

export const gradingScaleSchema = z.object({
  track: z.enum(['ECD', 'PRIMARY', 'FORM_1_4', 'FORM_5_6']),
  passMark: z.number().min(0).max(100),
  bands: z
    .array(
      z.object({
        grade: z.string().min(1).max(8),
        minPercent: z.number().min(0).max(100),
        maxPercent: z.number().min(0).max(100),
      }),
    )
    .min(1)
    .max(20),
})

/** Allowed forward transitions for mark/assessment workflow. */
export const resultTransitionSchema = z.object({
  status: z.enum(['SUBMITTED', 'APPROVED', 'PUBLISHED', 'LOCKED']),
  /**
   * When true with APPROVED, also release to portal (PUBLISHED) in one admin action.
   */
  releaseToPortal: z.boolean().optional(),
})

export const profileUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  phone: z.string().max(40).optional(),
  title: z.string().max(120).optional(),
  department: z.string().max(120).optional(),
  bio: z.string().max(2000).optional(),
  preferredLanguage: z.enum(['en', 'sn', 'nd']).optional(),
  timezone: z.string().max(80).optional(),
  avatarUrl: z.string().url().optional().nullable(),
  avatarFileId: idSchema.nullable().optional(),
  notificationPrefs: z
    .object({
      email: z.boolean(),
      sms: z.boolean(),
      inApp: z.boolean(),
    })
    .optional(),
  securityPrefs: z
    .object({
      requireReauthForFees: z.boolean(),
    })
    .optional(),
})

export const schoolProfileSchema = z.object({
  name: z.string().trim().min(2).max(160),
  motto: z.string().trim().max(200).optional().or(z.literal('')),
  address: z.string().trim().min(3).max(500),
  phone: z.string().trim().min(3).max(40),
  email: emailSchema,
  website: z.string().trim().max(200).optional().or(z.literal('')),
  registrationNumber: z.string().trim().max(80).optional().or(z.literal('')),
})

const feeAmountSchema = z.number().min(0).max(1_000_000)
const feeAmountsSchema = z.object({ termly: feeAmountSchema, monthly: feeAmountSchema })

export const feePolicySchema = z.object({
  currency: z.string().trim().min(3).max(8),
  receiptPrefix: z.string().trim().min(1).max(12),
  nextReceiptNumber: z.number().int().min(1).max(9_999_999),
  blockResultsWhenFeesOutstanding: z.boolean(),
  overdueGraceDays: z.number().int().min(0).max(365),
  fees: z
    .object({
      ECD_DAY: feeAmountsSchema,
      ECD_BOARDER: feeAmountsSchema,
      PRIMARY_DAY: feeAmountsSchema,
      PRIMARY_BOARDER: feeAmountsSchema,
      O_LEVEL_DAY: feeAmountsSchema,
      O_LEVEL_BOARDER: feeAmountsSchema,
      A_LEVEL_DAY: feeAmountsSchema,
      A_LEVEL_BOARDER: feeAmountsSchema,
      NON_FORMAL: feeAmountsSchema,
    })
    .optional(),
  monthsPerTerm: z.number().int().min(1).max(6).optional(),
})

export const termBillingSchema = z.object({
  termId: idSchema.optional(),
  studentId: idSchema.optional(),
  currentMonthOnly: z.boolean().optional(),
})

export const academicSettingsSchema = z.object({
  year: z.object({
    id: idSchema,
    name: z.string().trim().min(2).max(80),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    isCurrent: z.boolean(),
  }),
  terms: z
    .array(
      z.object({
        id: idSchema,
        name: z.string().trim().min(1).max(80),
        sequence: z.number().int().min(1).max(6),
        startDate: isoDateSchema,
        endDate: isoDateSchema,
      }),
    )
    .min(1)
    .max(6),
})

/** Class teacher final / term report comments (one per student per term). */
export const classTeacherReportsUpsertSchema = z.object({
  termId: idSchema,
  entries: z
    .array(
      z.object({
        studentId: idSchema,
        comment: z.string().trim().max(2000),
      }),
    )
    .min(1)
    .max(200),
})

export const dutyRosterUpsertSchema = z.object({
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z
    .array(
      z.object({
        day: z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI']),
        duty: z.string().trim().min(1).max(120),
        assigneeName: z.string().trim().max(120).optional(),
        studentId: idSchema.optional(),
        notes: z.string().trim().max(500).optional(),
      }),
    )
    .max(50),
})

export type StudentCreateInput = z.infer<typeof studentCreateSchema>
export type StudentUpdateInput = z.infer<typeof studentUpdateSchema>
export type GuardianCreateInput = z.infer<typeof guardianCreateSchema>
export type StaffCreateInput = z.infer<typeof staffCreateSchema>
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>
export type MarkUpsertInput = z.infer<typeof markUpsertSchema>
export type MonthlyMarksInput = z.infer<typeof monthlyMarksSchema>
export type ClassSubjectMarksInput = z.infer<typeof classSubjectMarksSchema>
export type ResultTransitionInput = z.infer<typeof resultTransitionSchema>
export type ClassCreateInput = z.infer<typeof classCreateSchema>
export type ClassUpdateInput = z.infer<typeof classUpdateSchema>
export type SubjectCreateInput = z.infer<typeof subjectCreateSchema>
export type SubjectUpdateInput = z.infer<typeof subjectUpdateSchema>
export type SportCreateInput = z.infer<typeof sportCreateSchema>
export type ClubCreateInput = z.infer<typeof clubCreateSchema>
export type HouseCreateInput = z.infer<typeof houseCreateSchema>
export type ExemptionCreateInput = z.infer<typeof exemptionCreateSchema>
export type ScholarshipCreateInput = z.infer<typeof scholarshipCreateSchema>
export type TransferStudentInput = z.infer<typeof transferStudentSchema>
