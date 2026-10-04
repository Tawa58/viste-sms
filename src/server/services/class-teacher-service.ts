import 'server-only'

import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import {
  assertIsClassTeacher,
  assertTeacherOwnsClass,
} from '@/server/authorization/isolation'
import { badRequest, notFound } from '@/server/errors'
import { getDoc, queryCollection, setDoc } from '@/server/repositories/firestore-repo'
import type {
  classTeacherReportsUpsertSchema,
  dutyRosterUpsertSchema,
} from '@/server/validators/school'
import type { z } from 'zod'
import { getGradingScaleForEducationLevel, gradeFromScore } from '@/server/services/grading-service'
import type {
  Assessment,
  ClassResultsPeriod,
  ClassResultsStudentRow,
  ClassResultsSummary,
  ClassTeacherReport,
  DutyRoster,
  Mark,
  SchoolClass,
  Student,
  Subject,
  Term,
} from '@/types'

export type ClassTeacherReportDto = ClassTeacherReport
export type DutyRosterDto = DutyRoster

function reportId(classId: string, termId: string, studentId: string) {
  return `ctr_${classId}_${termId}_${studentId}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function rosterId(classId: string, weekOf: string) {
  return `duty_${classId}_${weekOf}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

async function assertClassTeacherOrAdmin(session: SessionContext, classId: string) {
  if (session.role === 'TEACHER') {
    await assertIsClassTeacher(session, classId)
  } else {
    await assertTeacherOwnsClass(session, classId)
  }
}

export async function listClassTeacherReports(
  session: SessionContext,
  classId: string,
  termId: string,
): Promise<ClassTeacherReportDto[]> {
  requirePermission(session, 'results.read')
  await assertClassTeacherOrAdmin(session, classId)
  const rows = await queryCollection<ClassTeacherReport>('classTeacherReports', {
    limit: 200,
    where: [{ field: 'classId', op: '==', value: classId }],
  })
  return rows.filter((r) => r.termId === termId)
}

export async function upsertClassTeacherReports(
  session: SessionContext,
  classId: string,
  input: z.infer<typeof classTeacherReportsUpsertSchema>,
  requestId?: string,
): Promise<ClassTeacherReportDto[]> {
  requirePermission(session, 'results.enter')
  await assertClassTeacherOrAdmin(session, classId)

  const cls = await getDoc<SchoolClass>('classes', classId)
  if (!cls) throw notFound('Class not found')
  const term = await getDoc<Term>('terms', input.termId)
  if (!term) throw notFound('Term not found')

  const students = await queryCollection<Student>('students', {
    limit: 200,
    where: [{ field: 'classId', op: '==', value: classId }],
  })
  const allowed = new Set(
    students.filter((s) => s.status === 'ACTIVE').map((s) => s.id),
  )

  const now = new Date().toISOString()
  const saved: ClassTeacherReportDto[] = []
  for (const entry of input.entries) {
    if (!allowed.has(entry.studentId)) {
      throw badRequest(`Student ${entry.studentId} is not in this class`)
    }
    const id = reportId(classId, input.termId, entry.studentId)
    const row: ClassTeacherReport = {
      id,
      classId,
      studentId: entry.studentId,
      termId: input.termId,
      comment: entry.comment.trim(),
      updatedAt: now,
      updatedBy: session.uid,
      updatedByName: session.profile.name,
    }
    await setDoc('classTeacherReports', id, { ...row })
    saved.push(row)
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'classTeacher.report.upsert',
    entityType: 'classTeacherReports',
    entityId: classId,
    requestId,
    metadata: { termId: input.termId, count: saved.length },
  })
  return saved
}

export async function getDutyRoster(
  session: SessionContext,
  classId: string,
  weekOf: string,
): Promise<DutyRosterDto | null> {
  requirePermission(session, 'classes.read')
  await assertClassTeacherOrAdmin(session, classId)
  const id = rosterId(classId, weekOf)
  return (await getDoc<DutyRoster>('dutyRosters', id)) ?? null
}

