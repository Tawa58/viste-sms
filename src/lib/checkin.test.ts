import { describe, expect, it } from 'vitest'
import {
  buildMonthReport,
  expectedWorkDays,
  isLateCheckIn,
  schoolClock,
  schoolDate,
  shiftMonth,
} from '@/lib/checkin'
import type { StaffCheckin, StaffCheckinMessage } from '@/types'

function record(date: string, late = false): StaffCheckin {
  return {
    id: `u1_${date}`,
    uid: 'u1',
    name: 'Tariro Moyo',
    role: 'TEACHER',
    date,
    checkInAt: `${date}T05:20:00.000Z`,
    checkInLatitude: 0,
    checkInLongitude: 0,
    checkInAccuracy: 10,
    checkInDistance: 12,
    checkInInside: true,
    late,
    exitCount: 1,
    secondsOutside: 600,
    siteName: 'School',
    updatedAt: `${date}T05:20:00.000Z`,
  }
}

describe('check-in helpers', () => {
  it('uses school time (UTC+2) for dates and clocks', () => {
    expect(schoolDate('2026-09-27T23:30:00Z')).toBe('2026-09-28')
    expect(schoolClock('2026-09-28T05:20:00Z')).toBe('07:20')
  })

  it('marks late check-ins after the cut-off', () => {
    expect(isLateCheckIn('2026-09-28T05:20:00Z', '07:30')).toBe(false)
    expect(isLateCheckIn('2026-09-28T05:45:00Z', '07:30')).toBe(true)
    expect(isLateCheckIn('2026-09-28T09:45:00Z', '')).toBe(false)
  })

  it('shifts months across years', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })

  it('counts working weekdays inside a term', () => {
    const days = expectedWorkDays('2026-09', {
      workingDays: [1, 2, 3, 4, 5],
      terms: [{ startDate: '2026-09-08', endDate: '2026-12-04' }],
      through: '2026-09-11',
    })
    expect(days).toEqual(['2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'])
  })

  it('builds a monthly report with late and notified days', () => {
    const notice: StaffCheckinMessage = {
      id: 'm1',
      uid: 'u1',
      name: 'Tariro Moyo',
      role: 'TEACHER',
      kind: 'ABSENCE',
      category: 'Sick',
      details: 'Clinic visit',
      absenceDate: '2026-09-10',
      status: 'OPEN',
      createdAt: '2026-09-09T10:00:00Z',
      updatedAt: '2026-09-09T10:00:00Z',
    }
    const report = buildMonthReport({
      month: '2026-09',
      records: [record('2026-09-08'), record('2026-09-09', true), record('2026-09-12')],
      notices: [notice],
      settings: { workingDays: [1, 2, 3, 4, 5] },
      terms: [{ startDate: '2026-09-08', endDate: '2026-12-04' }],
      today: '2026-09-11',
    })
    expect(report.workingDays).toBe(4)
    expect(report.present).toBe(2)
    expect(report.late).toBe(1)
    expect(report.notified).toBe(1)
    expect(report.absent).toBe(1)
    expect(report.rate).toBe(50)
    expect(report.days.find((d) => d.date === '2026-09-12')?.expected).toBe(false)
    expect(report.exits).toBe(3)
  })
})
