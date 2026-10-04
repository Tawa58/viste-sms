import 'server-only'

import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import type {
  ClassSubjectMarksInput,
  MarkUpsertInput,
  MonthlyMarksInput,
  ResultTransitionInput,
} from '@/server/validators/school'
import { getGradingScaleForEducationLevel, gradeFromScore } from '@/server/services/grading-service'
import { resolveMarkComment, type CommentMode } from '@/lib/grading'
import type {
  Assessment,
  Mark,
  MarkCommentMode,
  MarkWorkflowStatus,
  ResultAccessState,
  ResultPortalView,
  SchoolClass,
  Staff,
  Stream,
  Student,
  Subject,
  Term,
} from '@/types'
import { getDoc, newId, queryCollection, setDoc } from '@/server/repositories/firestore-repo'
import { assertCanAccessStudent } from '@/server/authorization/isolation'
import { badRequest, forbidden, notFound } from '@/server/errors'
import { isFeeCleared } from '@/server/services/finance-service'

export type MarkDto = Mark
export type AssessmentDto = Assessment
export type ResultPortalDto = ResultPortalView

/** DRAFT → SUBMITTED → APPROVED → PUBLISHED → LOCKED (+ UNDER_REVIEW bridge). */
const FORWARD: Record<MarkWorkflowStatus, MarkWorkflowStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'UNDER_REVIEW'],
  UNDER_REVIEW: ['APPROVED'],
  APPROVED: ['PUBLISHED'],
  PUBLISHED: ['LOCKED'],
  LOCKED: [],
}

function assertTransition(from: MarkWorkflowStatus, to: MarkWorkflowStatus) {
  const allowed = FORWARD[from] ?? []
  if (!allowed.includes(to)) {
    throw badRequest(`Invalid status transition: ${from} → ${to}`)
  }
}

function isLocked(status: MarkWorkflowStatus) {
  return status === 'LOCKED'
}

function requireTransitionPermission(session: SessionContext, next: MarkWorkflowStatus) {
  if (next === 'APPROVED') requirePermission(session, 'results.approve')
  else if (next === 'PUBLISHED') requirePermission(session, 'results.publish')
  else if (next === 'LOCKED') requirePermission(session, 'results.lock')
  else requirePermission(session, 'results.update')
}

function formatMonthLabel(month: string) {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Date(y, m - 1, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

function formatDateLabel(date: string) {
  const parsed = new Date(`${date}T12:00:00`)
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
}

async function assertTeacherCanEnter(
  session: SessionContext,
  classId: string,
  subjectId: string,
) {
  if (session.role !== 'TEACHER') return
  const staffId = session.profile.staffId
  if (!staffId) throw forbidden('Teacher profile is not linked')
  const { resolveTeacherClassIds, resolveTeacherSubjectIds } = await import(
    '@/server/authorization/isolation'
  )
  const classIds = await resolveTeacherClassIds(session)
  const subjectIds = await resolveTeacherSubjectIds(session)
  if (!classIds.includes(classId)) {
    throw forbidden('You are not assigned to teach this class')
  }
  if (!subjectIds.includes(subjectId)) {
    throw forbidden('You are not assigned to teach this subject')
  }
}

function buildMarkComment(
  mode: CommentMode | undefined,
  grade: string,
  custom?: string,
): { commentMode: MarkCommentMode; comment?: string } {
  const commentMode = (mode ?? 'NONE') as MarkCommentMode
  return {
    commentMode,
    comment: resolveMarkComment({ mode: commentMode, grade, customComment: custom }),
  }
}

export async function upsertMark(
  session: SessionContext,
  input: MarkUpsertInput,
  requestId?: string,
): Promise<MarkDto> {
  requirePermission(session, 'results.enter')
  await assertCanAccessStudent(session, input.studentId)

  const assessment = await getDoc<Assessment>('assessments', input.assessmentId)
  if (!assessment) throw notFound('Assessment not found')
  if (isLocked(assessment.status)) {
    throw forbidden('Assessment is locked; marks cannot be edited')
  }
  if (assessment.status === 'PUBLISHED' || assessment.status === 'APPROVED') {
    requirePermission(session, 'results.update')
  }

  const existing = await queryCollection<Mark>('marks', {
    limit: 1,
    where: [
      { field: 'assessmentId', op: '==', value: input.assessmentId },
      { field: 'studentId', op: '==', value: input.studentId },
    ],
  })

  const current = existing[0]
  if (current && isLocked(current.status)) {
    throw forbidden('Mark is locked; edits are blocked')
  }
  if (current && (current.status === 'PUBLISHED' || current.status === 'APPROVED')) {
    requirePermission(session, 'results.update')
  }

  const id = current?.id ?? newId('mk')
  const student = await getDoc<Student>('students', input.studentId)
  const klass = student ? await getDoc<SchoolClass>('classes', student.classId) : null
  const scale = await getGradingScaleForEducationLevel(
    student?.educationLevelId || klass?.educationLevelId || klass?.level,
  )
  if (assessment.maxScore > 0 && input.score > assessment.maxScore) {
    throw badRequest(`Score cannot exceed the maximum mark of ${assessment.maxScore}`)
  }

  const grade =
    input.grade?.trim() || gradeFromScore(input.score, assessment.maxScore || 100, scale)
  const remark = buildMarkComment(input.commentMode, grade, input.comment)
  const row: Mark = {
    id,
    assessmentId: input.assessmentId,
    studentId: input.studentId,
    score: input.score,
    grade,
    status: current?.status ?? 'DRAFT',
    commentMode: remark.commentMode,
    comment: remark.comment,
    recordedAt: new Date().toISOString(),
    recordedBy: session.uid,
  }

  await setDoc('marks', id, { ...row })
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: current ? 'mark.update' : 'mark.create',
    entityType: 'marks',
    entityId: id,
    requestId,
  })
  return row
}

