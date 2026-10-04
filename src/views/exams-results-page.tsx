import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Alert } from '@/components/shared/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import {
  autoCommentForGrade,
  gradeFromScore,
} from '@/lib/grading'
import { gradingTrackForLevel } from '@/lib/education-levels'
import { catalogService, classService, studentService } from '@/services/api'
import { notify } from '@/lib/notify'
import { fullName } from '@/lib/utils'
import type {
  Assessment,
  GradingScalesBundle,
  Mark,
  MarkCommentMode,
  ResultPortalView,
  SchoolClass,
  Staff,
  Student,
  Subject,
  Term,
} from '@/types'

const workflow = ['Draft', 'Submitted', 'Admin review', 'Published on portal'] as const

type PeriodType = 'DAILY' | 'MONTHLY' | 'WEEKLY' | 'MOCK' | 'TERMLY'

function currentDate() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function currentMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Monday of the current week as YYYY-MM-DD. */
function currentWeekStart() {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

type StudentEntry = {
  score: string
  commentMode: MarkCommentMode
  comment: string
}

function assessmentKey(
  periodType: PeriodType,
  classId: string,
  subjectId: string,
  month: string,
  dateOrWeek: string,
  termId: string,
) {
  const periodKey =
    periodType === 'DAILY'
      ? dateOrWeek
      : periodType === 'WEEKLY'
        ? dateOrWeek
        : periodType === 'TERMLY'
          ? termId
          : month
  return `as_${periodType.toLowerCase()}_${classId}_${subjectId}_${periodKey}`.replace(
    /[^a-zA-Z0-9_-]/g,
    '_',
  )
}

export function ExaminationsPage() {
  const { hasPermission } = useAuth()
  const canApprove = hasPermission('results.approve')
  const [loading, setLoading] = useState(true)
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [marks, setMarks] = useState<Mark[]>([])

  async function reloadResults() {
    const [a, m] = await Promise.all([
      catalogService.getAssessments(),
      catalogService.getMarks(),
    ])
    setAssessments(a)
    setMarks(m)
  }

  useEffect(() => {
    reloadResults()
      .catch(() => notify.error('Could not load assessments'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingState message="Loading examinations…" />

  return (
    <div className="space-y-6">
      <PageHeader
        title="Examinations & marks"
        description="Enter class marks by subject, submit for admin approval, then release to the student portal."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Examinations' }]}
      />

      <Card>
        <CardContent className="flex flex-wrap gap-2 p-4">
          {workflow.map((step, index) => (
            <div key={step} className="flex items-center gap-2 text-sm">
              <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
                {step}
              </span>
              {index < workflow.length - 1 && (
                <span className="text-muted-foreground">→</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <ClassSubjectMarksPanel
        assessments={assessments}
        marks={marks}
        onSaved={reloadResults}
      />

      {canApprove ? (
        <ResultsApprovalsPanel
          assessments={assessments}
          onUpdated={reloadResults}
        />
      ) : (
        <Alert title="After you submit" tone="info">
          Your head of department or admin will approve and release marks to the student portal.
          You cannot publish directly.
        </Alert>
      )}
    </div>
  )
}

function ClassSubjectMarksPanel({
  assessments,
  marks,
  onSaved,
}: {
  assessments: Assessment[]
  marks: Mark[]
  onSaved: () => Promise<void>
}) {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const isTeacher = user?.role === 'TEACHER'
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [gradingScales, setGradingScales] = useState<GradingScalesBundle | null>(null)
  const [staffSelf, setStaffSelf] = useState<Staff | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const initialPeriod = (searchParams.get('periodType') as PeriodType | null) ?? 'MONTHLY'
  const [periodType, setPeriodType] = useState<PeriodType>(
    ['DAILY', 'MONTHLY', 'WEEKLY', 'MOCK', 'TERMLY'].includes(initialPeriod) ? initialPeriod : 'MONTHLY',
  )
  const [classId, setClassId] = useState(() => searchParams.get('classId') ?? '')
  const [subjectId, setSubjectId] = useState(() => searchParams.get('subjectId') ?? '')
  const [month, setMonth] = useState(currentMonth())
  const [date, setDate] = useState(currentDate())
  const [weekOf, setWeekOf] = useState(currentWeekStart())
  const [termId, setTermId] = useState('')
  const [defaultCommentMode, setDefaultCommentMode] = useState<MarkCommentMode>('NONE')
  const [entries, setEntries] = useState<Record<string, StudentEntry>>({})
  const [saving, setSaving] = useState(false)
  const [maxScoreInput, setMaxScoreInput] = useState('100')
  const maxScore = Number(maxScoreInput)

  useEffect(() => {
    void (async () => {
      const [cls, subs, stu, t] = await Promise.all([
        classService.list(),
        catalogService.getSubjects(),
        studentService.list(),
        catalogService.getTerms(),
      ])
      let me: Staff | null = null
      if (user?.staffId) {
        me = (await catalogService.getStaffMember(user.staffId).catch(() => null)) ?? null
      }
      setStaffSelf(me)
      const activeClasses = cls.filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE')
      const allowedClasses = me
        ? activeClasses.filter((c) => (me.classIds ?? []).includes(c.id) || c.classTeacherId === me.id)
        : activeClasses
      const allowedSubjects = me
        ? subs.filter((s) => (me.subjectIds ?? []).includes(s.id) || (s.teacherIds ?? []).includes(me.id))
        : subs
      const classList = isTeacher ? allowedClasses : activeClasses
      const subjectList = isTeacher
        ? allowedSubjects.length
          ? allowedSubjects
          : []
        : allowedSubjects.length
          ? allowedSubjects
          : subs
      setClasses(classList)
      setSubjects(subjectList)
      setStudents(stu)
      setTerms(t)
      catalogService
        .getGradingScale()
        .then(setGradingScales)
        .catch((error) => {
          console.error(error)
          notify.error('Could not load grading scales; mark previews may be inaccurate')
        })
      const urlClass = searchParams.get('classId')
      const urlSubject = searchParams.get('subjectId')
      setClassId((prev) => {
        if (urlClass && classList.some((c) => c.id === urlClass)) return urlClass
        return prev || classList[0]?.id || ''
      })
      setSubjectId((prev) => {
        if (urlSubject && subjectList.some((s) => s.id === urlSubject)) return urlSubject
        return prev || subjectList[0]?.id || ''
      })
      setTermId((prev) => prev || t.find((x) => x.sequence === 1)?.id || t[0]?.id || '')
    })()
  }, [user?.staffId, isTeacher, searchParams.get('classId'), searchParams.get('subjectId'), searchParams.get('periodType')])

  const roster = useMemo(
    () =>
      students
        .filter((s) => s.classId === classId && s.status === 'ACTIVE')
        .sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [students, classId],
  )
  const selectedClass = classes.find((c) => c.id === classId)
  const activeScale = gradingScales?.[
    gradingTrackForLevel(selectedClass?.educationLevelId ?? selectedClass?.level)
  ]

  const currentAssessment = useMemo(() => {
    if (!classId || !subjectId) return undefined
    const id = assessmentKey(
      periodType,
      classId,
      subjectId,
      month,
      periodType === 'DAILY' ? date : weekOf,
      termId,
    )
    return assessments.find((a) => a.id === id)
  }, [assessments, classId, subjectId, periodType, month, date, weekOf, termId])

  useEffect(() => {
    if (currentAssessment) setMaxScoreInput(String(currentAssessment.maxScore))
  }, [currentAssessment?.id, currentAssessment?.maxScore])

  useEffect(() => {
    if (!currentAssessment) {
      setEntries({})
      return
    }
    const next: Record<string, StudentEntry> = {}
    for (const s of roster) {
      const m = marks.find(
        (x) => x.assessmentId === currentAssessment.id && x.studentId === s.id,
      )
      next[s.id] = {
        score: m ? String(m.score) : '',
        commentMode: m?.commentMode ?? defaultCommentMode,
        comment: m?.comment ?? '',
      }
    }
    setEntries(next)
  }, [currentAssessment?.id, roster, marks, defaultCommentMode])

  function setEntry(studentId: string, patch: Partial<StudentEntry>) {
    setEntries((prev) => ({
      ...prev,
      [studentId]: {
        score: prev[studentId]?.score ?? '',
        commentMode: prev[studentId]?.commentMode ?? defaultCommentMode,
        comment: prev[studentId]?.comment ?? '',
        ...patch,
      },
    }))
  }

  function previewGrade(scoreStr: string) {
    const score = Number(scoreStr)
    if (!Number.isFinite(score)) return '—'
    return gradeFromScore(score, maxScore, activeScale)
  }

  async function submit(action: 'draft' | 'submit') {
    if (!classId || !subjectId) {
      notify.error('Select class and subject')
      return
    }
    if (!Number.isFinite(maxScore) || maxScore < 1 || maxScore > 1000) {
      notify.error('Maximum mark must be between 1 and 1000')
      return
    }
    if (
      roster.some((s) => {
        const scoreText = entries[s.id]?.score.trim()
        if (!scoreText) return false
        const score = Number(scoreText)
        return !Number.isFinite(score) || score < 0 || score > maxScore
      })
    ) {
      notify.error(`A student's mark cannot exceed ${maxScore}`)
      return
    }
    if (periodType === 'DAILY' && !date) {
      notify.error('Select the exercise date')
      return
    }
    if (periodType === 'TERMLY' && !termId) {
      notify.error('Select a term')
      return
    }
    if ((periodType === 'MONTHLY' || periodType === 'MOCK') && !month) {
      notify.error('Select a month')
      return
    }
    if (periodType === 'WEEKLY' && !weekOf) {
      notify.error('Select the week start date')
      return
    }
    const payloadEntries = roster
      .map((s) => {
        const row = entries[s.id]
        if (!row?.score.trim()) return null
        const score = Number(row?.score)
        if (!Number.isFinite(score) || score < 0) return null
        const mode = row?.commentMode ?? defaultCommentMode
        return {
          studentId: s.id,
          score,
          commentMode: mode,
          comment:
            mode === 'CUSTOM'
              ? row?.comment?.trim()
              : mode === 'AUTO'
                ? autoCommentForGrade(previewGrade(String(score)))
                : undefined,
        }
      })
      .filter(Boolean) as {
      studentId: string
      score: number
      commentMode: MarkCommentMode
      comment?: string
    }[]
    if (payloadEntries.length === 0) {
      notify.error('Enter at least one mark')
      return
    }
    setSaving(true)
    try {
      await notify.process(
        () =>
          catalogService.submitClassSubjectMarks({
            classId,
            subjectId,
            periodType,
            date: periodType === 'DAILY' ? date : undefined,
            month:
              periodType === 'MONTHLY' || periodType === 'MOCK' ? month : undefined,
            weekOf: periodType === 'WEEKLY' ? weekOf : undefined,
            termId: periodType === 'TERMLY' ? termId : undefined,
            maxScore,
            action,
            entries: payloadEntries,
          }),
        {
          loading: action === 'submit' ? 'Submitting for approval…' : 'Saving draft…',
          success:
            action === 'submit'
              ? 'Marks submitted — waiting for admin approval'
              : 'Draft saved',
          error: 'Could not save marks',
        },
      )
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  if (isTeacher && classes.length === 0) {
    return (
      <Alert title="No teaching assignments" tone="warning">
        Ask an admin to assign subjects and classes on your teacher profile before recording marks.
      </Alert>
    )
  }

  const showCommentColumn =
    defaultCommentMode === 'CUSTOM' ||
    defaultCommentMode === 'AUTO' ||
    Object.values(entries).some((e) => e.commentMode === 'CUSTOM')

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create assessment & enter marks</CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose daily, monthly, weekly, mock, or end-of-term. Set the maximum mark, enter scores,
          add custom comments, or use system auto comments from the grade. Submit for admin approval.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {staffSelf && isTeacher ? (
          <p className="text-xs text-muted-foreground">
            Your classes:{' '}
            {classes.map((c) => c.name).join(', ') || '—'}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {(
            [
              ['MONTHLY', 'Monthly'],
              ['DAILY', 'Daily'],
              ['WEEKLY', 'Weekly'],
              ['MOCK', 'Mock'],
              ['TERMLY', 'End of term'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={periodType === value ? 'default' : 'outline'}
              onClick={() => setPeriodType(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {periodType === 'DAILY' ? (
            <div className="space-y-1.5">
              <Label>Exercise date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          ) : periodType === 'WEEKLY' ? (
            <div className="space-y-1.5">
              <Label>Week starting</Label>
              <Input type="date" value={weekOf} onChange={(e) => setWeekOf(e.target.value)} />
            </div>
          ) : periodType === 'TERMLY' ? (
            <div className="space-y-1.5">
              <Label>Term</Label>
              <Select value={termId} onChange={(e) => setTermId(e.target.value)}>
                <option value="">Select term</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>{periodType === 'MOCK' ? 'Mock month' : 'Month'}</Label>
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Class</Label>
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Select class</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Subject</Label>
            <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Select subject</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Comments (default)</Label>
            <Select
              value={defaultCommentMode}
              onChange={(e) => setDefaultCommentMode(e.target.value as MarkCommentMode)}
            >
              <option value="NONE">Marks only — no comment</option>
              <option value="AUTO">System auto comment from grade</option>
              <option value="CUSTOM">Custom comment per student</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Maximum mark</Label>
            <Input
              type="number"
              min={1}
              max={1000}
              value={maxScoreInput}
              onChange={(e) => setMaxScoreInput(e.target.value)}
            />
          </div>
        </div>

        {currentAssessment ? (
          <p className="text-xs text-muted-foreground">
            Current sheet: <StatusBadge status={currentAssessment.status} />{' '}
            {currentAssessment.name}
          </p>
        ) : null}

        {roster.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active students in this class.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-muted/60 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">Student</th>
                  <th className="px-3 py-2">Mark /{maxScore}</th>
                  <th className="px-3 py-2">Grade</th>
                  {showCommentColumn ? (
                    <th className="px-3 py-2">
                      {defaultCommentMode === 'AUTO' ? 'Auto comment' : 'Teacher comment'}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {roster.map((s, i) => {
                  const row = entries[s.id] ?? {
                    score: '',
                    commentMode: defaultCommentMode,
                    comment: '',
                  }
                  const grade = previewGrade(row.score)
                  const showCustom =
                    defaultCommentMode === 'CUSTOM' || row.commentMode === 'CUSTOM'
                  return (
                    <tr key={s.id} className="border-t border-border">
                      <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">{fullName(s)}</td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          max={maxScore}
                          className="w-24"
                          value={row.score}
                          onChange={(e) => setEntry(s.id, { score: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2 font-semibold">{grade}</td>
                      {showCustom ? (
                        <td className="px-3 py-2">
                          <Textarea
                            rows={2}
                            className="min-w-[200px] text-xs"
                            placeholder="Optional remark"
                            value={row.comment}
                            onChange={(e) =>
                              setEntry(s.id, {
                                commentMode: 'CUSTOM',
                                comment: e.target.value,
                              })
                            }
                          />
                        </td>
                      ) : defaultCommentMode === 'AUTO' ? (
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {row.score ? autoCommentForGrade(grade) : '—'}
                        </td>
                      ) : showCommentColumn ? (
                        <td className="px-3 py-2 text-muted-foreground">—</td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button loading={saving} onClick={() => void submit('submit')}>
            Submit for approval
          </Button>
          <Button variant="outline" loading={saving} onClick={() => void submit('draft')}>
            Save draft
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ResultsApprovalsPanel({
  assessments,
  onUpdated,
}: {
  assessments: Assessment[]
  onUpdated: () => Promise<void>
}) {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filterClass, setFilterClass] = useState('')
  const [filterSubject, setFilterSubject] = useState('')

  useEffect(() => {
    void Promise.all([catalogService.getSubjects(), classService.list()]).then(
      ([s, c]) => {
        setSubjects(s)
        setClasses(c)
      },
    )
  }, [])

  const pending = useMemo(() => {
    return assessments
      .filter(
        (a) =>
          a.status === 'SUBMITTED' ||
          a.status === 'UNDER_REVIEW' ||
          a.status === 'APPROVED',
      )
      .filter((a) => !filterClass || a.classId === filterClass)
      .filter((a) => !filterSubject || a.subjectId === filterSubject)
      .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''))
  }, [assessments, filterClass, filterSubject])

  async function release(assessmentId: string) {
    setBusyId(assessmentId)
    try {
      await notify.process(
        () =>
          catalogService.transitionAssessment({
            assessmentId,
            status: 'APPROVED',
            releaseToPortal: true,
          }),
        {
          loading: 'Approving and releasing…',
          success: 'Results are now visible on the student portal',
          error: 'Could not release results',
        },
      )
      await onUpdated()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approve & release</CardTitle>
        <p className="text-sm text-muted-foreground">
          Review submitted class marks by subject. Approve to publish them to student and parent
          portals.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 max-w-lg">
          <div className="space-y-1.5">
            <Label>Filter by class</Label>
            <Select value={filterClass} onChange={(e) => setFilterClass(e.target.value)}>
              <option value="">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Filter by subject</Label>
            <Select value={filterSubject} onChange={(e) => setFilterSubject(e.target.value)}>
              <option value="">All subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submissions waiting for approval.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {pending.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {classes.find((c) => c.id === a.classId)?.name || a.classId || '—'} ·{' '}
                    {subjects.find((s) => s.id === a.subjectId)?.name || a.subjectId} ·{' '}
                    {a.type}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={a.status} />
                  {a.status === 'SUBMITTED' || a.status === 'UNDER_REVIEW' ? (
                    <Button
                      size="sm"
                      loading={busyId === a.id}
                      onClick={() => void release(a.id)}
                    >
                      Approve & release
                    </Button>
                  ) : a.status === 'APPROVED' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      loading={busyId === a.id}
                      onClick={() => void release(a.id)}
                    >
                      Release to portal
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function ResultsPage() {
  const { user } = useAuth()
  const isStudent = user?.role === 'STUDENT'
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ResultPortalView | null>(null)
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        if (isStudent && user?.studentId) {
          const portal = await catalogService.getResultPortal(user.studentId)
          if (!mounted) return
          setView(portal)
          setSelectedId(portal.studentId)
        }
      } catch (err) {
        console.error(err)
        notify.error('Could not load results')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [isStudent, user?.studentId])

  useEffect(() => {
    if (isStudent || !selectedId) return
    void catalogService
      .getResultPortal(selectedId)
      .then(setView)
      .catch((err) => console.error(err))
  }, [selectedId, isStudent])

  if (loading) return <LoadingState message="Loading results portal…" />

  if (isStudent) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="My results"
          description="Monthly progress, end-of-term results, and teacher comments."
          breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Results' }]}
        />
        {view ? (
          <StudentProgressCard view={view} />
        ) : (
          <Alert title="No results yet" tone="info">
            When your teachers submit marks and admin releases them, they will appear here.
          </Alert>
        )}
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Results"
        description="Preview what students see after admin releases marks."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Results' }]}
      />
      <div className="mb-4 max-w-sm">
        <Label className="mb-1.5 block">Student</Label>
        <StudentPicker selectedId={selectedId} onPick={setSelectedId} />
      </div>
      {view ? (
        <StudentProgressCard view={view} />
      ) : (
        <p className="text-sm text-muted-foreground">Select a student to preview their portal.</p>
      )}
    </div>
  )
}

function StudentPicker({
  selectedId,
  onPick,
}: {
  selectedId: string
  onPick: (id: string) => void
}) {
  const [students, setStudents] = useState<Student[]>([])
  useEffect(() => {
    void studentService.list().then(setStudents).catch(console.error)
  }, [])
  return (
    <Select value={selectedId} onChange={(e) => onPick(e.target.value)}>
      <option value="">Select student…</option>
      {students
        .filter((s) => s.status === 'ACTIVE')
        .map((s) => (
          <option key={s.id} value={s.id}>
            {fullName(s)}
          </option>
        ))}
    </Select>
  )
}

function StudentProgressCard({ view }: { view: ResultPortalView }) {
  return (
    <div className="space-y-4">
      {view.accessState === 'RESULTS_LOCKED_FEES' && (
        <Alert title="Results locked — fees outstanding" tone="warning">
          Clear outstanding fees to view published results.
        </Alert>
      )}
      {view.accessState === 'RESULTS_NOT_PUBLISHED' && (
        <Alert title="Results not yet published" tone="info">
          Your teachers may have submitted marks; admin must approve and release them.
        </Alert>
      )}

      <Card>
        <CardHeader className="border-b border-border/70 bg-muted/30">
          <CardTitle>{view.studentName}</CardTitle>
          <p className="text-sm text-muted-foreground">
            {view.className} {view.streamName}
            {view.term ? ` · ${view.term}` : ''}
            {view.overallAverage != null ? (
              <>
                {' '}
                · ACC {view.overallAverage.toFixed(1)}%
              </>
            ) : null}
          </p>
        </CardHeader>
        <CardContent className="space-y-6 p-5">
          {view.accessState !== 'RESULTS_AVAILABLE' ? (
            <p className="text-sm text-muted-foreground">
              Academic details are hidden until results are released.
            </p>
          ) : (
            <>
              {view.teacherComment ? (
                <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
                  <h3 className="font-display text-base font-semibold">Class teacher comment</h3>
                  <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
                    {view.teacherComment}
                  </p>
                </div>
              ) : null}

              {(view.monthly?.length ?? 0) > 0 ? (
                <ResultsBlockTable title="Monthly progress tests" blocks={view.monthly!} />
              ) : null}

              {(view.termly?.length ?? 0) > 0 ? (
                <ResultsBlockTable
                  title="End of term results"
                  blocks={view.termly!.map((b) => ({
                    month: b.termId,
                    label: b.termName,
                    rows: b.rows,
                    average: b.average,
                  }))}
                />
              ) : null}

              {view.subjects.length > 0 ? (
                <div className="space-y-2">
                  <h3 className="font-display text-base font-semibold">All published subjects</h3>
                  <div className="overflow-x-auto rounded-xl border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 text-left">Subject</th>
                          <th className="px-4 py-2 text-left">Score</th>
                          <th className="px-4 py-2 text-left">Grade</th>
                          <th className="px-4 py-2 text-left">Comment</th>
                        </tr>
                      </thead>
                      <tbody>
                        {view.subjects.map((s) => (
                          <tr key={`${s.name}-${s.type}`} className="border-t border-border">
                            <td className="px-4 py-2">{s.name}</td>
                            <td className="px-4 py-2">{s.score}</td>
                            <td className="px-4 py-2 font-semibold">{s.grade}</td>
                            <td className="px-4 py-2 text-xs text-muted-foreground">
                              {s.comment || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No published results yet.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ResultsBlockTable({
  title,
  blocks,
}: {
  title: string
  blocks: {
    month: string
    label: string
    rows: {
      subject: string
      score: number
      grade: string
      maxScore: number
      comment?: string
    }[]
    average?: number
  }[]
}) {
  return (
    <div className="space-y-4">
      <h3 className="font-display text-base font-semibold">{title}</h3>
      {blocks.map((block) => (
        <div key={block.month} className="rounded-xl border border-border">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2">
            <p className="font-medium">{block.label}</p>
            {block.average != null ? (
              <p className="text-sm text-muted-foreground">Avg {block.average.toFixed(1)}%</p>
            ) : null}
          </div>
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Subject</th>
                <th className="px-4 py-2 text-left">Score</th>
                <th className="px-4 py-2 text-left">Grade</th>
                <th className="px-4 py-2 text-left">Comment</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={`${block.month}-${row.subject}`} className="border-t border-border">
                  <td className="px-4 py-2">{row.subject}</td>
                  <td className="px-4 py-2">
                    {row.score}/{row.maxScore}
                  </td>
                  <td className="px-4 py-2 font-semibold">{row.grade}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {row.comment || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
