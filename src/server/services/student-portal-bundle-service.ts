import 'server-only'

import { getAdminDb } from '@/lib/firebase/admin'
import { educationLevelName } from '@/lib/education-levels'
import type { SessionContext } from '@/server/auth/session'
import { getStudentOrThrow } from '@/server/authorization/isolation'
import { forbidden } from '@/server/errors'
import { queryCollection } from '@/server/repositories/firestore-repo'
import { listInvoices, listPayments, resolveBillingTerm } from '@/server/services/finance-service'
import { getGradingScaleForEducationLevel, gradeFromScore } from '@/server/services/grading-service'
import { getResultsPortal } from '@/server/services/results-service'
import { getFeePolicy, getSchoolProfile } from '@/server/services/school-settings-service'
import type {
  Announcement,
  Assessment,
  AttendanceRecord,
  ClassTeacherReport,
  ClubActivity,
  GradingScale,
  Guardian,
  House,
  Mark,
  ResultPortalView,
  SchoolClass,
  SchoolProfile,
  Sport,
  Staff,
  Stream,
  StudentPortalAttendance,
  StudentPortalBundle,
  StudentPortalDocument,
  StudentPortalExam,
  StudentPortalFees,
  StudentPortalSubject,
  StudentResultPeriod,
  StudentResultRow,
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

type Academics = {
  assessments: Assessment[]
  markByAssessment: Map<string, Mark>
  subjectName: Map<string, string>
  terms: Term[]
}

async function loadAcademics(studentId: string, classId: string, streamId: string): Promise<Academics> {
  const db = getAdminDb()
  const [byClass, byStream, marksSnap, terms] = await Promise.all([
    classId
      ? db.collection('assessments').where('classId', '==', classId).limit(300).get()
      : Promise.resolve(null),
    streamId
      ? db.collection('assessments').where('streamId', '==', streamId).limit(300).get()
      : Promise.resolve(null),
    db.collection('marks').where('studentId', '==', studentId).limit(500).get(),
    queryCollection<Term>('terms', { limit: 100 }),
  ])
  const assessments = new Map<string, Assessment>()
  for (const doc of [...(byClass?.docs ?? []), ...(byStream?.docs ?? [])]) {
    assessments.set(doc.id, { id: doc.id, ...(doc.data() as Omit<Assessment, 'id'>) })
  }
  const markByAssessment = new Map<string, Mark>()
  for (const doc of marksSnap.docs) {
    const m = doc.data() as Mark
    markByAssessment.set(m.assessmentId, m)
  }
  const subjects = await getMany<Subject>('subjects', [...assessments.values()].map((a) => a.subjectId))
  return {
    assessments: [...assessments.values()],
    markByAssessment,
    subjectName: new Map(subjects.map((s) => [s.id, s.name])),
    terms,
  }
}

const isReleased = (status: string | undefined) => status === 'PUBLISHED' || status === 'LOCKED'

function buildExams(ac: Academics, canSeeScores: boolean): StudentPortalExam[] {
  const termName = new Map(ac.terms.map((t) => [t.id, t.name]))
  return ac.assessments
    .map((a): StudentPortalExam => {
      const out = isReleased(a.status)
      const mark = ac.markByAssessment.get(a.id)
      return {
        id: a.id,
        name: a.name,
        subject: ac.subjectName.get(a.subjectId) ?? 'Subject',
        type: a.type,
        termName: termName.get(a.termId),
        month: a.month,
        maxScore: a.maxScore,
        status: out ? 'RESULTS_OUT' : 'MARKING',
        ...(out && mark && isReleased(mark.status) && canSeeScores
          ? { score: mark.score, grade: mark.grade }
          : {}),
      }
    })
    .sort((a, b) => (b.month ?? '').localeCompare(a.month ?? '') || a.subject.localeCompare(b.subject))
}

type ResultEntry = {
  subject: string
  score: number
  maxScore: number
  grade: string
  comment?: string
  teacherName?: string
  at: string
}

function monthLabel(month: string) {
  const date = new Date(`${month}-01T12:00:00Z`)
  return Number.isNaN(date.getTime())
    ? month
    : date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/**
 * Per-subject rows for a set of marks. Several marks for one subject are averaged
 * by percentage (each test or term weighs the same) and re-graded on the school scale.
 */
function summarize(entries: ResultEntry[], scale: GradingScale) {
  const bySubject = new Map<string, ResultEntry[]>()
  for (const e of entries) bySubject.set(e.subject, [...(bySubject.get(e.subject) ?? []), e])
  const rows: StudentResultRow[] = [...bySubject.entries()]
    .map(([subject, list]) => {
      const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at))
      const percents = sorted.map((e) => (e.score / e.maxScore) * 100)
      const percent = percents.reduce((s, p) => s + p, 0) / percents.length
      const single = sorted.length === 1 ? sorted[0] : null
      return {
        subject,
        score: single ? single.score : Math.round(percent * 10) / 10,
        maxScore: single ? single.maxScore : 100,
        percent,
        grade: single ? single.grade : gradeFromScore(percent, 100, scale),
        teacherName: [...sorted].reverse().find((e) => e.teacherName)?.teacherName,
        comment: [...sorted].reverse().find((e) => e.comment?.trim())?.comment?.trim(),
      }
    })
    .sort((a, b) => a.subject.localeCompare(b.subject))
  const average = rows.length ? rows.reduce((s, r) => s + r.percent, 0) / rows.length : undefined
  return {
    rows,
    average,
    averageGrade: average != null ? gradeFromScore(average, 100, scale) : undefined,
  }
}