export async function transitionAssessmentStatus(
  session: SessionContext,
  assessmentId: string,
  input: ResultTransitionInput,
  requestId?: string,
): Promise<AssessmentDto> {
  const assessment = await getDoc<Assessment>('assessments', assessmentId)
  if (!assessment) throw notFound('Assessment not found')
  if (isLocked(assessment.status)) throw forbidden('Assessment is locked')

  const next = input.status as MarkWorkflowStatus
  const release = Boolean(input.releaseToPortal)

  if (release) {
    requirePermission(session, 'results.approve')
    if (
      assessment.status !== 'SUBMITTED' &&
      assessment.status !== 'UNDER_REVIEW' &&
      assessment.status !== 'APPROVED'
    ) {
      throw badRequest(
        `Only submitted results can be approved and released (current: ${assessment.status})`,
      )
    }
  } else {
    assertTransition(assessment.status, next)
    requireTransitionPermission(session, next)
  }

  const finalStatus: MarkWorkflowStatus = release ? 'PUBLISHED' : next
  const now = new Date().toISOString()
  const updated: Assessment = {
    ...assessment,
    status: finalStatus,
    ...(finalStatus === 'SUBMITTED'
      ? {
          submittedAt: now,
          enteredBy: session.uid,
          enteredByName: session.profile.name,
        }
      : {}),
    ...(finalStatus === 'APPROVED' || finalStatus === 'PUBLISHED'
      ? { approvedAt: now, approvedBy: session.uid }
      : {}),
  }
  await setDoc('assessments', assessmentId, { ...updated })

  if (
    finalStatus === 'PUBLISHED' ||
    finalStatus === 'LOCKED' ||
    finalStatus === 'APPROVED' ||
    finalStatus === 'SUBMITTED'
  ) {
    const marks = await queryCollection<Mark>('marks', {
      limit: 200,
      where: [{ field: 'assessmentId', op: '==', value: assessmentId }],
    })
    for (const m of marks) {
      if (!isLocked(m.status)) {
        await setDoc('marks', m.id, { ...m, status: finalStatus })
      }
    }
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: `assessment.transition.${finalStatus}`,
    entityType: 'assessments',
    entityId: assessmentId,
    requestId,
    metadata: {
      from: assessment.status,
      to: finalStatus,
      releaseToPortal: release,
    },
  })
  return updated
}

/**
 * Results portal: auth + relationship + published status + fee clearance.
 */
