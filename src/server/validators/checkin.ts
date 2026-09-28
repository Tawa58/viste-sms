import { z } from 'zod'
import { idSchema } from '@/server/validators/common'
import { ABSENCE_CATEGORIES, EXIT_REASONS, ISSUE_CATEGORIES } from '@/lib/checkin'
import { MAX_GEOFENCE_RADIUS_M, MIN_GEOFENCE_RADIUS_M } from '@/lib/geofence'

const latitude = z.number().finite().min(-90).max(90)
const longitude = z.number().finite().min(-180).max(180)
const accuracy = z.number().finite().min(0).max(100_000).nullable().optional()

const position = { latitude, longitude, accuracy }

export const monthParamSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
  .optional()

export const checkinPunchSchema = z.object({
  action: z.enum(['CHECK_IN', 'CHECK_OUT']),
  ...position,
})

export const boundaryUpdateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('EXIT'), ...position }),
  z.object({ action: z.literal('PROGRESS'), eventId: idSchema, ...position }),
  z.object({ action: z.literal('RETURN'), eventId: idSchema, ...position }),
  z
    .object({
      action: z.literal('REASON'),
      eventId: idSchema,
      reason: z.enum(EXIT_REASONS),
      reasonNote: z.string().trim().max(300).optional(),
    })
    .refine((v) => v.reason !== 'Other' || Boolean(v.reasonNote), {
      message: 'Describe the reason',
      path: ['reasonNote'],
    }),
])

export const checkinMessageSchema = z
  .object({
    kind: z.enum(['ABSENCE', 'ISSUE']),
    category: z.string().trim().min(1).max(60),
    details: z.string().trim().min(8, 'Add a few more details').max(1000),
    absenceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
      .optional(),
  })
  .superRefine((v, ctx) => {
    const categories: readonly string[] =
      v.kind === 'ABSENCE' ? ABSENCE_CATEGORIES : ISSUE_CATEGORIES
    if (!categories.includes(v.category)) {
      ctx.addIssue({ code: 'custom', path: ['category'], message: 'Choose a category' })
    }
    if (v.kind === 'ABSENCE' && !v.absenceDate) {
      ctx.addIssue({ code: 'custom', path: ['absenceDate'], message: 'Choose the date' })
    }
  })

export const checkinMessageUpdateSchema = z
  .object({
    status: z.enum(['OPEN', 'SEEN', 'RESOLVED']).optional(),
    adminReply: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.status !== undefined || v.adminReply !== undefined, 'Nothing to update')

export const checkinSettingsSchema = z
  .object({
    siteName: z.string().trim().min(1).max(80),
    latitude: latitude.nullable(),
    longitude: longitude.nullable(),
    radiusMeters: z.number().int().min(MIN_GEOFENCE_RADIUS_M).max(MAX_GEOFENCE_RADIUS_M),
    requireInside: z.boolean(),
    lateAfter: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm')]),
    workingDays: z
      .array(z.number().int().min(0).max(6))
      .min(1, 'Choose at least one working day')
      .max(7)
      .transform((days) => [...new Set(days)].sort()),
  })
  .refine((v) => (v.latitude === null) === (v.longitude === null), {
    message: 'Set both latitude and longitude',
    path: ['latitude'],
  })

export type CheckinPunch = z.infer<typeof checkinPunchSchema>
export type BoundaryUpdate = z.infer<typeof boundaryUpdateSchema>
