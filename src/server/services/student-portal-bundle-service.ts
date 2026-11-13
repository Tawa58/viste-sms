import 'server-only'

import { getAdminDb } from '@/lib/firebase/admin'
import { educationLevelName } from '@/lib/education-levels'
import { isEcdClass, isEcdEducationLevel, isEcdReleasedToPortal } from '@/lib/ecd-checklist'
import type { SessionContext } from '@/server/auth/session'
import { getStudentOrThrow } from '@/server/authorization/isolation'
import { forbidden } from '@/server/errors'
import { queryCollection } from '@/server/repositories/firestore-repo'
import {
  isFeeCleared,
  listInvoices,
  listPayments,
  resolveBillingTerm,
} from '@/server/services/finance-service'
import { getGradingScaleForEducationLevel, gradeFromScore } from '@/server/services/grading-service'
import { formatMarkComponents } from '@/lib/exam-papers'
import { formatUnitGrade, isPrimaryUnitBands, isUnitsScale, unitsFromScore } from '@/lib/grading'
import { currentMonthPeriod, invoiceBalance, invoicesForBillingPeriod } from '@/lib/fees'
import { getResultsPortal } from '@/server/services/results-service'
import { getFeePolicy, getSchoolProfile } from '@/server/services/school-settings-service'
import type {
  Announcement,
  Assessment,
  AttendanceRecord,
  ClassTeacherReport,
  ClubActivity,
  EcdChecklist,
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
  StudentResultPaper,
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

async function loadFees(
  session: SessionContext,
  studentId: string,
  term: Term | null,
): Promise<StudentPortalFees> {
  const [invoices, payments, policy] = await Promise.all([
    listInvoices(session, studentId),
    listPayments(session, studentId),
    getFeePolicy(),
  ])
  const payableInvoices = invoicesForBillingPeriod(invoices, term?.id, currentMonthPeriod())
  const billed = payableInvoices.reduce((sum, i) => sum + (i.total || 0), 0)
  const paid = payableInvoices.reduce((sum, i) => sum + (i.paid || 0), 0)
  const scholarshipAmount = payableInvoices.reduce(
    (sum, i) => sum + (i.scholarshipAmount || 0),
    0,
  )
  const balance = payableInvoices.reduce((sum, i) => sum + invoiceBalance(i), 0)
  const nextDueDate = payableInvoices
    .filter((i) => invoiceBalance(i) > 0 && i.dueDate)
    .map((i) => i.dueDate)
    .sort()[0]
  return {
    currency: policy.currency,
    invoices: [...invoices].sort((a, b) => (b.dueDate ?? '').localeCompare(a.dueDate ?? '')),
    payments: [...payments].sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? '')),
    billed,
    paid,
    scholarshipAmount,
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
        ...(out && mark && canSeeScores
          ? {
              score: mark.score,
              grade: mark.grade,
              breakdown: formatMarkComponents(mark.components) || undefined,
            }
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
      const averagedUnits =
        !isPrimaryUnitBands(scale.bands) && isUnitsScale(scale)
          ? Math.floor(
              sorted.reduce(
                (sum, e) => sum + unitsFromScore(e.score, scale.marksPerUnit, e.maxScore),
                0,
              ) / sorted.length,
            )
          : null
      return {
        subject,
        score: single ? single.score : Math.round(percent * 10) / 10,
        maxScore: single ? single.maxScore : 100,
        percent,
        grade: single
          ? single.grade
          : averagedUnits != null
            ? formatUnitGrade(averagedUnits)
            : gradeFromScore(percent, 100, scale),
        teacherName: [...sorted].reverse().find((e) => e.teacherName)?.teacherName,
        comment: [...sorted].reverse().find((e) => e.comment?.trim())?.comment?.trim(),
      }
    })
    .sort((a, b) => a.subject.localeCompare(b.subject))
  const average = rows.length ? rows.reduce((s, r) => s + r.percent, 0) / rows.length : undefined
  return {
    rows,
    average,
        averageGrade:
      average == null
        ? undefined
        : isPrimaryUnitBands(scale.bands)
          ? gradeFromScore(average, 100, scale)
          : isUnitsScale(scale)
            ? formatUnitGrade(
                Math.floor(
                  rows.reduce((sum, r) => {
                    const n = Number(String(r.grade).match(/\d+/)?.[0])
                    return sum + (Number.isFinite(n) ? n : 0)
                  }, 0) / rows.length,
                ),
              )
            : gradeFromScore(average, 100, scale),
  }
}

const RESULT_CATEGORIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'MOCK', 'TERMLY'] as const

const CATEGORY_COPY: Record<
  (typeof RESULT_CATEGORIES)[number],
  { label: string; basis: string }
> = {
  DAILY: { label: 'Daily exercises', basis: 'Daily exercises' },
  WEEKLY: { label: 'Weekly tests', basis: 'Weekly tests' },
  MONTHLY: { label: 'Monthly tests', basis: 'Monthly tests' },
  MOCK: { label: 'Mock tests', basis: 'Mock tests' },
  TERMLY: { label: 'End of term tests', basis: 'End of term tests' },
}