export async function getResultsPortal(
  session: SessionContext,
  studentId: string,
  opts?: { termId?: string },
): Promise<ResultPortalDto> {
  requirePermission(session, 'results.read')
  const student = await assertCanAccessStudent(session, studentId)

  const [klass, stream, terms] = await Promise.all([
    getDoc<SchoolClass>('classes', student.classId),
    getDoc<Stream>('streams', student.streamId),
    queryCollection<Term>('terms', { limit: 100 }),
  ])

  const term =
    (opts?.termId ? terms.find((t) => t.id === opts.termId) : undefined) ??
    [...terms].sort((a, b) => b.sequence - a.sequence)[0]

  const assessments = await queryCollection<Assessment>('assessments', { limit: 200 })
  const relevant = assessments.filter(
    (a) =>
      (!a.classId || a.classId === student.classId) &&
      (!term || a.termId === term.id || a.type === 'MONTHLY' || a.type === 'DAILY'),
  )
  void relevant

  const published = relevant.filter(
    (a) => a.status === 'PUBLISHED' || a.status === 'LOCKED',
  )

  let accessState: ResultAccessState = 'RESULTS_AVAILABLE'
  if (published.length === 0) {
    accessState = 'RESULTS_NOT_PUBLISHED'
  } else {
    const { getFeePolicy } = await import('@/server/services/school-settings-service')
    const policy = await getFeePolicy()
    if (policy.blockResultsWhenFeesOutstanding) {
      const cleared = await isFeeCleared(studentId)
      if (!cleared) accessState = 'RESULTS_LOCKED_FEES'
    }
  }

  const base = {
    studentId: student.id,
    studentName: `${student.firstName} ${student.lastName}`,
    className: klass?.name ?? student.classId,
    streamName: stream?.name ?? student.streamId,
    academicYear: klass?.academicYearId ?? '',
    term: term?.name ?? '',
  }

  if (accessState !== 'RESULTS_AVAILABLE') {
    return { ...base, accessState, subjects: [] }
  }

  const marks = await queryCollection<Mark>('marks', {
    limit: 300,
    where: [{ field: 'studentId', op: '==', value: studentId }],
  })
  const markByAssessment = new Map(marks.map((m) => [m.assessmentId, m]))
  const subjectsCatalog = await queryCollection<Subject>('subjects', { limit: 100 })
  const subjectName = new Map(subjectsCatalog.map((s) => [s.id, s.name]))
  const termName = new Map(terms.map((t) => [t.id, t.name]))

  const subjects = published
    .map((a) => {
      const m = markByAssessment.get(a.id)
      if (!m || (m.status !== 'PUBLISHED' && m.status !== 'LOCKED')) return null
      return {
        name: subjectName.get(a.subjectId) ?? a.subjectId,
        score: m.score,
        grade: m.grade,
        comment: m.comment,
        type: a.type,
      }
    })
    .filter((x) => x !== null)

  const monthlyMap = new Map<
    string,
    {
      month: string
      label: string
      rows: {
        subject: string
        score: number
        grade: string
        maxScore: number
        comment?: string
      }[]
    }
  >()
  for (const a of published) {
    if ((a.type !== 'MONTHLY' && a.type !== 'DAILY') || !a.month) continue
    const m = markByAssessment.get(a.id)
    if (!m || (m.status !== 'PUBLISHED' && m.status !== 'LOCKED')) continue
    const bucket =
      monthlyMap.get(a.month) ??
      ({
        month: a.month,
        label: formatMonthLabel(a.month),
        rows: [],
      } as {
        month: string
        label: string
        rows: {
          subject: string
          score: number
          grade: string
          maxScore: number
          comment?: string
        }[]
      })
    bucket.rows.push({
      subject: subjectName.get(a.subjectId) ?? a.subjectId,
      score: m.score,
      grade: m.grade,
      maxScore: a.maxScore,
      comment: m.comment,
    })
    monthlyMap.set(a.month, bucket)
  }
  const monthly = [...monthlyMap.values()]
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((block) => ({
      ...block,
      average:
        block.rows.length > 0
          ? block.rows.reduce((s, r) => s + (r.score / r.maxScore) * 100, 0) /
            block.rows.length
          : undefined,
    }))

  const termlyMap = new Map<
    string,
    {
      termId: string
      termName: string
      rows: {
        subject: string
        score: number
        grade: string
        maxScore: number
        comment?: string
      }[]
    }
  >()
  for (const a of published) {
    if (a.type !== 'TERMLY') continue
    const m = markByAssessment.get(a.id)
    if (!m || (m.status !== 'PUBLISHED' && m.status !== 'LOCKED')) continue
    const bucket =
      termlyMap.get(a.termId) ??
      ({
        termId: a.termId,
        termName: termName.get(a.termId) ?? a.termId,
        rows: [],
      } as {
        termId: string
        termName: string
        rows: {
          subject: string
          score: number
          grade: string
          maxScore: number
          comment?: string
        }[]
      })
    bucket.rows.push({
      subject: subjectName.get(a.subjectId) ?? a.subjectId,
      score: m.score,
      grade: m.grade,
      maxScore: a.maxScore,
      comment: m.comment,
    })
    termlyMap.set(a.termId, bucket)
  }
  const termly = [...termlyMap.values()].map((block) => ({
    ...block,
    average:
      block.rows.length > 0
        ? block.rows.reduce((s, r) => s + (r.score / r.maxScore) * 100, 0) / block.rows.length
        : undefined,
  }))

  const scored = [...monthly.flatMap((b) => b.rows), ...termly.flatMap((b) => b.rows)]
  const overallAverage =
    scored.length > 0
      ? scored.reduce((s, r) => s + (r.score / r.maxScore) * 100, 0) / scored.length
      : subjects.length > 0
        ? subjects.reduce((s, x) => s + x.score, 0) / subjects.length
        : undefined

  const { getClassTeacherCommentForStudent } = await import(
    '@/server/services/class-teacher-service'
  )
  const teacherComment = await getClassTeacherCommentForStudent(
    studentId,
    student.classId,
    term?.id,
  )

  return {
    ...base,
    accessState: 'RESULTS_AVAILABLE',
    subjects,
    monthly,
    termly,
    overallAverage,
    teacherComment,
  }
}

