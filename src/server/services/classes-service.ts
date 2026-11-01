import 'server-only'

import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import { badRequest, notFound } from '@/server/errors'
import {
  educationLevelName,
  getEducationLevel,
} from '@/lib/education-levels'
import { getDoc, newId, queryAllCollection, queryCollection, setDoc, deleteDoc } from '@/server/repositories/firestore-repo'
import type { ClassCreateInput, ClassUpdateInput } from '@/server/validators/school'
import type { SchoolClass, Staff, Stream, Student, StudentClassStats } from '@/types'
import {
  ensureCurrentAcademicCalendar,
  resolveTermForSequence,
} from '@/server/services/academic-calendar-service'
import { assignClassTeacher } from '@/server/services/staff-service'

export type ClassDto = SchoolClass

function normalizeClass(row: SchoolClass): SchoolClass {
  return {
    ...row,
    status: row.status ?? 'ACTIVE',
    level: row.level || educationLevelName(row.educationLevelId) || row.name,
    subjectIds: row.subjectIds ?? [],
  }
}

export async function listClasses(session: SessionContext): Promise<ClassDto[]> {
  requirePermission(session, 'classes.read')
  const rows = await queryAllCollection<SchoolClass>('classes', { max: 400, orderBy: 'name' })
  const normalized = rows.map(normalizeClass)
  if (session.role !== 'TEACHER') return normalized

  const staffId = session.profile.staffId
  if (!staffId) return []
  const { resolveTeacherClassIds } = await import('@/server/authorization/isolation')
  const classIds = new Set(await resolveTeacherClassIds(session))
  return normalized.filter((c) => classIds.has(c.id))
}

export async function getClass(session: SessionContext, id: string): Promise<ClassDto> {
  requirePermission(session, 'classes.read')
  const row = await getDoc<SchoolClass>('classes', id)
  if (!row) throw notFound('Class not found')
  if (session.role === 'TEACHER') {
    const { assertTeacherOwnsClass } = await import('@/server/authorization/isolation')
    await assertTeacherOwnsClass(session, id)
  }
  return normalizeClass(row)
}

export async function createClass(
  session: SessionContext,
  input: ClassCreateInput,
  requestId?: string,
): Promise<ClassDto> {
  requirePermission(session, 'classes.manage')
  const level = getEducationLevel(input.educationLevelId)
  if (!level) throw badRequest('Invalid education level')

  const calendar = await ensureCurrentAcademicCalendar()
  const academicYearId = emptyToUndefined(input.academicYearId) || calendar.year.id

  const termSequence = (input.termSequence ??
    (input.termId
      ? calendar.terms.find((t) => t.id === input.termId)?.sequence
      : undefined) ??
    1) as 1 | 2 | 3

  const term = await resolveTermForSequence(academicYearId, termSequence)

  const id = newId('cls')
  const row: SchoolClass = {
    id,
    name: input.name.trim(),
    educationLevelId: input.educationLevelId,
    level: level.name,
    academicYearId,
    termId: term.id,
    termSequence,
    classTeacherId: emptyToUndefined(input.classTeacherId),
    subjectIds: [...(input.subjectIds ?? [])],
    description: input.description?.trim() || undefined,
    capacity: input.capacity,
    status: input.status ?? 'ACTIVE',
  }
  await setDoc('classes', id, { ...row })

  // Default stream keeps attendance/results compatibility (one stream per class).
  const streamId = newId('str')
  const stream: Stream = {
    id: streamId,
    classId: id,
    name: row.name,
    capacity: input.capacity ?? 40,
  }
  await setDoc('streams', streamId, { ...stream })

  if (row.classTeacherId) {
    await assignClassTeacher(id, undefined, row.classTeacherId)
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'class.create',
    entityType: 'classes',
    entityId: id,
    requestId,
  })
  return normalizeClass(row)
}

function emptyToUndefined(value?: string | null) {
  if (!value || !value.trim()) return undefined
  return value.trim()
}