function buildResultPeriods(
  ac: Academics,
  opts: {
    scale: GradingScale
    termComments: Map<string, string>
    teachersFor: (subjectId: string) => string | undefined
  },
): StudentResultPeriod[] {
  const monthOf = (a: Assessment) =>
    (a.type === 'WEEKLY' ? (a.weekOf ?? a.month) : a.month)?.slice(0, 7)
  const monthly = new Map<string, ResultEntry[]>()
  const termly = new Map<string, ResultEntry[]>()

  for (const a of ac.assessments) {
    if (!isReleased(a.status) || !(a.maxScore > 0)) continue
    const mark = ac.markByAssessment.get(a.id)
    if (!mark || !isReleased(mark.status)) continue
    const entry: ResultEntry = {
      subject: ac.subjectName.get(a.subjectId) ?? 'Subject',
      score: mark.score,
      maxScore: a.maxScore,
      grade: mark.grade,
      comment: mark.comment,
      teacherName: a.enteredByName || opts.teachersFor(a.subjectId),
      at: mark.recordedAt ?? a.approvedAt ?? a.submittedAt ?? '',
    }
    if (a.type === 'TERMLY') {
      termly.set(a.termId, [...(termly.get(a.termId) ?? []), entry])
      continue
    }
    const month = monthOf(a)
    if (month && /^\d{4}-\d{2}$/.test(month)) monthly.set(month, [...(monthly.get(month) ?? []), entry])
  }

  const termById = new Map(ac.terms.map((t) => [t.id, t]))
  const termForMonth = (month: string) =>
    ac.terms.find((t) => t.startDate?.slice(0, 7) <= month && month <= (t.endDate?.slice(0, 7) ?? ''))
  const termYear = (t: Term) => t.startDate?.slice(0, 4) ?? ''
  const termLabel = (t: Term) => {
    const year = termYear(t)
    return year && !t.name.includes(year) ? `${t.name} ${year}` : t.name
  }

  const periods: StudentResultPeriod[] = []

  for (const [month, entries] of monthly) {
    periods.push({
      id: `month:${month}`,
      kind: 'MONTH',
      label: monthLabel(month),
      year: month.slice(0, 4),
      sortKey: month,
      basis: 'Monthly tests',
      classTeacherComment: opts.termComments.get(termForMonth(month)?.id ?? ''),
      ...summarize(entries, opts.scale),
    })
  }

  const termIds = new Set([...termly.keys()])
  for (const month of monthly.keys()) {
    const t = termForMonth(month)
    if (t) termIds.add(t.id)
  }
  const termPeriods: StudentResultPeriod[] = []
  for (const termId of termIds) {
    const term = termById.get(termId)
    const exams = termly.get(termId)
    const entries =
      exams ??
      (term
        ? [...monthly.entries()]
            .filter(([m]) => termForMonth(m)?.id === termId)
            .flatMap(([, list]) => list)
        : [])
    if (entries.length === 0) continue
    const year = term ? termYear(term) : (entries[0]?.at.slice(0, 4) ?? '')
    termPeriods.push({
      id: `term:${termId}`,
      kind: 'TERM',
      label: term ? termLabel(term) : 'Term results',
      year,
      sortKey: term?.startDate ?? `${year}-${termId}`,
      basis: exams ? 'End-of-term examinations' : 'Average of monthly tests',
      classTeacherComment: opts.termComments.get(termId),
      ...summarize(entries, opts.scale),
    })
  }
  periods.push(...termPeriods)

  const years = new Set(periods.map((p) => p.year).filter(Boolean))
  for (const year of years) {
    const terms = termPeriods
      .filter((p) => p.year === year)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    const entries: ResultEntry[] = terms.length
      ? terms.flatMap((p) =>
          p.rows.map((r) => ({
            subject: r.subject,
            score: r.percent,
            maxScore: 100,
            grade: r.grade,
            comment: r.comment,
            teacherName: r.teacherName,
            at: p.sortKey,
          })),
        )
      : [...monthly.entries()].filter(([m]) => m.startsWith(year)).flatMap(([, list]) => list)
    if (entries.length === 0) continue
    periods.push({
      id: `year:${year}`,
      kind: 'YEAR',
      label: year,
      year,
      sortKey: year,
      basis: terms.length
        ? `Average of ${terms.map((t) => t.label.replace(` ${year}`, '')).join(', ')}`
        : 'Average of monthly tests',
      classTeacherComment: [...terms].reverse().find((t) => t.classTeacherComment)?.classTeacherComment,
      ...summarize(entries, opts.scale),
    })
  }

  return periods.sort((a, b) => b.sortKey.localeCompare(a.sortKey))
}

