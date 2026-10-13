import 'server-only'

import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import { getStudentOrThrow } from '@/server/authorization/isolation'
import { forbidden, notFound } from '@/server/errors'
import { writeAuditLog } from '@/server/audit/logger'
import { getAdminDb } from '@/lib/firebase/admin'
import { queryCollection, setDoc } from '@/server/repositories/firestore-repo'
import type {
  ClassTimetable,
  SchoolClass,
  Staff,
  Subject,
  TimetableEntry,
  TimetableOptions,
} from '@/types'
import type { TimetableUpsertInput } from '@/server/validators/timetable'

export async function listTimetablesForSession(
  session: SessionContext,
  classId?: string,
): Promise<ClassTimetable[]> {
  if (session.role === 'STUDENT') {
    if (!session.profile.studentId) throw forbidden('Student profile is not linked')
    const student = await getStudentOrThrow(session.profile.studentId)
    const timetable = await readTimetable(student.classId)
    return timetable?.audience.includes('STUDENTS') ? [timetable] : []
  }

  if (session.role === 'TEACHER') {
    const staffId = session.profile.staffId
    if (!staffId) return []
    const schedules = await queryCollection<ClassTimetable>('timetables', {
      limit: 100,
      where: [{ field: 'audience', op: 'array-contains', value: 'TEACHERS' }],
    })
    return schedules
      .filter((schedule) => schedule.status === 'PUBLISHED')
      .map((schedule) => ({
        ...schedule,
        entries: schedule.entries.filter((entry) => entry.teacherId === staffId),
      }))
      .filter((schedule) => schedule.entries.length > 0)
  }

  requirePermission(session, 'classes.read')
  const canManage = session.permissions.includes('classes.manage')
  if (classId) {
    const schedule = await readTimetable(classId)
    return schedule && (canManage || schedule.audience.includes('STUDENTS')) ? [schedule] : []
  }
  const schedules = await queryCollection<ClassTimetable>('timetables', {
    limit: 100,
    where: [{ field: 'status', op: '==', value: 'PUBLISHED' }],
  })
  return canManage ? schedules : schedules.filter((schedule) => schedule.audience.includes('STUDENTS'))
}

export async function getTimetableOptions(session: SessionContext): Promise<TimetableOptions> {
  requirePermission(session, 'classes.manage')
  const [classes, subjects, staff] = await Promise.all([
    queryCollection<SchoolClass>('classes', { limit: 100, orderBy: 'name' }),
    queryCollection<Subject>('subjects', { limit: 100, orderBy: 'name' }),
    queryCollection<Staff>('staff', { limit: 100, orderBy: 'firstName' }),
  ])
  return {
    classes: classes.filter((item) => item.status !== 'ARCHIVED'),
    subjects: subjects.filter((item) => item.active !== false),
    teachers: staff.filter(
      (item) =>
        item.status === 'ACTIVE' &&
        (item.category === 'TEACHER' || item.accountRole === 'TEACHER'),
    ),
  }
}

export async function publishTimetable(
  session: SessionContext,
  input: TimetableUpsertInput,
  requestId?: string,
): Promise<ClassTimetable> {
  requirePermission(session, 'classes.manage')

  const db = getAdminDb()
  const subjectIds = [...new Set(input.entries.map((entry) => entry.subjectId))]
  const staffIds = [...new Set(input.entries.map((entry) => entry.teacherId))]
  const refs = [
    db.collection('classes').doc(input.classId),
    ...subjectIds.map((id) => db.collection('subjects').doc(id)),
    ...staffIds.map((id) => db.collection('staff').doc(id)),
  ]
  const snapshots = await db.getAll(...refs)
  const classSnap = snapshots[0]
  if (!classSnap?.exists) throw notFound('Class not found')
  const klass = { id: classSnap.id, ...classSnap.data() } as SchoolClass
  if (klass.status === 'ARCHIVED') throw forbidden('Cannot publish a timetable for an archived class')

  const subjects = new Map<string, Subject>()
  subjectIds.forEach((id, index) => {
    const snap = snapshots[1 + index]
    if (!snap?.exists) throw notFound(`Subject ${id} not found`)
    const subject = { id: snap.id, ...snap.data() } as Subject
    if (subject.active === false) throw forbidden(`Subject ${subject.name} is inactive`)
    if (klass.subjectIds?.length && !klass.subjectIds.includes(id)) {
      throw forbidden(`${subject.name} is not assigned to ${klass.name}`)
    }
    subjects.set(id, subject)
  })
  const staffOffset = 1 + subjectIds.length
  const teachers = new Map<string, Staff>()
  staffIds.forEach((id, index) => {
    const snap = snapshots[staffOffset + index]
    if (!snap?.exists) throw notFound(`Teacher ${id} not found`)
    const teacher = { id: snap.id, ...snap.data() } as Staff
    if (
      teacher.status !== 'ACTIVE' ||
      (teacher.category !== 'TEACHER' && teacher.accountRole !== 'TEACHER')
    ) {
      throw forbidden(`Selected teacher ${teacher.firstName} ${teacher.lastName} is not active`)
    }
    teachers.set(id, teacher)
  })

  const entries: TimetableEntry[] = input.entries.map((entry) => {
    const subject = subjects.get(entry.subjectId)!
    const teacher = teachers.get(entry.teacherId)!
    return {
      ...entry,
      id: entry.id ?? crypto.randomUUID(),
      subjectName: subject.name,
      teacherName: `${teacher.firstName} ${teacher.lastName}`.trim(),
    }
  })
  const timetable: ClassTimetable = {
    id: klass.id,
    classId: klass.id,
    className: klass.name,
    audience: input.audience,
    status: 'PUBLISHED',
    entries,
    updatedAt: new Date().toISOString(),
    updatedBy: session.uid,
  }
  await setDoc('timetables', timetable.id, timetable)
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    actorName: session.profile.name,
    actorEmail: session.email,
    action: 'timetable.publish',
    entityType: 'timetables',
    entityId: timetable.id,
    requestId,
    metadata: { classId: timetable.classId, audiences: timetable.audience, entries: entries.length },
  })
  return timetable
}

async function readTimetable(classId: string): Promise<ClassTimetable | null> {
  const snap = await getAdminDb().collection('timetables').doc(classId).get()
  if (!snap.exists) return null
  const timetable = { id: snap.id, ...snap.data() } as ClassTimetable
  return timetable.status === 'PUBLISHED' ? timetable : null
}
