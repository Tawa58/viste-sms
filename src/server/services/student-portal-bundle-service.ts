import 'server-only'

import { getAdminDb } from '@/lib/firebase/admin'
import { educationLevelName } from '@/lib/education-levels'
import type { SessionContext } from '@/server/auth/session'
import { getStudentOrThrow } from '@/server/authorization/isolation'
import { forbidden } from '@/server/errors'
import { queryCollection } from '@/server/repositories/firestore-repo'
import { listInvoices, listPayments, resolveBillingTerm } from '@/server/services/finance-service'
import { getResultsPortal } from '@/server/services/results-service'
import { getFeePolicy } from '@/server/services/school-settings-service'
import type {
  Announcement,
  Assessment,
  AttendanceRecord,
  ClubActivity,
  Guardian,
  House,
  Mark,
  ResultPortalView,
  SchoolClass,
  Sport,
  Staff,
  Stream,
  StudentPortalAttendance,
  StudentPortalBundle,
  StudentPortalDocument,
  StudentPortalExam,
  StudentPortalFees,
  StudentPortalSubject,
  Subject,
  Term,
} from '@/types'
import type { StoredFileMetadata } from '@/services/files/types'

const STUDENT_AUDIENCES = new Set(['all', 'everyone', 'students', 'student', 'school'])

async function getMany<T extends { id: string }>(collection: string, ids: (string | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
  if (unique.length === 0) return [] as T[]
  const db = getAdminDb()
  const snaps = await db.getAll(...unique.map((id) => db.collection(collection).doc(id)))
  return snaps
    .filter((s) => s.exists)
    .map((s) => ({ id: s.id, ...(s.data() as Omit<T, 'id'>) }) as T)
}

async function getOne<T extends { id: string }>(collection: string, id: string | undefined) {
  const [row] = await getMany<T>(collection, [id])
  return row ?? null
}

function staffName(s: Pick<Staff, 'firstName' | 'lastName'>) {
  return `${s.firstName} ${s.lastName}`.trim()
}

async function optional<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load()
  } catch {
    return fallback
  }
}

function summarizeAttendance(
  records: StudentPortalAttendance['records'],
  term: Term | null,
): StudentPortalAttendance {
  const inTerm = term
    ? records.filter((r) => r.date >= term.startDate && r.date <= term.endDate)
    : records
  const counted = inTerm.length > 0 ? inTerm : records
  let present = 0
  let late = 0
  let absent = 0
  let excused = 0
  for (const r of counted) {
    if (r.status === 'PRESENT') present++
    else if (r.status === 'LATE') late++
    else if (r.status === 'ABSENT') absent++
    else excused++
  }
  const total = present + late + absent + excused
  return {
    records,
    present,
    late,
    absent,
    excused,
    rate: total > 0 ? ((present + late) / total) * 100 : null,
  }
}

async function loadAttendance(studentId: string, term: Term | null) {
  const snap = await getAdminDb()
    .collection('attendance')
    .where('studentId', '==', studentId)
    .limit(500)
    .get()
  const byDate = new Map<string, StudentPortalAttendance['records'][number]>()
  for (const doc of snap.docs) {
    const r = doc.data() as AttendanceRecord
    const daily = r.kind === 'DAILY' || (!r.kind && !r.subjectId)
    if (!daily || !r.date) continue
    byDate.set(r.date, { date: r.date, status: r.status })
  }
  const records = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
  return summarizeAttendance(records, term)
}

async function loadFees(session: SessionContext, studentId: string): Promise<StudentPortalFees> {
  const [invoices, payments, policy] = await Promise.all([
    listInvoices(session, studentId),
    listPayments(session, studentId),
    getFeePolicy(),
  ])
  const billed = invoices.reduce((sum, i) => sum + (i.total || 0), 0)
  const paid = invoices.reduce((sum, i) => sum + (i.paid || 0), 0)
  const balance = Math.max(0, billed - paid)
  const nextDueDate = invoices
    .filter((i) => i.total - i.paid > 0 && i.dueDate)
    .map((i) => i.dueDate)
    .sort()[0]
  return {
    currency: policy.currency,
    invoices: [...invoices].sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? '')),
    payments: [...payments].sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? '')),
    billed,
    paid,
    balance,
    cleared: balance <= 0,
    nextDueDate,
  }
}

