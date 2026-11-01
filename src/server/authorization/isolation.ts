import 'server-only'

import { getAdminDb } from '@/lib/firebase/admin'
import type { SessionContext } from '@/server/auth/session'
import { forbidden, notFound } from '@/server/errors'
import type { Guardian, SchoolClass, Staff, Student, Subject } from '@/types'

const FULL_STUDENT_ACCESS = new Set([
  'SUPER_ADMIN',
  'SCHOOL_ADMIN',
  'PRINCIPAL',
  'REGISTRAR',
  'RECEPTIONIST',
  'ACCOUNTANT',
  'FINANCE_OFFICER',
  'LIBRARIAN',
  'TRANSPORT_MANAGER',
])

export async function getStudentOrThrow(id: string): Promise<Student> {
  const snap = await getAdminDb().collection('students').doc(id).get()
  if (!snap.exists) throw notFound('Student not found')
  return { id: snap.id, ...(snap.data() as Omit<Student, 'id'>) }
}

export async function getGuardianOrThrow(id: string): Promise<Guardian> {
  const snap = await getAdminDb().collection('guardians').doc(id).get()
  if (!snap.exists) throw notFound('Guardian not found')
  return { id: snap.id, ...(snap.data() as Omit<Guardian, 'id'>) }
}

async function getStaffForSession(session: SessionContext): Promise<Staff | null> {
  const staffId = session.profile.staffId
  if (!staffId) return null
  const snap = await getAdminDb().collection('staff').doc(staffId).get()
  if (!snap.exists) return null
  return { id: snap.id, ...(snap.data() as Omit<Staff, 'id'>) }
}

/**
 * Classes a teacher may access: subject teaching assignments (classIds)
 * plus classes where they are the class teacher.
 */
export async function resolveTeacherClassIds(session: SessionContext): Promise<string[]> {
  const staff = await getStaffForSession(session)
  if (!staff) return []
  const ids = new Set(staff.classIds ?? [])
  const snap = await getAdminDb().collection('classes').limit(200).get()
  for (const doc of snap.docs) {
    const data = doc.data() as Pick<SchoolClass, 'classTeacherId' | 'status'>
    if ((data.status ?? 'ACTIVE') === 'ARCHIVED') continue
    if (data.classTeacherId === staff.id) ids.add(doc.id)
  }
  return [...ids]
}

/** Classes where this teacher is the appointed class (homeroom) teacher. */
export async function resolveClassTeacherClassIds(session: SessionContext): Promise<string[]> {
  const staff = await getStaffForSession(session)
  if (!staff) return []
  const snap = await getAdminDb().collection('classes').limit(200).get()
  const ids: string[] = []
  for (const doc of snap.docs) {
    const data = doc.data() as Pick<SchoolClass, 'classTeacherId' | 'status'>
    if ((data.status ?? 'ACTIVE') === 'ARCHIVED') continue
    if (data.classTeacherId === staff.id) ids.push(doc.id)
  }
  return ids
}

export async function isClassTeacherOf(
  session: SessionContext,
  classId: string,
): Promise<boolean> {
  if (session.role !== 'TEACHER') return false
  const staffId = session.profile.staffId
  if (!staffId) return false
  const snap = await getAdminDb().collection('classes').doc(classId).get()
  if (!snap.exists) return false
  const data = snap.data() as Pick<SchoolClass, 'classTeacherId' | 'status'>
  if ((data.status ?? 'ACTIVE') === 'ARCHIVED') return false
  return data.classTeacherId === staffId
}

export async function assertIsClassTeacher(
  session: SessionContext,
  classId: string,
): Promise<void> {
  if (session.role !== 'TEACHER') return
  if (!(await isClassTeacherOf(session, classId))) {
    throw forbidden('Only the class teacher can perform this action for this class')
  }
}

/** Subjects assigned on the staff record or listed on the subject.teacherIds. */
export async function resolveTeacherSubjectIds(session: SessionContext): Promise<string[]> {
  const staff = await getStaffForSession(session)
  if (!staff) return []
  const ids = new Set(staff.subjectIds ?? [])
  const snap = await getAdminDb().collection('subjects').limit(200).get()
  for (const doc of snap.docs) {
    const data = doc.data() as Pick<Subject, 'teacherIds' | 'active'>
    if (data.active === false) continue
    if ((data.teacherIds ?? []).includes(staff.id)) ids.add(doc.id)
  }
  return [...ids]
}