export async function updateClass(
  session: SessionContext,
  id: string,
  patch: ClassUpdateInput,
  requestId?: string,
): Promise<ClassDto> {
  requirePermission(session, 'classes.manage')
  const current = await getDoc<SchoolClass>('classes', id)
  if (!current) throw notFound('Class not found')

  if (patch.educationLevelId) {
    const level = getEducationLevel(patch.educationLevelId)
    if (!level) throw badRequest('Invalid education level')
  }

  const educationLevelId = patch.educationLevelId ?? current.educationLevelId
  const levelName = educationLevelName(educationLevelId) || current.level

  let academicYearId = patch.academicYearId || current.academicYearId
  let termId = patch.termId === '' ? undefined : (patch.termId ?? current.termId)
  let termSequence = patch.termSequence ?? current.termSequence

  if (patch.termSequence === 1 || patch.termSequence === 2 || patch.termSequence === 3) {
    const calendar = await ensureCurrentAcademicCalendar()
    academicYearId = academicYearId || calendar.year.id
    const term = await resolveTermForSequence(academicYearId, patch.termSequence)
    termId = term.id
    termSequence = patch.termSequence
  }

  const next: SchoolClass = {
    ...current,
    ...patch,
    id,
    name: patch.name?.trim() ?? current.name,
    educationLevelId,
    level: levelName,
    academicYearId,
    termId,
    termSequence,
    classTeacherId:
      patch.classTeacherId === ''
        ? undefined
        : (patch.classTeacherId ?? current.classTeacherId),
    subjectIds: patch.subjectIds ?? current.subjectIds ?? [],
    description: patch.description?.trim() ?? current.description,
    status: patch.status ?? current.status ?? 'ACTIVE',
  }
  await setDoc('classes', id, { ...next })

  if (current.classTeacherId !== next.classTeacherId) {
    await assignClassTeacher(id, current.classTeacherId, next.classTeacherId)
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'class.update',
    entityType: 'classes',
    entityId: id,
    requestId,
    metadata: { fields: Object.keys(patch) },
  })
  return normalizeClass(next)
}

export async function archiveClass(
  session: SessionContext,
  id: string,
  requestId?: string,
): Promise<ClassDto> {
  return updateClass(session, id, { status: 'ARCHIVED' }, requestId)
}

/**
 * Permanently remove a class, its streams, and teacher assignment links.
 * Blocked while any students still reference the class.
 */
export async function deleteClass(
  session: SessionContext,
  id: string,
  requestId?: string,
): Promise<{ deleted: true; id: string }> {
  requirePermission(session, 'classes.manage')
  const current = await getDoc<SchoolClass>('classes', id)
  if (!current) throw notFound('Class not found')

  const students = await queryCollection<Student>('students', { limit: 500 })
  const stillAssigned = students.filter((s) => s.classId === id)
  if (stillAssigned.length > 0) {
    throw badRequest(
      `Cannot delete “${current.name}” — ${stillAssigned.length} student(s) are still in this class. Transfer or reassign them first.`,
    )
  }

  const streams = await queryCollection<Stream>('streams', { limit: 200 })
  await Promise.all(
    streams.filter((s) => s.classId === id).map((s) => deleteDoc('streams', s.id)),
  )

  if (current.classTeacherId) {
    await assignClassTeacher(id, current.classTeacherId, undefined)
  }

  await deleteDoc('classes', id)

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'class.delete',
    entityType: 'classes',
    entityId: id,
    requestId,
    metadata: { name: current.name },
  })

  return { deleted: true, id }
}

/** Prefer the first stream for a class (created automatically with the class). */
export async function getDefaultStreamForClass(classId: string): Promise<Stream | null> {
  const streams = await queryCollection<Stream>('streams', { limit: 100 })
  return streams.find((s) => s.classId === classId) ?? null
}

export async function getStudentClassStats(
  session: SessionContext,
): Promise<StudentClassStats> {
  requirePermission(session, 'students.read')
  const [students, classes] = await Promise.all([
    queryCollection<Student>('students', { limit: 100 }),
    queryCollection<SchoolClass>('classes', { limit: 100 }),
  ])

  const activeClasses = classes.filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE')

  const bandCount = { ECD: 0, PRIMARY: 0, SECONDARY: 0 }
  for (const s of students) {
    if (s.status !== 'ACTIVE') continue
    const cls = classes.find((c) => c.id === s.classId)
    const levelId = s.educationLevelId || cls?.educationLevelId
    const level = getEducationLevel(levelId)
    if (level) bandCount[level.band] += 1
  }

  const classDistribution = activeClasses
    .map((c) => ({
      classId: c.id,
      className: c.name,
      count: students.filter((s) => s.classId === c.id && s.status === 'ACTIVE').length,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    totalStudents: students.length,
    totalClasses: activeClasses.length,
    ecdStudents: bandCount.ECD,
    primaryStudents: bandCount.PRIMARY,
    secondaryStudents: bandCount.SECONDARY,
    activeStudents: students.filter((s) => s.status === 'ACTIVE').length,
    transferredStudents: students.filter((s) => s.status === 'TRANSFERRED').length,
    archivedStudents: students.filter((s) => s.status === 'ARCHIVED' || s.status === 'INACTIVE')
      .length,
    classDistribution,
  }
}

export const listClassesService = listClasses
export const getClassService = getClass
export const createClassService = createClass
export const updateClassService = updateClass
export const archiveClassService = archiveClass
export const deleteClassService = deleteClass
export const getStudentClassStatsService = getStudentClassStats