function isResultCategory(type: string): type is (typeof RESULT_CATEGORIES)[number] {
  return (RESULT_CATEGORIES as readonly string[]).includes(type)
}

function sittingDate(a: Assessment) {
  if (a.type === 'DAILY') return a.date
  if (a.type === 'WEEKLY') return a.weekOf ?? a.date
  if (a.type === 'TERMLY') return a.date
  return a.month
}

function buildResultPeriods(
  ac: Academics,
  opts: {
    scale: GradingScale
    termComments: Map<string, string>
    teachersFor: (subjectId: string) => string | undefined
  },
): StudentResultPeriod[] {
  const grouped = new Map<(typeof RESULT_CATEGORIES)[number], StudentResultPaper[]>()
  let termlyTermId = ''

  for (const a of ac.assessments) {
    if (!isReleased(a.status) || !(a.maxScore > 0) || !isResultCategory(a.type)) continue
    const mark = ac.markByAssessment.get(a.id)
    if (!mark) continue
    if (a.type === 'TERMLY' && a.termId) termlyTermId = a.termId
    const paper: StudentResultPaper = {
      id: a.id,
      subject: ac.subjectName.get(a.subjectId) ?? 'Subject',
      title: a.name,
      satOn: sittingDate(a),
      publishedAt: a.approvedAt,
      score: mark.score,
      maxScore: a.maxScore,
      percent: a.maxScore > 0 ? (mark.score / a.maxScore) * 100 : 0,
      grade: mark.grade,
      breakdown: formatMarkComponents(mark.components) || undefined,
      teacherName: a.enteredByName || opts.teachersFor(a.subjectId),
      comment: mark.comment,
    }
    grouped.set(a.type, [...(grouped.get(a.type) ?? []), paper])
  }

  const periods: StudentResultPeriod[] = []
  for (const kind of RESULT_CATEGORIES) {
    const papers = (grouped.get(kind) ?? []).sort(
      (a, b) =>
        (b.publishedAt || b.satOn || '').localeCompare(a.publishedAt || a.satOn || '') ||
        a.subject.localeCompare(b.subject),
    )
    if (papers.length === 0) continue
    const entries: ResultEntry[] = papers.map((p) => ({
      subject: p.subject,
      score: p.score,
      maxScore: p.maxScore,
      grade: p.grade,
      comment: p.comment,
      teacherName: p.teacherName,
      at: p.publishedAt || p.satOn || '',
    }))
    const stamp = papers.find((p) => p.publishedAt || p.satOn)
    const year = (stamp?.publishedAt || stamp?.satOn || '').slice(0, 4)
    periods.push({
      id: kind,
      kind,
      label: CATEGORY_COPY[kind].label,
      year,
      sortKey: papers[0]?.publishedAt || papers[0]?.satOn || kind,
      basis: CATEGORY_COPY[kind].basis,
      papers,
      classTeacherComment: kind === 'TERMLY' ? opts.termComments.get(termlyTermId) : undefined,
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
  const levelId = student.educationLevelId ?? klass?.educationLevelId ?? klass?.level

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
  let results = await getResultsPortal(session, studentId).catch(() => {
    resultsLoaded = false
    return emptyResults
  })

  let ecdChecklist: EcdChecklist | null = null
  if (term && (isEcdEducationLevel(levelId) || isEcdClass(klass ?? {}))) {
    const row = await getOne<EcdChecklist>(
      'ecdChecklists',
      `ecdchk_${student.id}_${term.id}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    )
    if (row && isEcdReleasedToPortal(row.status)) {
      // ECD learners often have no subject assessments — still enforce fee clearance.
      if (results.accessState === 'RESULTS_NOT_PUBLISHED') {
        const policy = await getFeePolicy()
        if (policy.blockResultsWhenFeesOutstanding) {
          const cleared = await isFeeCleared(studentId)
          results = {
            ...results,
            accessState: cleared ? 'RESULTS_AVAILABLE' : 'RESULTS_LOCKED_FEES',
          }
        } else {
          results = { ...results, accessState: 'RESULTS_AVAILABLE' }
        }
      }
      if (
        results.accessState !== 'RESULTS_LOCKED_FEES' &&
        results.accessState !== 'ACCOUNT_RESTRICTED'
      ) {
        ecdChecklist = row
      }
    }
  }

  const resultsOpen =
    resultsLoaded &&
    results.accessState !== 'RESULTS_LOCKED_FEES' &&
    results.accessState !== 'ACCOUNT_RESTRICTED'

  const [attendance, fees, academics, termComments, scale, school, announcements, documents] =
    await Promise.all([
      optional(() => loadAttendance(studentId, term), summarizeAttendance([], null)),
      loadFees(session, studentId, term),
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
    ecdChecklist,
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