/** Ensure session parent is linked to the given student via guardians/{guardianId}. */
export async function assertParentLinked(
  session: SessionContext,
  studentId: string,
): Promise<Guardian> {
  if (session.role !== 'PARENT') {
    throw forbidden('Parent relationship required')
  }
  const guardianId = session.profile.guardianId
  if (!guardianId) throw forbidden('Parent profile is not linked')
  const guardian = await getGuardianOrThrow(guardianId)
  if (!guardian.studentIds.includes(studentId)) {
    throw forbidden('Parent is not linked to this student')
  }
  return guardian
}

/**
 * Server-side relationship check — never trust client parent/student ids alone.
 * Accepts either a student id string or a loaded Student.
 */
export async function assertCanAccessStudent(
  session: SessionContext,
  student: string | Student,
): Promise<Student> {
  const studentId = typeof student === 'string' ? student : student.id
  const loaded =
    typeof student === 'string' ? await getStudentOrThrow(studentId) : student

  if (FULL_STUDENT_ACCESS.has(session.role)) return loaded

  if (session.role === 'TEACHER') {
    const classIds = await resolveTeacherClassIds(session)
    if (!classIds.includes(loaded.classId)) {
      throw forbidden("Teacher is not assigned to this student's class")
    }
    return loaded
  }

  if (session.role === 'STUDENT') {
    if (session.profile.studentId !== studentId) {
      throw forbidden('Student record access denied')
    }
    return loaded
  }

  if (session.role === 'PARENT') {
    await assertParentLinked(session, studentId)
    return loaded
  }

  throw forbidden('Student record access denied')
}

/** Filter an in-memory student list to what the role may see. */
export function filterStudentsForRole(
  session: SessionContext,
  students: Student[],
  linkedStudentIds?: string[],
  teacherClassIds?: string[],
): Student[] {
  if (FULL_STUDENT_ACCESS.has(session.role)) return students

  if (session.role === 'TEACHER') {
    const ids = new Set(teacherClassIds ?? [])
    return students.filter((s) => ids.has(s.classId))
  }

  if (session.role === 'STUDENT') {
    const id = session.profile.studentId
    return id ? students.filter((s) => s.id === id) : []
  }

  if (session.role === 'PARENT') {
    const ids = new Set(linkedStudentIds ?? [])
    return students.filter((s) => ids.has(s.id))
  }

  return []
}

export async function listAccessibleStudents(session: SessionContext): Promise<Student[]> {
  const db = getAdminDb()

  if (session.role === 'STUDENT') {
    if (!session.profile.studentId) return []
    return [await getStudentOrThrow(session.profile.studentId)]
  }

  if (session.role === 'PARENT') {
    if (!session.profile.guardianId) return []
    const guardian = await getGuardianOrThrow(session.profile.guardianId)
    const out: Student[] = []
    for (const id of guardian.studentIds) {
      const snap = await db.collection('students').doc(id).get()
      if (snap.exists) {
        out.push({ id: snap.id, ...(snap.data() as Omit<Student, 'id'>) })
      }
    }
    return out
  }

  if (session.role === 'TEACHER') {
    const classIds = await resolveTeacherClassIds(session)
    if (classIds.length === 0) return []
    const { queryAllCollection } = await import('@/server/repositories/firestore-repo')
    const chunks = await Promise.all(
      classIds.map((classId) =>
        queryAllCollection<Student>('students', {
          max: 400,
          where: [{ field: 'classId', op: '==', value: classId }],
        }),
      ),
    )
    const byId = new Map<string, Student>()
    for (const row of chunks.flat()) byId.set(row.id, row)
    return [...byId.values()]
  }

  const { queryAllCollection } = await import('@/server/repositories/firestore-repo')
  return queryAllCollection<Student>('students', { max: 3000 })
}

/** Teachers may manage students in taught classes and classes they own as class teacher. */
export async function assertTeacherOwnsClass(
  session: SessionContext,
  classId: string,
): Promise<void> {
  if (session.role !== 'TEACHER') return
  const classIds = await resolveTeacherClassIds(session)
  if (!classIds.includes(classId)) {
    throw forbidden('Teacher is not assigned to this class')
  }
}

export async function assertCanAccessInvoiceStudent(
  session: SessionContext,
  studentId: string,
): Promise<Student> {
  return assertCanAccessStudent(session, studentId)
}