/**
 * Create/update a class+subject assessment (monthly or termly) and save student marks.
 * Grades are assigned from the school grading scale. Comments follow teacher mode.
 * Teachers cannot publish directly — submit for admin approval.
 */
export async function submitClassSubjectMarks(
  session: SessionContext,
  input: ClassSubjectMarksInput,
  requestId?: string,
): Promise<{ assessment: AssessmentDto; marks: MarkDto[] }> {
  requirePermission(session, 'results.enter')
  await assertTeacherCanEnter(session, input.classId, input.subjectId)

  const cls = await getDoc<SchoolClass>('classes', input.classId)
  if (!cls) throw notFound('Class not found')
  const subject = await getDoc<Subject>('subjects', input.subjectId)
  if (!subject) throw notFound('Subject not found')

  const students = await queryCollection<Student>('students', {
    limit: 200,
    where: [{ field: 'classId', op: '==', value: input.classId }],
  })
  const active = students.filter((s) => s.status === 'ACTIVE')
  const allowed = new Set(active.map((s) => s.id))
  for (const entry of input.entries) {
    if (!allowed.has(entry.studentId)) {
      throw badRequest(`Student ${entry.studentId} is not in this class`)
    }
    await assertCanAccessStudent(session, entry.studentId)
  }

  const streamId = active[0]?.streamId || `stream_${input.classId}`
  const periodType = input.periodType
  const termId =
    periodType === 'TERMLY'
      ? input.termId!
      : cls.termId || input.termId || 'term_current'

  const periodKey =
    periodType === 'DAILY'
      ? input.date!
      : periodType === 'WEEKLY'
      ? input.weekOf!
      : periodType === 'TERMLY'
        ? termId
        : input.month!

  const assessmentId = `as_${periodType.toLowerCase()}_${input.classId}_${input.subjectId}_${periodKey}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '_',
  )

  const existing = await getDoc<Assessment>('assessments', assessmentId)
  if (existing && isLocked(existing.status)) {
    throw forbidden('These results are locked and cannot be edited')
  }
  if (
    existing &&
    (existing.status === 'PUBLISHED' || existing.status === 'APPROVED') &&
    session.role === 'TEACHER'
  ) {
    throw forbidden('Published or approved results can only be changed by an admin')
  }

  const status: MarkWorkflowStatus = input.action === 'submit' ? 'SUBMITTED' : 'DRAFT'
  const now = new Date().toISOString()
  const typeLabel =
    periodType === 'DAILY'
      ? `Daily · ${formatDateLabel(input.date!)}`
      : periodType === 'MONTHLY'
      ? formatMonthLabel(input.month!)
      : periodType === 'WEEKLY'
        ? `Week of ${input.weekOf}`
        : periodType === 'MOCK'
          ? `Mock · ${formatMonthLabel(input.month!)}`
          : (await getDoc<Term>('terms', termId))?.name || 'Term'
  const assessment: Assessment = {
    id: assessmentId,
    name: `${subject.name} · ${typeLabel}${periodType === 'TERMLY' ? ' (Term)' : periodType === 'WEEKLY' ? ' (Weekly)' : periodType === 'MOCK' ? ' (Mock)' : ''}`,
    type: periodType,
    subjectId: input.subjectId,
    streamId,
    termId,
    maxScore: input.maxScore,
    status,
    classId: input.classId,
    ...(periodType === 'MONTHLY' || periodType === 'MOCK'
      ? { month: input.month }
      : periodType === 'DAILY'
        ? { date: input.date, month: input.date!.slice(0, 7) }
      : periodType === 'WEEKLY'
        ? { month: input.weekOf, weekOf: input.weekOf }
        : {}),
    enteredBy: session.uid,
    enteredByName: session.profile.name,
    ...(status === 'SUBMITTED' ? { submittedAt: now } : {}),
  }
  await setDoc('assessments', assessmentId, { ...assessment })

  const classLevel = cls.educationLevelId || cls.level
  const classScale = await getGradingScaleForEducationLevel(classLevel)
  const scaleByLevel = new Map<
    string,
    Awaited<ReturnType<typeof getGradingScaleForEducationLevel>>
  >()
  const marks: MarkDto[] = []
  for (const entry of input.entries) {
    const markId = `mk_${assessmentId}_${entry.studentId}`.replace(/[^a-zA-Z0-9_-]/g, '_')
    const student = active.find((s) => s.id === entry.studentId)
    const levelKey = student?.educationLevelId || classLevel || 'form-1'
    let studentScale = scaleByLevel.get(levelKey)
    if (!studentScale) {
      studentScale = student?.educationLevelId
        ? await getGradingScaleForEducationLevel(student.educationLevelId)
        : classScale
      scaleByLevel.set(levelKey, studentScale)
    }
    const grade = gradeFromScore(entry.score, input.maxScore, studentScale)
    const remark = buildMarkComment(entry.commentMode, grade, entry.comment)
    const row: Mark = {
      id: markId,
      assessmentId,
      studentId: entry.studentId,
      score: entry.score,
      grade,
      status,
      commentMode: remark.commentMode,
      comment: remark.comment,
      recordedAt: now,
      recordedBy: session.uid,
    }
    await setDoc('marks', markId, { ...row })
    marks.push(row)
  }

  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'marks.class_subject_submit',
    entityType: 'assessments',
    entityId: assessmentId,
    requestId,
    metadata: {
      classId: input.classId,
      subjectId: input.subjectId,
      periodType,
      month: input.month,
      date: input.date,
      weekOf: input.weekOf,
      termId,
      count: marks.length,
      action: input.action,
    },
  })

  return { assessment, marks }
}

/** Legacy monthly adapter — maps publish/action into classSubjectMarks. */
export async function submitMonthlyMarks(
  session: SessionContext,
  input: MonthlyMarksInput,
  requestId?: string,
) {
  const action =
    input.action ?? (input.publish ? 'submit' : 'draft')
  return submitClassSubjectMarks(
    session,
    {
      classId: input.classId,
      subjectId: input.subjectId,
      periodType: 'MONTHLY',
      month: input.month,
      maxScore: input.maxScore,
      entries: input.entries.map((e) => ({
        studentId: e.studentId,
        score: e.score,
        commentMode: e.commentMode ?? 'NONE',
        comment: e.comment,
      })),
      action,
    },
    requestId,
  )
}

export async function listAssessments(session: SessionContext): Promise<AssessmentDto[]> {
  requirePermission(session, 'results.read')
  let rows = await queryCollection<Assessment>('assessments', { limit: 200 })
  if (session.role === 'TEACHER') {
    const staffId = session.profile.staffId
    const staff = staffId ? await getDoc<Staff>('staff', staffId) : null
    const subjects = new Set(staff?.subjectIds ?? [])
    const classIds = new Set(staff?.classIds ?? [])
    rows = rows.filter(
      (a) => subjects.has(a.subjectId) && (!a.classId || classIds.has(a.classId)),
    )
  }
  return rows.sort((a, b) => (b.submittedAt || b.name).localeCompare(a.submittedAt || a.name))
}

export async function listMarks(session: SessionContext): Promise<MarkDto[]> {
  requirePermission(session, 'results.read')
  return queryCollection<Mark>('marks', { limit: 500 })
}

export const getResultPortalService = getResultsPortal
export const getResultsPortalService = getResultsPortal
export const listAssessmentsService = listAssessments
export const listMarksService = listMarks
export const upsertMarkService = upsertMark
export const submitMonthlyMarksService = submitMonthlyMarks
export const submitClassSubjectMarksService = submitClassSubjectMarks

export async function transitionAssessmentService(
  session: SessionContext,
  assessmentId: string,
  status: ResultTransitionInput['status'],
  requestId?: string,
  releaseToPortal?: boolean,
) {
  return transitionAssessmentStatus(
    session,
    assessmentId,
    { status, releaseToPortal },
    requestId,
  )
}