async function loadTermComments(studentId: string) {
  const snap = await getAdminDb()
    .collection('classTeacherReports')
    .where('studentId', '==', studentId)
    .limit(100)
    .get()
  const comments = new Map<string, string>()
  for (const doc of snap.docs) {
    const r = doc.data() as ClassTeacherReport
    if (r.termId && r.comment?.trim()) comments.set(r.termId, r.comment.trim())
  }
  return comments
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
  let resultsLoaded = true
  const results = await getResultsPortal(session, studentId).catch(() => {
    resultsLoaded = false
    return emptyResults
  })
  const resultsOpen =
    resultsLoaded &&
    results.accessState !== 'RESULTS_LOCKED_FEES' &&
    results.accessState !== 'ACCOUNT_RESTRICTED'

  const [attendance, fees, academics, termComments, scale, school, announcements, documents] =
    await Promise.all([
      optional(() => loadAttendance(studentId, term), summarizeAttendance([], null)),
      loadFees(session, studentId),
      optional<Academics | null>(
        () => loadAcademics(studentId, student.classId, student.streamId),
        null,
      ),
      resultsOpen
        ? optional(() => loadTermComments(studentId), new Map<string, string>())
        : new Map<string, string>(),
      optional<GradingScale | null>(() => getGradingScaleForEducationLevel(levelId), null),
      optional<SchoolProfile | null>(getSchoolProfile, null),
      optional(loadAnnouncements, []),
      optional(() => loadDocuments(studentId), []),
    ])

  const teachersFor = (subjectId: string) =>
    classStaff
      .filter((st) => st.subjectIds?.includes(subjectId))
      .map(staffName)
      .join(', ') || undefined
  let resultPeriods: StudentResultPeriod[] = []
  if (resultsOpen && academics && scale) {
    try {
      resultPeriods = buildResultPeriods(academics, { scale, termComments, teachersFor })
    } catch {
      resultPeriods = []
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    school: {
      name: school?.name || 'Viste High School',
      motto: school?.motto,
      address: school?.address || undefined,
      phone: school?.phone || undefined,
      email: school?.email || undefined,
    },
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
    resultPeriods,
    fees,
    exams: academics ? buildExams(academics, resultsOpen) : [],
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