export async function upsertDutyRoster(
  session: SessionContext,
  classId: string,
  input: z.infer<typeof dutyRosterUpsertSchema>,
  requestId?: string,
): Promise<DutyRosterDto> {
  requirePermission(session, 'classes.read')
  await assertClassTeacherOrAdmin(session, classId)

  const cls = await getDoc<SchoolClass>('classes', classId)
  if (!cls) throw notFound('Class not found')

  const id = rosterId(classId, input.weekOf)
  const row: DutyRoster = {
    id,
    classId,
    weekOf: input.weekOf,
    entries: input.entries.map((e) => ({
      day: e.day,
      duty: e.duty.trim(),
      assigneeName: e.assigneeName?.trim() || undefined,
      studentId: e.studentId,
      notes: e.notes?.trim() || undefined,
    })),
    updatedAt: new Date().toISOString(),
    updatedBy: session.uid,
    updatedByName: session.profile.name,
  }
  await setDoc('dutyRosters', id, { ...row })

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'classTeacher.dutyRoster.upsert',
    entityType: 'dutyRosters',
    entityId: id,
    requestId,
    metadata: { classId, weekOf: input.weekOf, count: row.entries.length },
  })
  return row
}

/** Per-student results across all subjects of a class for one month or term. */
export async function getClassResultsSummary(
  session: SessionContext,
  classId: string,
  input: { period: ClassResultsPeriod; termId?: string; month?: string },
): Promise<ClassResultsSummary> {
  requirePermission(session, 'results.read')
  await assertClassTeacherOrAdmin(session, classId)

  const cls = await getDoc<SchoolClass>('classes', classId)
  if (!cls) throw notFound('Class not found')

  const where =
    input.period === 'MONTH'
      ? [
          { field: 'classId', op: '==' as const, value: classId },
          { field: 'month', op: '==' as const, value: input.month },
        ]
      : [
          { field: 'classId', op: '==' as const, value: classId },
          { field: 'type', op: '==' as const, value: 'TERMLY' },
          { field: 'termId', op: '==' as const, value: input.termId },
        ]
  const assessments = (await queryCollection<Assessment>('assessments', { limit: 100, where }))
    .filter((a) =>
      input.period === 'MONTH'
        ? a.type === 'MONTHLY' || a.type === 'DAILY'
        : a.type === 'TERMLY',
    )

  const [students, markLists, subjectDocs, scale] = await Promise.all([
    queryCollection<Student>('students', {
      limit: 100,
      where: [{ field: 'classId', op: '==', value: classId }],
    }),
    Promise.all(
      assessments.map((a) =>
        queryCollection<Mark>('marks', {
          limit: 100,
          where: [{ field: 'assessmentId', op: '==', value: a.id }],
        }),
      ),
    ),
    Promise.all(
      [...new Set(assessments.map((a) => a.subjectId))].map((sid) =>
        getDoc<Subject>('subjects', sid),
      ),
    ),
    getGradingScaleForEducationLevel(cls.educationLevelId || cls.level),
  ])

  const subjectName = new Map<string, string>()
  for (const s of subjectDocs) if (s) subjectName.set(s.id, s.name)

  const active = students.filter((s) => s.status === 'ACTIVE')
  const rows = new Map<string, ClassResultsStudentRow>(
    active.map((s) => [s.id, { studentId: s.id, subjects: [], average: null }]),
  )

  assessments.forEach((a, i) => {
    const max = a.maxScore > 0 ? a.maxScore : 100
    for (const m of markLists[i]) {
      const row = rows.get(m.studentId)
      if (!row || typeof m.score !== 'number') continue
      const percent = Math.round((m.score / max) * 1000) / 10
      row.subjects.push({
        subjectId: a.subjectId,
        subjectName: subjectName.get(a.subjectId) ?? a.name,
        score: m.score,
        maxScore: max,
        percent,
        grade: m.grade || gradeFromScore(m.score, max, scale),
      })
    }
  })

  for (const row of rows.values()) {
    row.subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName))
    if (row.subjects.length === 0) continue
    const avg = row.subjects.reduce((sum, s) => sum + s.percent, 0) / row.subjects.length
    row.average = Math.round(avg * 10) / 10
    row.grade = gradeFromScore(row.average, 100, scale)
  }

  const ranked = [...rows.values()]
    .filter((r) => r.average !== null)
    .sort((a, b) => (b.average ?? 0) - (a.average ?? 0))
  ranked.forEach((r, i) => {
    const prev = ranked[i - 1]
    r.position = prev && prev.average === r.average ? prev.position : i + 1
  })

  return {
    classId,
    period: input.period,
    termId: input.termId,
    month: input.month,
    subjects: [...new Set(assessments.map((a) => a.subjectId))]
      .map((id) => ({ id, name: subjectName.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    students: [...rows.values()],
  }
}

export async function getClassTeacherCommentForStudent(
  studentId: string,
  classId: string,
  termId?: string,
): Promise<string | undefined> {
  if (!termId) return undefined
  const id = reportId(classId, termId, studentId)
  const row = await getDoc<ClassTeacherReport>('classTeacherReports', id)
  return row?.comment?.trim() || undefined
}
