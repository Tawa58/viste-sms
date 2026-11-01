import 'server-only'

import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import {
  assertCanAccessStudent,
  assertIsClassTeacher,
  assertTeacherOwnsClass,
  listAccessibleStudents,
} from '@/server/authorization/isolation'
import { badRequest, conflict, forbidden, notFound } from '@/server/errors'
import {
  getDoc,
  newId,
  queryCollection,
  setDoc,
  type WhereClause,
} from '@/server/repositories/firestore-repo'
import type {
  attendanceRegisterSchema,
  attendanceUpsertSchema,
} from '@/server/validators/school'
import type { z } from 'zod'
import type { AttendanceRecord, AttendanceSession, SchoolClass, Staff } from '@/types'

export type AttendanceDto = AttendanceRecord
export type AttendanceSessionDto = AttendanceSession

function dailyRecordId(date: string, classId: string, studentId: string) {
  return `att_${date}_${classId}_${studentId}_daily`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function sessionId(date: string, classId: string) {
  return `attsess_${date}_${classId}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

export async function listAttendance(
  session: SessionContext,
  opts?: { date?: string; classId?: string; studentId?: string; kind?: 'DAILY' | 'PERIOD' },
): Promise<AttendanceDto[]> {
  requirePermission(session, 'attendance.read')

  if (opts?.studentId) {
    await assertCanAccessStudent(session, opts.studentId)
    const rows = await queryCollection<AttendanceRecord>('attendance', {
      limit: 200,
      where: [{ field: 'studentId', op: '==', value: opts.studentId }],
    })
    return opts.kind ? rows.filter((r) => (r.kind ?? 'PERIOD') === opts.kind) : rows
  }

  if (session.role === 'PARENT' || session.role === 'STUDENT') {
    const students = await listAccessibleStudents(session)
    const ids = new Set(students.map((s) => s.id))
    const all = await queryCollection<AttendanceRecord>('attendance', {
      limit: 300,
      ...(opts?.date
        ? { where: [{ field: 'date', op: '==' as const, value: opts.date }] }
        : {}),
    })
    return all
      .filter((r) => ids.has(r.studentId))
      .filter((r) => (opts?.kind ? (r.kind ?? 'PERIOD') === opts.kind : true))
  }

  // Daily registers are class-teacher only; period marks use taught ∪ CT classes.
  const dailyOnly = opts?.kind === 'DAILY'
  if (session.role === 'TEACHER') {
    const {
      resolveClassTeacherClassIds,
      resolveTeacherClassIds,
    } = await import('@/server/authorization/isolation')
    const allowed = new Set(
      dailyOnly
        ? await resolveClassTeacherClassIds(session)
        : await resolveTeacherClassIds(session),
    )
    if (opts?.classId && !allowed.has(opts.classId)) {
      throw forbidden(
        dailyOnly
          ? 'Only the class teacher can view this register'
          : 'Teacher is not assigned to this class',
      )
    }
  }

  // Single equality filter only — avoid composite-index failures on Vercel.
  const where: WhereClause[] | undefined = opts?.date
    ? [{ field: 'date', op: '==', value: opts.date }]
    : opts?.classId
      ? [{ field: 'classId', op: '==', value: opts.classId }]
      : undefined

  let rows: AttendanceRecord[] = []
  try {
    rows = await queryCollection<AttendanceRecord>('attendance', {
      limit: 100,
      where,
    })
  } catch (err) {
    console.error('listAttendance query failed', err)
    rows = []
  }

  if (opts?.classId) rows = rows.filter((r) => r.classId === opts.classId)
  if (opts?.date) rows = rows.filter((r) => r.date === opts.date)

  if (session.role === 'TEACHER' && !opts?.classId) {
    const {
      resolveClassTeacherClassIds,
      resolveTeacherClassIds,
    } = await import('@/server/authorization/isolation')
    const allowed = new Set(
      dailyOnly
        ? await resolveClassTeacherClassIds(session)
        : await resolveTeacherClassIds(session),
    )
    rows = rows.filter((r) => allowed.has(r.classId))
  }

  if (opts?.kind) {
    rows = rows.filter((r) => (r.kind ?? (r.subjectId ? 'PERIOD' : 'DAILY')) === opts.kind)
  }
  return rows
}

export async function listAttendanceSessions(
  session: SessionContext,
  opts?: { date?: string; classId?: string },
): Promise<AttendanceSessionDto[]> {
  requirePermission(session, 'attendance.read')

  // Use at most one equality filter so we never need a composite Firestore index.
  // Remaining filters + newest-first sort happen in memory.
  const where: WhereClause[] | undefined = opts?.date
    ? [{ field: 'date', op: '==', value: opts.date }]
    : opts?.classId
      ? [{ field: 'classId', op: '==', value: opts.classId }]
      : undefined

  let rows: AttendanceSession[] = []
  try {
    rows = await queryCollection<AttendanceSession>('attendanceSessions', {
      limit: 100,
      where,
    })
  } catch (err) {
    // Empty / missing collection or index issues should not break the attendance page
    console.error('listAttendanceSessions query failed', err)
    rows = []
  }

  if (opts?.classId) rows = rows.filter((r) => r.classId === opts.classId)
  if (opts?.date) rows = rows.filter((r) => r.date === opts.date)
  rows.sort((a, b) => String(b.submittedAt ?? '').localeCompare(String(a.submittedAt ?? '')))

  if (session.role === 'TEACHER') {
    const { resolveClassTeacherClassIds } = await import('@/server/authorization/isolation')
    const allowed = new Set(await resolveClassTeacherClassIds(session))
    if (opts?.classId && !allowed.has(opts.classId)) {
      throw forbidden('Only the class teacher can view this register')
    }
    rows = rows.filter((r) => allowed.has(r.classId))
  }

  return rows
}

export async function upsertAttendance(
  session: SessionContext,
  input: z.infer<typeof attendanceUpsertSchema>,
  requestId?: string,
  options?: { bypassDailyLock?: boolean },
): Promise<AttendanceDto> {
  requirePermission(session, 'attendance.create')
  await assertCanAccessStudent(session, input.studentId)

  const kind = input.kind ?? (input.subjectId ? 'PERIOD' : 'DAILY')
  // Daily register marks are class-teacher only; period marks use taught classes.
  if (kind === 'DAILY' && session.role === 'TEACHER') {
    await assertIsClassTeacher(session, input.classId)
  } else {
    await assertTeacherOwnsClass(session, input.classId)
  }

  if (kind === 'DAILY' && !options?.bypassDailyLock) {
    const existingSession = await getDoc<AttendanceSession>(
      'attendanceSessions',
      sessionId(input.date, input.classId),
    )
    if (existingSession) {
      throw conflict(
        `This day’s register for this class is already submitted and locked until the next calendar day.`,
      )
    }
  }

  const id =
    kind === 'DAILY'
      ? dailyRecordId(input.date, input.classId, input.studentId)
      : (
          await queryCollection<AttendanceRecord>('attendance', {
            limit: 1,
            where: [
              { field: 'date', op: '==', value: input.date },
              { field: 'studentId', op: '==', value: input.studentId },
              ...(input.subjectId
                ? [{ field: 'subjectId', op: '==' as const, value: input.subjectId }]
                : []),
            ],
          })
        )[0]?.id ?? newId('att')

  const existing = await getDoc<AttendanceRecord>('attendance', id)
  const now = new Date().toISOString()
  const row: AttendanceRecord = {
    id,
    date: input.date,
    studentId: input.studentId,
    classId: input.classId,
    streamId: input.streamId,
    subjectId: input.subjectId,
    status: input.status,
    recordedBy: session.uid,
    kind,
    recordedAt: now,
  }

  await setDoc('attendance', id, { ...row })
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: existing ? 'attendance.update' : 'attendance.create',
    entityType: 'attendance',
    entityId: id,
    requestId,
    metadata: { studentId: input.studentId, status: input.status, kind },
  })
  return row
}

/**
 * Submit a full daily class register (present/absent) in one go.
 * Creates/updates daily attendance rows and an attendanceSessions summary for admins.
 * Once submitted for a class+date, the register is locked until the next calendar day.
 */
export async function submitDailyRegister(
  session: SessionContext,
  input: z.infer<typeof attendanceRegisterSchema>,
  requestId?: string,
): Promise<{ session: AttendanceSessionDto; records: AttendanceDto[] }> {
  requirePermission(session, 'attendance.create')
  // Daily registers are a class-teacher duty (admins always allowed).
  if (session.role === 'TEACHER') {
    await assertIsClassTeacher(session, input.classId)
  } else {
    await assertTeacherOwnsClass(session, input.classId)
  }

  const cls = await getDoc<SchoolClass>('classes', input.classId)
  if (!cls) throw notFound('Class not found')

  const sid = sessionId(input.date, input.classId)
  const already = await getDoc<AttendanceSession>('attendanceSessions', sid)
  if (already) {
    throw conflict(
      `Register for ${cls.name} on ${input.date} is already submitted and locked. It can be taken again on the next calendar day.`,
    )
  }

  const studentIds = new Set(input.entries.map((e) => e.studentId))
  if (studentIds.size !== input.entries.length) {
    throw badRequest('Duplicate students in register')
  }

  const records: AttendanceDto[] = []
  for (const entry of input.entries) {
    const row = await upsertAttendance(
      session,
      {
        date: input.date,
        classId: input.classId,
        studentId: entry.studentId,
        streamId: entry.streamId,
        status: entry.status,
        kind: 'DAILY',
      },
      requestId,
      { bypassDailyLock: true },
    )
    records.push(row)
  }

  const presentCount = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length
  const absentCount = records.filter((r) => r.status === 'ABSENT').length
  const lateCount = records.filter((r) => r.status === 'LATE').length
  const excusedCount = records.filter(
    (r) => r.status === 'EXCUSED' || r.status === 'AUTHORIZED_ABSENCE',
  ).length

  const sessionRow: AttendanceSession = {
    id: sid,
    date: input.date,
    classId: input.classId,
    className: cls.name,
    submittedAt: new Date().toISOString(),
    submittedBy: session.uid,
    submittedByName: session.profile.name,
    presentCount,
    absentCount,
    lateCount,
    excusedCount,
    totalCount: records.length,
  }
  await setDoc('attendanceSessions', sid, { ...sessionRow })

  try {
    const { notifyRegisterSubmitted } = await import('@/server/services/notifications-service')
    await notifyRegisterSubmitted({
      date: input.date,
      classId: input.classId,
      className: cls.name,
      teacherName: session.profile.name || 'Teacher',
    })
  } catch (err) {
    console.error('notifyRegisterSubmitted failed', err)
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'attendance.register_submit',
    entityType: 'attendanceSessions',
    entityId: sid,
    requestId,
    metadata: {
      classId: input.classId,
      date: input.date,
      total: records.length,
      presentCount,
      absentCount,
    },
  })

  return { session: sessionRow, records }
}

export async function getAttendance(
  session: SessionContext,
  id: string,
): Promise<AttendanceDto> {
  requirePermission(session, 'attendance.read')
  const row = await getDoc<AttendanceRecord>('attendance', id)
  if (!row) throw notFound('Attendance record not found')
  await assertCanAccessStudent(session, row.studentId)
  return row
}

/** Today’s school-wide attendance % for dashboard analytics. */
export async function computeTodayAttendancePct(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)
  const rows = await queryCollection<AttendanceRecord>('attendance', {
    limit: 80,
    where: [{ field: 'date', op: '==', value: today }],
  })
  const daily = rows.filter((r) => (r.kind ?? (r.subjectId ? 'PERIOD' : 'DAILY')) === 'DAILY')
  if (daily.length === 0) return 0
  const present = daily.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length
  return Math.round((present / daily.length) * 100)
}

export const listAttendanceService = listAttendance
export const listAttendanceSessionsService = listAttendanceSessions
export const upsertAttendanceService = upsertAttendance
export const submitDailyRegisterService = submitDailyRegister
export const getAttendanceService = getAttendance