async function loadExams(
  studentId: string,
  classId: string,
  streamId: string,
  results: ResultPortalView,
): Promise<StudentPortalExam[]> {
  const db = getAdminDb()
  const [byClass, byStream, marksSnap] = await Promise.all([
    db.collection('assessments').where('classId', '==', classId).limit(300).get(),
    streamId
      ? db.collection('assessments').where('streamId', '==', streamId).limit(300).get()
      : Promise.resolve(null),
    db.collection('marks').where('studentId', '==', studentId).limit(500).get(),
  ])
  const assessments = new Map<string, Assessment>()
  for (const doc of [...byClass.docs, ...(byStream?.docs ?? [])]) {
    assessments.set(doc.id, { id: doc.id, ...(doc.data() as Omit<Assessment, 'id'>) })
  }
  if (assessments.size === 0) return []

  const markByAssessment = new Map<string, Mark>()
  for (const doc of marksSnap.docs) {
    const m = doc.data() as Mark
    markByAssessment.set(m.assessmentId, m)
  }

  const [subjects, terms] = await Promise.all([
    getMany<Subject>('subjects', [...assessments.values()].map((a) => a.subjectId)),
    getMany<Term>('terms', [...assessments.values()].map((a) => a.termId)),
  ])
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]))
  const termName = new Map(terms.map((t) => [t.id, t.name]))
  const canSeeScores = results.accessState === 'RESULTS_AVAILABLE'

  return [...assessments.values()]
    .map((a): StudentPortalExam => {
      const out = a.status === 'PUBLISHED' || a.status === 'LOCKED'
      const mark = markByAssessment.get(a.id)
      const markOut = mark && (mark.status === 'PUBLISHED' || mark.status === 'LOCKED')
      return {
        id: a.id,
        name: a.name,
        subject: subjectName.get(a.subjectId) ?? 'Subject',
        type: a.type,
        termName: termName.get(a.termId),
        month: a.month,
        maxScore: a.maxScore,
        status: out ? 'RESULTS_OUT' : 'MARKING',
        ...(out && markOut && canSeeScores ? { score: mark.score, grade: mark.grade } : {}),
      }
    })
    .sort((a, b) => (b.month ?? '').localeCompare(a.month ?? '') || a.subject.localeCompare(b.subject))
}

async function loadDocuments(studentId: string): Promise<StudentPortalDocument[]> {
  const snap = await getAdminDb()
    .collection('files')
    .where('ownerType', '==', 'student')
    .where('ownerId', '==', studentId)
    .limit(100)
    .get()
  return snap.docs
    .map((doc) => ({ ...(doc.data() as StoredFileMetadata), id: doc.id }))
    .filter((f) => f.status === 'active' && f.fileType !== 'profile_photo')
    .map((f) => ({
      id: f.id,
      fileName: f.fileName,
      mimeType: f.mimeType,
      fileType: f.fileType,
      sizeBytes: f.sizeBytes,
      uploadedAt: f.uploadedAt,
    }))
    .sort((a, b) => (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? ''))
}

async function loadAnnouncements(): Promise<Announcement[]> {
  const rows = await queryCollection<Announcement>('announcements', { limit: 100 })
  return rows
    .filter((a) => a.status === 'PUBLISHED')
    .filter(
      (a) =>
        !a.audience?.length ||
        a.audience.some((x) => STUDENT_AUDIENCES.has(String(x).trim().toLowerCase())),
    )
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, 30)
}

