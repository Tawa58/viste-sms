import { describe, expect, it } from 'vitest'
import { timetableUpsertSchema } from './timetable'

const base = {
  classId: 'class-1',
  audience: ['STUDENTS'] as const,
  entries: [
    {
      day: 'MONDAY' as const,
      startTime: '08:00',
      endTime: '09:00',
      subjectId: 'subject-1',
      teacherId: 'staff-1',
    },
  ],
}

describe('timetableUpsertSchema', () => {
  it('accepts valid entries and audience', () => {
    expect(timetableUpsertSchema.safeParse(base).success).toBe(true)
  })

  it('rejects an end time that is not after the start time', () => {
    const result = timetableUpsertSchema.safeParse({
      ...base,
      entries: [{ ...base.entries[0], endTime: '08:00' }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects overlapping lessons on the same day', () => {
    const result = timetableUpsertSchema.safeParse({
      ...base,
      entries: [
        base.entries[0],
        {
          ...base.entries[0],
          startTime: '08:30',
          endTime: '09:30',
          subjectId: 'subject-2',
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('allows lessons on different days at the same time', () => {
    const result = timetableUpsertSchema.safeParse({
      ...base,
      entries: [
        base.entries[0],
        { ...base.entries[0], day: 'TUESDAY' as const, subjectId: 'subject-2' },
      ],
    })
    expect(result.success).toBe(true)
  })
})
