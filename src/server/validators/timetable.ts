import { z } from 'zod'
import { idSchema } from '@/server/validators/common'

const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/

const timetableEntrySchema = z
  .object({
    id: idSchema.optional(),
    day: z.enum(days),
    startTime: z.string().regex(timePattern, 'Use 24-hour HH:mm time'),
    endTime: z.string().regex(timePattern, 'Use 24-hour HH:mm time'),
    subjectId: idSchema,
    teacherId: idSchema,
  })
  .refine((entry) => entry.startTime < entry.endTime, {
    path: ['endTime'],
    message: 'End time must be after start time',
  })

export const timetableUpsertSchema = z
  .object({
    classId: idSchema,
    audience: z.array(z.enum(['STUDENTS', 'TEACHERS'])).min(1).max(2),
    entries: z.array(timetableEntrySchema).min(1).max(100),
  })
  .superRefine((timetable, ctx) => {
    if (new Set(timetable.audience).size !== timetable.audience.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['audience'],
        message: 'Audience values must be unique',
      })
    }

    timetable.entries.forEach((entry, index) => {
      const overlapping = timetable.entries.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.day === entry.day &&
          other.startTime < entry.endTime &&
          entry.startTime < other.endTime,
      )
      if (overlapping) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['entries', index, 'startTime'],
          message: 'Timetable entries cannot overlap on the same day',
        })
      }
    })
  })

export type TimetableUpsertInput = z.infer<typeof timetableUpsertSchema>