/** Everything the signed-in student's portal shows — never another student's data. */
export async function getStudentPortalBundle(session: SessionContext): Promise<StudentPortalBundle> {
  if (session.role !== 'STUDENT') throw forbidden('The student portal is for students only')
  const studentId = session.profile.studentId
  if (!studentId) throw forbidden('Your account is not linked to a student record')

  const student = await getStudentOrThrow(studentId)

  const [klass, stream, term, guardians, house, sports, clubs, classStaffSnap] = await Promise.all([
    getOne<SchoolClass>('classes', student.classId),
    getOne<Stream>('streams', student.streamId),
    optional<Term | null>(() => resolveBillingTerm(), null),
    getMany<Guardian>('guardians', student.guardianIds ?? []),
    getOne<House>('houses', student.houseId),
    getMany<Sport>('sports', student.sportIds ?? []),
    getMany<ClubActivity>('clubs', student.clubIds ?? []),
    student.classId
      ? getAdminDb().collection('staff').where('classIds', 'array-contains', student.classId).limit(100).get()
      : Promise.resolve(null),
  ])

  const classStaff = (classStaffSnap?.docs ?? []).map(
    (d) => ({ id: d.id, ...(d.data() as Omit<Staff, 'id'>) }) as Staff,
  )
  const subjectIds = student.subjectIds?.length ? student.subjectIds : (klass?.subjectIds ?? [])

  const [subjectDocs, classTeacher, coaches] = await Promise.all([
    getMany<Subject>('subjects', subjectIds),
    klass?.classTeacherId
      ? classStaff.find((s) => s.id === klass.classTeacherId) ??
        getOne<Staff>('staff', klass.classTeacherId)
      : null,
    getMany<Staff>('staff', sports.map((s) => s.coachStaffId)),
  ])
  const coachName = new Map(coaches.map((c) => [c.id, staffName(c)]))

  const subjects: StudentPortalSubject[] = subjectDocs
    .map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      category: s.category,
      teachers: classStaff
        .filter((st) => st.subjectIds?.includes(s.id) || s.teacherIds?.includes(st.id))
        .map(staffName),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const className = klass?.name ?? 'Unassigned class'
  const streamName =
    stream?.name && !className.toLowerCase().includes(stream.name.toLowerCase())
      ? stream.name
      : undefined
  const levelId = student.educationLevelId ?? klass?.educationLevelId

  const emptyResults: ResultPortalView = {
    studentId: student.id,
    studentName: `${student.firstName} ${student.lastName}`,
    className,
    streamName: stream?.name ?? '',
    academicYear: klass?.academicYearId ?? '',
    term: term?.name ?? '',
    accessState: 'RESULTS_NOT_PUBLISHED',
    subjects: [],
  }
  const results = await optional(() => getResultsPortal(session, studentId), emptyResults)

  const [attendance, fees, exams, announcements, documents] = await Promise.all([
    optional(() => loadAttendance(studentId, term), summarizeAttendance([], null)),
    loadFees(session, studentId),
    optional(() => loadExams(studentId, student.classId, student.streamId, results), []),
    optional(loadAnnouncements, []),
    optional(() => loadDocuments(studentId), []),
  ])

  return {
    generatedAt: new Date().toISOString(),
    profile: {
      id: student.id,
      studentNumber: student.studentNumber,
      admissionNumber: student.admissionNumber,
      firstName: student.firstName,
      middleName: student.middleName,
      lastName: student.lastName,
      dateOfBirth: student.dateOfBirth,
      gender: student.gender,
      email: student.email,
      phone: student.phone,
      address: student.address,
      admissionDate: student.admissionDate,
      status: student.status,
      residency: student.residency ?? 'DAY',
      profilePhotoId: student.profilePhotoId,
      className,
      levelName: levelId ? educationLevelName(levelId) : undefined,
      streamName,
      classTeacherName: classTeacher ? staffName(classTeacher) : undefined,
      houseName: house?.name,
      guardians: guardians.map((g) => ({
        name: `${g.firstName} ${g.lastName}`.trim(),
        relationship: g.relationship,
        phone: g.phone,
        email: g.email,
        emergencyContact: g.emergencyContact,
      })),
    },
    term: term
      ? { id: term.id, name: term.name, startDate: term.startDate, endDate: term.endDate }
      : null,
    subjects,
    attendance,
    results,
    fees,
    exams,
    announcements,
    documents,
    activities: {
      sports: sports
        .filter((s) => s.active !== false)
        .map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          coachName: s.coachStaffId ? coachName.get(s.coachStaffId) : undefined,
        })),
      clubs: clubs
        .filter((c) => c.active !== false)
        .map((c) => ({ id: c.id, name: c.name, type: c.type, description: c.description })),
      house: house ? { name: house.name, color: house.color } : undefined,
    },
  }
}
