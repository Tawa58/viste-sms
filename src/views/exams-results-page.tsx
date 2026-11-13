import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { SearchInput } from '@/components/shared/search-input'
import { LoadingState } from '@/components/shared/loading-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Alert } from '@/components/shared/alert'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import {
  autoCommentForGrade,
  gradeFromScore,
  isUnitsScale,
} from '@/lib/grading'
import { gradingTrackForLevel, gradingTrackLabel } from '@/lib/education-levels'
import {
  describeExamRatio,
  examComponentLabel,
  formatMarkComponents,
  isExamPaperPeriod,
  normalizeExamScheme,
  paperFinalPercent,
  roundExamPercent,
  type ExamComponentKey,
} from '@/lib/exam-papers'
import { EcdResultsSheet } from '@/components/shared/ecd-checklist-ticks'
import {
  ECD_OVERALL_LABELS,
  ecdStatusLabel,
  isEcdClass,
  isEcdReleasedToPortal,
  summariseEcdRatings,
} from '@/lib/ecd-checklist'
import {
  downloadResultSlipsPdf,
  downloadSubjectClassSheetPdf,
  formatResultDate,
  type ResultSlip,
  type SubjectClassSheet,
} from '@/lib/result-sheet-pdf'
import { catalogService, classService, studentService } from '@/services/api'
import { notify } from '@/lib/notify'
import { fullName } from '@/lib/utils'
import type {
  Assessment,
  ClassResultsPeriod,
  ClassResultsSummary,
  GradingScalesBundle,
  Mark,
  MarkCommentMode,
  EcdChecklist,
  ResultPortalView,
  StudentResultPaper,
  SchoolClass,
  Staff,
  Student,
  Subject,
  Term,
} from '@/types'

const workflow = ['Draft', 'Submitted', 'Review', 'Approved', 'Released'] as const

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
  papers: Record<string, string>
  commentMode: MarkCommentMode
  comment: string
}

type PaperDraft = {
  key: ExamComponentKey
  maxScore: string
  weight: string
}

function applyPaperStructure(count: number, practical: boolean, prev: PaperDraft[]): PaperDraft[] {
  const next: PaperDraft[] = []
  for (let index = 1; index <= count; index++) {
    const key = `paper${index}` as ExamComponentKey
    next.push(prev.find((row) => row.key === key) ?? { key, maxScore: '100', weight: '1' })
  }
  if (practical) {
    next.push(
      prev.find((row) => row.key === 'practical') ?? {
        key: 'practical',
        maxScore: '100',
        weight: '1',
      },
    )
  }
  return next
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

      <ClassSubjectMarksPanel />

      {canApprove ? (
        <Alert title="Approvals" tone="info">
          Open{' '}
          <Link to="/approvals" className="font-semibold text-primary underline-offset-2 hover:underline">
            Approvals
          </Link>{' '}
          to review, hold, deny, or release submitted results.
        </Alert>
      ) : (
        <Alert title="After you submit" tone="info">
          Your head of department or admin will review, deny, or release marks from Approvals.
          You cannot publish directly.
        </Alert>
      )}
    </div>
  )
}

function ClassSubjectMarksPanel() {
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
  const [paperCount, setPaperCount] = useState(1)
  const [includePractical, setIncludePractical] = useState(false)
  const [componentDrafts, setComponentDrafts] = useState<PaperDraft[]>([
    { key: 'paper1', maxScore: '100', weight: '1' },
  ])
  const [marks, setMarks] = useState<Mark[]>([])
  const maxScore = Number(maxScoreInput)
  const isPaperPeriod = isExamPaperPeriod(periodType)

  useEffect(() => {
    void (async () => {
      const [cls, subs, t] = await Promise.all([
        classService.list(),
        catalogService.getSubjects(),
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

  useEffect(() => {
    if (!classId) {
      setStudents([])
      return
    }
    let cancelled = false
    void studentService
      .list({ classId })
      .then((rows) => {
        if (!cancelled) setStudents(rows)
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) setStudents([])
      })
    return () => {
      cancelled = true
    }
  }, [classId])

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

  const [currentAssessment, setCurrentAssessment] = useState<Assessment | undefined>()

  const sheetId = useMemo(() => {
    if (!classId || !subjectId) return ''
    return assessmentKey(
      periodType,
      classId,
      subjectId,
      month,
      periodType === 'DAILY' ? date : weekOf,
      termId,
    )
  }, [classId, subjectId, periodType, month, date, weekOf, termId])

  async function reloadCurrentSheet() {
    if (!sheetId) {
      setCurrentAssessment(undefined)
      return
    }
    const row = await catalogService.getAssessment(sheetId)
    setCurrentAssessment(row ?? undefined)
  }

  useEffect(() => {
    let cancelled = false
    if (!sheetId) {
      setCurrentAssessment(undefined)
      return
    }
    void catalogService
      .getAssessment(sheetId)
      .then((row) => {
        if (!cancelled) setCurrentAssessment(row ?? undefined)
      })
      .catch(() => {
        if (!cancelled) setCurrentAssessment(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [sheetId])

  useEffect(() => {
    if (currentAssessment) setMaxScoreInput(String(currentAssessment.maxScore))
  }, [currentAssessment?.id, currentAssessment?.maxScore])

  useEffect(() => {
    if (!isPaperPeriod) return
    if (!currentAssessment || currentAssessment.id !== sheetId) {
      setPaperCount(1)
      setIncludePractical(false)
      setComponentDrafts([{ key: 'paper1', maxScore: '100', weight: '1' }])
      return
    }
    if (currentAssessment.components?.length) {
      const papers = currentAssessment.components.filter((row) => row.key !== 'practical')
      setPaperCount(papers.length || 1)
      setIncludePractical(currentAssessment.components.some((row) => row.key === 'practical'))
      setComponentDrafts(
        currentAssessment.components.map((row) => ({
          key: row.key,
          maxScore: String(row.maxScore),
          weight: String(row.weight),
        })),
      )
      return
    }
    setPaperCount(1)
    setIncludePractical(false)
    setComponentDrafts([
      { key: 'paper1', maxScore: String(currentAssessment.maxScore || 100), weight: '1' },
    ])
  }, [isPaperPeriod, sheetId, currentAssessment])

  useEffect(() => {
    if (!currentAssessment) {
      setMarks([])
      return
    }
    let cancelled = false
    void catalogService
      .getMarks(currentAssessment.id)
      .then((rows) => {
        if (!cancelled) setMarks(rows)
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) setMarks([])
      })
    return () => {
      cancelled = true
    }
  }, [currentAssessment?.id])

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
      const papers: Record<string, string> = {}
      if (m?.components?.length) {
        for (const component of m.components) papers[component.key] = String(component.score)
      }
      next[s.id] = {
        score: m && !m.components?.length ? String(m.score) : '',
        papers,
        commentMode: m?.commentMode ?? defaultCommentMode,
        comment: m?.comment ?? '',
      }
    }
    setEntries(next)
  }, [currentAssessment?.id, roster, marks, defaultCommentMode, periodType, currentAssessment?.components])

  function setEntry(studentId: string, patch: Partial<StudentEntry>) {
    setEntries((prev) => ({
      ...prev,
      [studentId]: {
        score: prev[studentId]?.score ?? '',
        papers: prev[studentId]?.papers ?? {},
        commentMode: prev[studentId]?.commentMode ?? defaultCommentMode,
        comment: prev[studentId]?.comment ?? '',
        ...patch,
      },
    }))
  }

  function setPaperScore(studentId: string, key: string, value: string) {
    setEntries((prev) => {
      const current = prev[studentId]
      return {
        ...prev,
        [studentId]: {
          score: current?.score ?? '',
          papers: { ...(current?.papers ?? {}), [key]: value },
          commentMode: current?.commentMode ?? defaultCommentMode,
          comment: current?.comment ?? '',
        },
      }
    })
  }

  function currentScheme() {
    return normalizeExamScheme(
      componentDrafts.map((draft) => ({
        key: draft.key,
        label: examComponentLabel(draft.key),
        maxScore: Number(draft.maxScore),
        weight: Number(draft.weight),
      })),
    )
  }

  function paperSymbol(papers: Record<string, string> | undefined) {
    const scheme = currentScheme()
    if (!scheme.ok) return '—'
    const final = paperFinalPercent(
      scheme.components,
      scheme.components.map((component) => ({
        key: component.key,
        score: Number(papers?.[component.key]),
      })),
    )
    if (!final.complete || final.invalid) return '—'
    return gradeFromScore(roundExamPercent(final.percent), 100, activeScale)
  }

  function paperPercent(papers: Record<string, string> | undefined) {
    const scheme = currentScheme()
    if (!scheme.ok) return null
    const final = paperFinalPercent(
      scheme.components,
      scheme.components.map((component) => ({
        key: component.key,
        score: Number(papers?.[component.key]),
      })),
    )
    if (!final.complete || final.invalid) return null
    return roundExamPercent(final.percent)
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
    const scheme = isPaperPeriod ? currentScheme() : null
    if (scheme && !scheme.ok) {
      notify.error(scheme.message)
      return
    }
    if (!isPaperPeriod && (!Number.isFinite(maxScore) || maxScore < 1 || maxScore > 1000)) {
      notify.error('Maximum mark must be between 1 and 1000')
      return
    }
    if (
      !isPaperPeriod &&
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
    if (scheme?.ok) {
      for (const student of roster) {
        const papers = entries[student.id]?.papers ?? {}
        const filled = scheme.components.filter((component) => papers[component.key]?.trim())
        if (filled.length === 0) continue
        if (filled.length !== scheme.components.length) {
          notify.error(`Enter every paper for ${fullName(student)}`)
          return
        }
        const final = paperFinalPercent(
          scheme.components,
          scheme.components.map((component) => ({
            key: component.key,
            score: Number(papers[component.key]),
          })),
        )
        if (final.invalid) {
          notify.error(`${fullName(student)}: ${final.message}`)
          return
        }
      }
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
        const mode = row?.commentMode ?? defaultCommentMode
        if (scheme?.ok) {
          const papers = row?.papers ?? {}
          if (scheme.components.some((component) => !papers[component.key]?.trim())) return null
          const components = scheme.components.map((component) => ({
            key: component.key,
            score: Number(papers[component.key]),
          }))
          const final = paperFinalPercent(scheme.components, components)
          if (!final.complete || final.invalid) return null
          const score = roundExamPercent(final.percent)
          const symbol = gradeFromScore(score, 100, activeScale)
          return {
            studentId: s.id,
            score,
            components,
            commentMode: mode,
            comment:
              mode === 'CUSTOM'
                ? row?.comment?.trim()
                : mode === 'AUTO'
                  ? autoCommentForGrade(symbol)
                  : undefined,
          }
        }
        if (!row?.score.trim()) return null
        const score = Number(row?.score)
        if (!Number.isFinite(score) || score < 0) return null
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
      components?: { key: ExamComponentKey; score: number }[]
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
            maxScore: scheme?.ok ? 100 : maxScore,
            ...(scheme?.ok ? { components: scheme.components } : {}),
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
      await reloadCurrentSheet()
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
          Choose daily, monthly, weekly, mock, or end-of-term. Mock and end-of-term exams take a
          mark for each paper, and a practical where the subject has one. The final symbol uses
          the paper ratio and this class&apos;s examination scale. Submit for admin approval.
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
          {isPaperPeriod ? null : (
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
          )}
        </div>

        {isPaperPeriod ? (
          <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="space-y-1.5">
                <Label>Papers written</Label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4].map((count) => (
                    <Button
                      key={count}
                      type="button"
                      size="sm"
                      variant={paperCount === count ? 'default' : 'outline'}
                      onClick={() => {
                        setPaperCount(count)
                        setComponentDrafts((prev) => applyPaperStructure(count, includePractical, prev))
                      }}
                    >
                      {count}
                    </Button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 pb-1 text-sm">
                <Checkbox
                  checked={includePractical}
                  onCheckedChange={(checked) => {
                    const on = checked === true
                    setIncludePractical(on)
                    setComponentDrafts((prev) => applyPaperStructure(paperCount, on, prev))
                  }}
                />
                Practical assessment
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1 font-medium">Component</th>
                    <th className="px-2 py-1 font-medium">Maximum mark</th>
                    <th className="px-2 py-1 font-medium">Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {componentDrafts.map((draft) => (
                    <tr key={draft.key}>
                      <td className="px-2 py-1 font-medium">{examComponentLabel(draft.key)}</td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          min={1}
                          max={1000}
                          className="w-28"
                          value={draft.maxScore}
                          onChange={(e) =>
                            setComponentDrafts((prev) =>
                              prev.map((row) =>
                                row.key === draft.key ? { ...row, maxScore: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <Input
                          type="number"
                          min={0.01}
                          step="0.01"
                          className="w-28"
                          value={draft.weight}
                          onChange={(e) =>
                            setComponentDrafts((prev) =>
                              prev.map((row) =>
                                row.key === draft.key ? { ...row, weight: e.target.value } : row,
                              ),
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              {(() => {
                const scheme = currentScheme()
                const track = gradingTrackLabel(
                  gradingTrackForLevel(selectedClass?.educationLevelId ?? selectedClass?.level),
                )
                if (!scheme.ok) return scheme.message
                return `${describeExamRatio(scheme.components)}. The final symbol uses the ${track} scale.`
              })()}
            </p>
          </div>
        ) : null}

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
                  {isPaperPeriod ? (
                    componentDrafts.map((draft) => (
                      <th key={draft.key} className="px-3 py-2">
                        {examComponentLabel(draft.key)}
                        {draft.maxScore ? ` /${draft.maxScore}` : ''}
                      </th>
                    ))
                  ) : (
                    <th className="px-3 py-2">Mark /{maxScore}</th>
                  )}
                  {isPaperPeriod ? <th className="px-3 py-2">Final %</th> : null}
                  <th className="px-3 py-2">
                    {isPaperPeriod ? 'Symbol' : isUnitsScale(activeScale) ? 'Units' : 'Grade'}
                  </th>
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
                    papers: {},
                    commentMode: defaultCommentMode,
                    comment: '',
                  }
                  const grade = isPaperPeriod ? paperSymbol(row.papers) : previewGrade(row.score)
                  const finalPercent = isPaperPeriod ? paperPercent(row.papers) : null
                  const showCustom =
                    defaultCommentMode === 'CUSTOM' || row.commentMode === 'CUSTOM'
                  return (
                    <tr key={s.id} className="border-t border-border">
                      <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2 font-medium">
                        {fullName(s)}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {s.studentNumber}
                        </span>
                        {isPaperPeriod &&
                        row.score &&
                        !Object.values(row.papers).some((value) => value.trim()) ? (
                          <p className="text-xs font-normal text-muted-foreground">
                            Previous single score {row.score}. Enter each paper to replace it.
                          </p>
                        ) : null}
                      </td>
                      {isPaperPeriod ? (
                        componentDrafts.map((draft) => (
                          <td key={draft.key} className="px-3 py-2">
                            <Input
                              type="number"
                              min={0}
                              max={Number(draft.maxScore) || undefined}
                              className="w-24"
                              value={row.papers[draft.key] ?? ''}
                              onChange={(e) => setPaperScore(s.id, draft.key, e.target.value)}
                            />
                          </td>
                        ))
                      ) : (
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
                      )}
                      {isPaperPeriod ? (
                        <td className="px-3 py-2 tabular-nums">
                          {finalPercent == null ? '—' : `${finalPercent}%`}
                        </td>
                      ) : null}
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
                          {grade !== '—' ? autoCommentForGrade(grade) : '—'}
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
          {currentAssessment &&
          currentAssessment.status !== 'PUBLISHED' &&
          currentAssessment.status !== 'LOCKED' &&
          (!isTeacher ||
            currentAssessment.status === 'DRAFT' ||
            currentAssessment.status === 'REJECTED') ? (
            <Button
              variant="destructive"
              loading={saving}
              onClick={() => {
                if (
                  !window.confirm(
                    'Delete this mark sheet and all its scores? This cannot be undone.',
                  )
                ) {
                  return
                }
                setSaving(true)
                void notify
                  .process(() => catalogService.deleteAssessment(currentAssessment.id), {
                    loading: 'Deleting…',
                    success: 'Mark sheet deleted',
                    error: 'Could not delete mark sheet',
                  })
                  .then(() => reloadCurrentSheet())
                  .finally(() => setSaving(false))
              }}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function ApprovalsPage() {
  const { hasPermission } = useAuth()
  const canApprove = hasPermission('results.approve')
  const [loading, setLoading] = useState(true)
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [ecdPending, setEcdPending] = useState<EcdChecklist[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [terms, setTerms] = useState<Term[]>([])

  async function reload() {
    const [pending, ecd, cls, st, t] = await Promise.all([
      catalogService.getPendingAssessments(),
      catalogService.getPendingEcdChecklists(),
      classService.list().catch(() => [] as SchoolClass[]),
      studentService.list().catch(() => [] as Student[]),
      catalogService.getTerms().catch(() => [] as Term[]),
    ])
    setAssessments(pending)
    setEcdPending(ecd)
    setClasses(cls)
    setStudents(st)
    setTerms(t)
  }

  useEffect(() => {
    reload()
      .catch(() => notify.error('Could not load approvals'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <LoadingState message="Loading approvals…" />
  if (!canApprove) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Approvals"
          description="Review submitted results."
          breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Approvals' }]}
        />
        <Alert title="No approval access" tone="warning">
          Your account can enter marks, but only an admin can review, deny, or release them.
        </Alert>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Approvals"
        description="Hold results for review, send them back, approve, delete, or release them to the portal."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Approvals' }]}
      />
      <EcdApprovalsPanel
        rows={ecdPending}
        classes={classes}
        students={students}
        terms={terms}
        onUpdated={reload}
      />
      <ResultsApprovalsPanel assessments={assessments} onUpdated={reload} />
    </div>
  )
}

function EcdApprovalsPanel({
  rows,
  classes,
  students,
  terms,
  onUpdated,
}: {
  rows: EcdChecklist[]
  classes: SchoolClass[]
  students: Student[]
  terms: Term[]
  onUpdated: () => Promise<void>
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const studentName = (id: string) => {
    const s = students.find((x) => x.id === id)
    return s ? fullName(s) : id
  }

  async function act(
    checklistId: string,
    status: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'PUBLISHED',
    messages: { loading: string; success: string; error: string },
    releaseToPortal = false,
  ) {
    setBusyId(checklistId)
    try {
      await notify.process(
        () =>
          catalogService.transitionEcdChecklist({
            checklistId,
            status,
            releaseToPortal,
          }),
        messages,
      )
      await onUpdated()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending ECD checklists</CardTitle>
        <p className="text-sm text-muted-foreground">
          Review and release ECD learner development sheets. Learners only see them after release,
          and only when fees are cleared.
        </p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ECD submissions waiting for approval.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {rows.map((row) => {
              const busy = busyId === row.id
              const open =
                row.status === 'SUBMITTED' ||
                row.status === 'COMPLETED' ||
                row.status === 'UNDER_REVIEW' ||
                row.status === 'APPROVED'
              return (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <p className="font-medium">{studentName(row.studentId)}</p>
                    <p className="text-xs text-muted-foreground">
                      {classes.find((c) => c.id === row.classId)?.name || row.classId} ·{' '}
                      {terms.find((t) => t.id === row.termId)?.name || row.termId} · ECD checklist
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      status={
                        row.status === 'COMPLETED' ? 'SUBMITTED' : row.status
                      }
                    />
                    {open ? (
                      <>
                        {row.status !== 'UNDER_REVIEW' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            loading={busy}
                            onClick={() =>
                              void act(row.id, 'UNDER_REVIEW', {
                                loading: 'Holding for review…',
                                success: 'Held for review',
                                error: 'Could not hold for review',
                              })
                            }
                          >
                            Review
                          </Button>
                        ) : null}
                        {row.status !== 'APPROVED' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy}
                            onClick={() =>
                              void act(row.id, 'APPROVED', {
                                loading: 'Approving…',
                                success: 'Approved — release when ready',
                                error: 'Could not approve',
                              })
                            }
                          >
                            Approve
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          loading={busy}
                          onClick={() =>
                            void act(
                              row.id,
                              'PUBLISHED',
                              {
                                loading: 'Releasing…',
                                success: 'Released to the student portal',
                                error: 'Could not release',
                              },
                              true,
                            )
                          }
                        >
                          Release
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          loading={busy}
                          onClick={() =>
                            void act(row.id, 'REJECTED', {
                              loading: 'Sending back…',
                              success: 'Denied — teacher can correct and resubmit',
                              error: 'Could not deny',
                            })
                          }
                        >
                          Deny
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
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
  const [deleteTarget, setDeleteTarget] = useState<Assessment | null>(null)
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
          a.status === 'APPROVED' ||
          a.status === 'REJECTED',
      )
      .filter((a) => !filterClass || a.classId === filterClass)
      .filter((a) => !filterSubject || a.subjectId === filterSubject)
      .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''))
  }, [assessments, filterClass, filterSubject])

  async function act(
    assessmentId: string,
    status: 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'PUBLISHED',
    messages: { loading: string; success: string; error: string },
    releaseToPortal = false,
  ) {
    setBusyId(assessmentId)
    try {
      await notify.process(
        () =>
          catalogService.transitionAssessment({
            assessmentId,
            status,
            releaseToPortal,
          }),
        messages,
      )
      await onUpdated()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending results</CardTitle>
        <p className="text-sm text-muted-foreground">
          Review, hold, deny, approve, delete, or release each submitted class sheet.
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
            {pending.map((a) => {
              const busy = busyId === a.id
              const open =
                a.status === 'SUBMITTED' ||
                a.status === 'UNDER_REVIEW' ||
                a.status === 'APPROVED'
              return (
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
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={a.status} />
                    {open ? (
                      <>
                        {a.status !== 'UNDER_REVIEW' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            loading={busy}
                            onClick={() =>
                              void act(a.id, 'UNDER_REVIEW', {
                                loading: 'Holding for review…',
                                success: 'Held for review',
                                error: 'Could not hold for review',
                              })
                            }
                          >
                            Review
                          </Button>
                        ) : null}
                        {a.status !== 'APPROVED' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy}
                            onClick={() =>
                              void act(a.id, 'APPROVED', {
                                loading: 'Approving…',
                                success: 'Approved — release when ready',
                                error: 'Could not approve',
                              })
                            }
                          >
                            Approve
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          loading={busy}
                          onClick={() =>
                            void act(
                              a.id,
                              'PUBLISHED',
                              {
                                loading: 'Releasing…',
                                success: 'Released to the student portal',
                                error: 'Could not release',
                              },
                              true,
                            )
                          }
                        >
                          Release
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          loading={busy}
                          onClick={() =>
                            void act(a.id, 'REJECTED', {
                              loading: 'Sending back…',
                              success: 'Denied — teacher can correct and resubmit',
                              error: 'Could not deny',
                            })
                          }
                        >
                          Deny
                        </Button>
                      </>
                    ) : null}
                    {a.status !== 'PUBLISHED' && a.status !== 'LOCKED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                        loading={busy}
                        onClick={() => setDeleteTarget(a)}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Delete this result sheet?"
        description={`“${deleteTarget?.name ?? 'This sheet'}” and all of its marks will be removed. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => {
          const target = deleteTarget
          if (!target) return
          setBusyId(target.id)
          void notify
            .process(() => catalogService.deleteAssessment(target.id), {
              loading: 'Deleting…',
              success: 'Deleted',
              error: 'Could not delete',
            })
            .then(() => onUpdated())
            .finally(() => {
              setBusyId(null)
              setDeleteTarget(null)
            })
        }}
      />
    </Card>
  )
}

export function ResultsPage() {
  const { user } = useAuth()
  const isStudent = user?.role === 'STUDENT'
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ResultPortalView | null>(null)
  const [ecdSheet, setEcdSheet] = useState<EcdChecklist | null>(null)

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        if (isStudent && user?.studentId) {
          const [portal, terms] = await Promise.all([
            catalogService.getResultPortal(user.studentId),
            catalogService.getTerms().catch(() => [] as Term[]),
          ])
          const termId = terms[0]?.id
          const sheet = termId
            ? await catalogService.getEcdChecklist(user.studentId, termId).catch(() => null)
            : null
          if (!mounted) return
          setView(portal)
          const released = sheet && isEcdReleasedToPortal(sheet.status)
          const feesOk = portal.accessState !== 'RESULTS_LOCKED_FEES'
          setEcdSheet(released && feesOk ? sheet : null)
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

  if (isStudent) {
    if (loading) return <LoadingState message="Loading results portal…" />
    return (
      <div className="space-y-4">
        <PageHeader
          title="My results"
          description="Monthly progress, end-of-term results, and teacher comments."
          breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Results' }]}
        />
        {ecdSheet ? (
          <EcdResultsSheet
            sheet={ecdSheet}
            learnerName={view?.studentName || user?.name || 'Learner'}
            className={view?.className}
            termName={view?.term}
          />
        ) : view ? (
          <StudentProgressCard view={view} />
        ) : (
          <Alert title="No results yet" tone="info">
            When your teachers submit marks and admin releases them, they will appear here.
          </Alert>
        )}
      </div>
    )
  }

  return <StaffClassResultsPage />
}

function paperFrom(assessment: Assessment, mark: Mark): StudentResultPaper {
  const satOn =
    assessment.type === 'DAILY'
      ? assessment.date
      : assessment.type === 'WEEKLY'
        ? assessment.weekOf ?? assessment.date
        : assessment.type === 'TERMLY'
          ? assessment.date
          : assessment.month
  const percent = assessment.maxScore > 0 ? (mark.score / assessment.maxScore) * 100 : 0
  return {
    id: `${assessment.id}:${mark.studentId}`,
    subject: assessment.name,
    title: assessment.name,
    satOn,
    publishedAt: assessment.approvedAt,
    score: mark.score,
    maxScore: assessment.maxScore,
    percent,
    grade: mark.grade,
    breakdown: formatMarkComponents(mark.components) || undefined,
    teacherName: assessment.enteredByName,
    comment: mark.comment,
  }
}

async function buildClassSlips(input: {
  classId: string
  className: string
  kind: SlipKind
  studentIds: string[]
  studentById: Map<string, Student>
}): Promise<ResultSlip[]> {
  const [school, assessments] = await Promise.all([
    catalogService.getSchoolProfile(),
    catalogService.getAssessments(),
  ])
  const released = assessments.filter(
    (a) =>
      a.classId === input.classId &&
      a.type === input.kind &&
      (a.status === 'PUBLISHED' || a.status === 'LOCKED') &&
      a.maxScore > 0,
  )
  const subjects = await catalogService.getSubjects().catch(() => [] as Subject[])
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]))
  const markGroups = await Promise.all(released.map((a) => catalogService.getMarks(a.id)))
  const wanted = new Set(input.studentIds)
  const byStudent = new Map<string, StudentResultPaper[]>()
  released.forEach((assessment, index) => {
    for (const mark of markGroups[index] ?? []) {
      if (!wanted.has(mark.studentId)) continue
      const paper = paperFrom(assessment, mark)
      paper.subject = subjectName.get(assessment.subjectId) || assessment.name
      const list = byStudent.get(mark.studentId) ?? []
      list.push(paper)
      byStudent.set(mark.studentId, list)
    }
  })
  const categoryLabel = SLIP_KINDS.find((k) => k[0] === input.kind)?.[1] ?? 'Results'
  const schoolInfo = {
    name: school.name,
    motto: school.motto,
    address: school.address,
    phone: school.phone,
    email: school.email,
  }
  return input.studentIds.flatMap((id) => {
    const papers = (byStudent.get(id) ?? []).sort(
      (a, b) =>
        (b.publishedAt || b.satOn || '').localeCompare(a.publishedAt || a.satOn || '') ||
        a.subject.localeCompare(b.subject),
    )
    if (papers.length === 0) return []
    const student = input.studentById.get(id)
    const average = papers.reduce((sum, paper) => sum + paper.percent, 0) / papers.length
    return [
      {
        school: schoolInfo,
        studentName: student ? fullName(student) : id,
        studentNumber: student?.studentNumber || '—',
        className: input.className,
        categoryLabel,
        papers,
        average,
      },
    ]
  })
}

async function buildSubjectClassSheet(input: {
  classId: string
  className: string
  kind: SlipKind
  subjectId: string
  students: Student[]
}): Promise<SubjectClassSheet | null> {
  const [school, assessments, subjects] = await Promise.all([
    catalogService.getSchoolProfile(),
    catalogService.getAssessments(),
    catalogService.getSubjects().catch(() => [] as Subject[]),
  ])
  const released = assessments
    .filter(
      (a) =>
        a.classId === input.classId &&
        a.subjectId === input.subjectId &&
        a.type === input.kind &&
        (a.status === 'PUBLISHED' || a.status === 'LOCKED') &&
        a.maxScore > 0,
    )
    .sort((a, b) => (a.approvedAt || a.date || a.month || '').localeCompare(b.approvedAt || b.date || b.month || ''))
  if (released.length === 0) return null
  const markGroups = await Promise.all(released.map((a) => catalogService.getMarks(a.id)))
  const markByStudent = released.map((assessment, index) => {
    const byStudent = new Map<string, Mark>()
    for (const mark of markGroups[index] ?? []) byStudent.set(mark.studentId, mark)
    return { assessment, byStudent }
  })
  const subjectName =
    subjects.find((s) => s.id === input.subjectId)?.name || released[0]?.name || 'Subject'
  const columns = markByStudent.map(({ assessment }) => ({
    id: assessment.id,
    label: formatResultDate(assessment.approvedAt || assessment.date || assessment.weekOf || assessment.month),
  }))
  const rows = [...input.students]
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .map((student) => {
      const marks: Record<string, string> = {}
      for (const column of markByStudent) {
        const mark = column.byStudent.get(student.id)
        const breakdown = mark ? formatMarkComponents(mark.components) : ''
        marks[column.assessment.id] = mark
          ? `${breakdown ? `${breakdown} → ` : ''}${mark.score}/${column.assessment.maxScore}${mark.grade ? ` ${mark.grade}` : ''}`
          : '—'
      }
      return {
        studentName: fullName(student),
        studentNumber: student.studentNumber || '—',
        marks,
      }
    })
  return {
    school: {
      name: school.name,
      motto: school.motto,
      address: school.address,
      phone: school.phone,
      email: school.email,
    },
    className: input.className,
    categoryLabel: SLIP_KINDS.find((k) => k[0] === input.kind)?.[1] ?? 'Results',
    subjectName,
    columns,
    rows,
  }
}

function currentMonthValue() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const SLIP_KINDS = [
  ['DAILY', 'Daily exercises'],
  ['WEEKLY', 'Weekly tests'],
  ['MONTHLY', 'Monthly tests'],
  ['MOCK', 'Mock tests'],
  ['TERMLY', 'End of term tests'],
] as const

type SlipKind = (typeof SLIP_KINDS)[number][0]

function StaffClassResultsPage() {
  const { user, hasPermission } = useAuth()
  const isTeacher = user?.role === 'TEACHER'
  const canPrintSlips = hasPermission('results.approve')
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [period, setPeriod] = useState<ClassResultsPeriod>('TERM')
  const [termId, setTermId] = useState('')
  const [month, setMonth] = useState(currentMonthValue())
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'number' | 'average'>('name')
  const [summary, setSummary] = useState<ClassResultsSummary | null>(null)
  const [loadingClasses, setLoadingClasses] = useState(true)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [view, setView] = useState<ResultPortalView | null>(null)
  const [ecdRows, setEcdRows] = useState<EcdChecklist[]>([])
  const [ecdSheet, setEcdSheet] = useState<EcdChecklist | null>(null)
  const [loadingEcd, setLoadingEcd] = useState(false)
  const [slipKind, setSlipKind] = useState<SlipKind>('MONTHLY')
  const [slipSubjectId, setSlipSubjectId] = useState('')
  const [printing, setPrinting] = useState<'one' | 'class' | 'subject' | null>(null)
  const selectedClass = classes.find((c) => c.id === classId)
  const ecdMode = Boolean(selectedClass && isEcdClass(selectedClass))

  useEffect(() => {
    let mounted = true
    void Promise.all([classService.list(), catalogService.getTerms(), catalogService.getSubjects()])
      .then(([cls, t, subs]) => {
        if (!mounted) return
        const active = cls
          .filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE')
          .sort((a, b) => a.name.localeCompare(b.name))
        setClasses(active)
        setTerms(t)
        const subjectList = [...subs].sort((a, b) => a.name.localeCompare(b.name))
        setSubjects(subjectList)
        setTermId((prev) => prev || t.find((x) => x.sequence === 1)?.id || t[0]?.id || '')
        setClassId((prev) => prev || active[0]?.id || '')
        setSubjectId((prev) => prev || (isTeacher ? subjectList[0]?.id || '' : ''))
      })
      .catch((err) => {
        console.error(err)
        notify.error('Could not load classes')
      })
      .finally(() => {
        if (mounted) setLoadingClasses(false)
      })
    return () => {
      mounted = false
    }
  }, [isTeacher])

  useEffect(() => {
    if (!classId) {
      setStudents([])
      return
    }
    let cancelled = false
    void studentService
      .list({ classId })
      .then((rows) => {
        if (!cancelled) setStudents(rows.filter((s) => s.status === 'ACTIVE'))
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) setStudents([])
      })
    return () => {
      cancelled = true
    }
  }, [classId])

  useEffect(() => {
    if (!classId || ecdMode) {
      setSummary(null)
      setLoadingSummary(false)
      return
    }
    if (period === 'TERM' && !termId) return
    if (period === 'MONTH' && !month) return
    let cancelled = false
    setLoadingSummary(true)
    void classService
      .getResultsSummary(classId, period === 'TERM' ? { period, termId } : { period, month })
      .then((res) => {
        if (!cancelled) setSummary(res)
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) {
          setSummary(null)
          notify.error('Could not load class results')
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false)
      })
    return () => {
      cancelled = true
    }
  }, [classId, period, termId, month, ecdMode])

  useEffect(() => {
    if (!ecdMode || !classId || !termId) {
      setEcdRows([])
      return
    }
    let cancelled = false
    setLoadingEcd(true)
    void catalogService
      .listEcdChecklists(classId, termId)
      .then((list) => {
        if (!cancelled) setEcdRows(list)
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) setEcdRows([])
      })
      .finally(() => {
        if (!cancelled) setLoadingEcd(false)
      })
    return () => {
      cancelled = true
    }
  }, [ecdMode, classId, termId])

  useEffect(() => {
    setSelectedId('')
    setView(null)
    setEcdSheet(null)
    setSearch('')
  }, [classId])

  useEffect(() => {
    if (!selectedId) {
      setView(null)
      setEcdSheet(null)
      return
    }
    let cancelled = false
    if (ecdMode) {
      if (!termId) return
      void catalogService
        .getEcdChecklist(selectedId, termId)
        .then((sheet) => {
          if (!cancelled) setEcdSheet(sheet)
        })
        .catch((err) => {
          console.error(err)
          if (!cancelled) {
            setEcdSheet(null)
            notify.error('Could not load this learner’s ECD checklist')
          }
        })
      return () => {
        cancelled = true
      }
    }
    void catalogService
      .getResultPortal(selectedId)
      .then((portal) => {
        if (!cancelled) setView(portal)
      })
      .catch((err) => {
        console.error(err)
        if (!cancelled) notify.error('Could not load this student\'s results')
      })
    return () => {
      cancelled = true
    }
  }, [selectedId, ecdMode, termId])

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])

  async function printSlips(scope: 'one' | 'class') {
    if (!canPrintSlips || !classId) return
    const ids = scope === 'one' ? (selectedId ? [selectedId] : []) : students.map((s) => s.id)
    if (ids.length === 0) {
      notify.error(scope === 'one' ? 'Select a learner first' : 'This class has no learners')
      return
    }
    setPrinting(scope)
    try {
      const slips = await buildClassSlips({
        classId,
        className: selectedClass?.name || 'Class',
        kind: slipKind,
        studentIds: ids,
        studentById,
      })
      if (slips.length === 0) {
        notify.error('No released results in this category')
        return
      }
      const label = SLIP_KINDS.find((k) => k[0] === slipKind)?.[1] ?? 'Results'
      const who =
        scope === 'one'
          ? (studentById.get(selectedId) ? fullName(studentById.get(selectedId)!) : 'learner')
          : selectedClass?.name || 'class'
      await downloadResultSlipsPdf(slips, `${label}-${who}`)
      notify.success(
        scope === 'one'
          ? 'Learner slip downloaded — all subjects on one sheet'
          : `Downloaded ${slips.length} separate learner sheets`,
      )
    } catch (err) {
      notify.error('Could not create the results slips', err instanceof Error ? err.message : undefined)
    } finally {
      setPrinting(null)
    }
  }

  async function printSubjectSheet() {
    if (!canPrintSlips || !classId || !slipSubjectId) return
    setPrinting('subject')
    try {
      const sheet = await buildSubjectClassSheet({
        classId,
        className: selectedClass?.name || 'Class',
        kind: slipKind,
        subjectId: slipSubjectId,
        students,
      })
      if (!sheet) {
        notify.error('No released results for this subject in the chosen category')
        return
      }
      await downloadSubjectClassSheetPdf(
        sheet,
        `${sheet.categoryLabel}-${sheet.subjectName}-${sheet.className}`,
      )
      notify.success('Class sheet downloaded — every learner on one sheet')
    } catch (err) {
      notify.error('Could not create the class sheet', err instanceof Error ? err.message : undefined)
    } finally {
      setPrinting(null)
    }
  }
  const selectedSubject = subjects.find((s) => s.id === subjectId)
  const ecdByStudent = useMemo(() => new Map(ecdRows.map((r) => [r.studentId, r])), [ecdRows])
  const visibleSubjects = useMemo(() => {
    const allowed = new Set(subjects.map((s) => s.id))
    const fromSummary = (summary?.subjects ?? []).filter(
      (s) => allowed.size === 0 || allowed.has(s.id),
    )
    if (subjectId) {
      const match = fromSummary.filter((s) => s.id === subjectId)
      if (match.length) return match
      if (selectedSubject) return [{ id: selectedSubject.id, name: selectedSubject.name }]
      return []
    }
    return fromSummary
  }, [summary, subjectId, selectedSubject, subjects])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = students.filter((s) => {
      if (!q) return true
      return (
        fullName(s).toLowerCase().includes(q) ||
        s.studentNumber?.toLowerCase().includes(q) ||
        s.admissionNumber?.toLowerCase().includes(q)
      )
    })
    const summaryByStudent = new Map((summary?.students ?? []).map((r) => [r.studentId, r]))
    const scoreFor = (studentId: string) => {
      const result = summaryByStudent.get(studentId)
      if (!subjectId) return result?.average ?? null
      return result?.subjects.find((s) => s.subjectId === subjectId)?.percent ?? null
    }
    list.sort((a, b) => {
      if (sortBy === 'number') {
        return (a.studentNumber || '').localeCompare(b.studentNumber || '', undefined, {
          numeric: true,
        })
      }
      if (sortBy === 'average') {
        return (scoreFor(b.id) ?? -1) - (scoreFor(a.id) ?? -1)
      }
      return fullName(a).localeCompare(fullName(b))
    })
    const ranked = [...list]
      .map((s) => ({ id: s.id, score: scoreFor(s.id) }))
      .filter((r) => r.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    const positionById = new Map<string, number>()
    ranked.forEach((r, i) => {
      const prev = ranked[i - 1]
      positionById.set(
        r.id,
        prev && prev.score === r.score ? (positionById.get(prev.id) ?? i) : i + 1,
      )
    })
    return list.map((s) => ({
      student: s,
      result: summaryByStudent.get(s.id),
      position: positionById.get(s.id),
    }))
  }, [students, summary, search, sortBy, subjectId])

  if (loadingClasses) return <LoadingState message="Loading classes…" />

  return (
    <div className="space-y-4">
      <PageHeader
        title="Results"
        description={
          ecdMode
            ? 'ECD results use the learner development checklist. Open a child to see ticks for each skill.'
            : isTeacher
              ? 'Your assigned classes and subjects. Pick a class and the subject you want to review.'
              : 'Choose a class and a subject to review marks, or leave subject as All to see the full class sheet.'
        }
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Results' }]}
      />

      <Card>
        <CardHeader>
          <CardTitle>{ecdMode ? 'ECD development results' : 'Class results'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label>Class</Label>
              <Select
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
              >
                <option value="">Select class…</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            {ecdMode ? null : (
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Select value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
                <option value="">All subjects</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            )}
            <div className="space-y-1.5">
              <Label>Period</Label>
              <Select
                value={ecdMode ? 'TERM' : period}
                onChange={(e) => setPeriod(e.target.value as ClassResultsPeriod)}
                disabled={ecdMode}
              >
                <option value="TERM">End of term</option>
                <option value="MONTH">Monthly</option>
              </Select>
            </div>
            {period === 'TERM' ? (
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
                <Label>Month</Label>
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Sort by</Label>
              <Select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'number' | 'average')}
              >
                <option value="name">Name</option>
                <option value="number">Student number</option>
                <option value="average">{subjectId ? 'Mark' : 'Average'}</option>
              </Select>
            </div>
          </div>

          {canPrintSlips && classId && !ecdMode ? (
            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Result slip category</Label>
                  <Select value={slipKind} onChange={(e) => setSlipKind(e.target.value as SlipKind)}>
                    {SLIP_KINDS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Subject for the class sheet</Label>
                  <Select value={slipSubjectId} onChange={(e) => setSlipSubjectId(e.target.value)}>
                    <option value="">Select a subject…</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  variant="outline"
                  loading={printing === 'one'}
                  disabled={!selectedId || printing !== null}
                  onClick={() => void printSlips('one')}
                >
                  Selected learner — one sheet
                </Button>
                <Button
                  variant="outline"
                  loading={printing === 'class'}
                  disabled={printing !== null}
                  onClick={() => void printSlips('class')}
                >
                  All class results — separate sheets
                </Button>
                <Button
                  loading={printing === 'subject'}
                  disabled={!slipSubjectId || printing !== null}
                  onClick={() => void printSubjectSheet()}
                >
                  This subject — one class sheet
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                A learner sheet lists every subject in the category on one page. All class results
                gives each learner their own page. The subject sheet lists every learner in this
                class on one sheet for the subject you pick. Click a learner in the table before
                downloading a single slip.
              </p>
            </div>
          ) : null}

          <SearchInput
            id="class-results-search"
            name="class-results-search"
            value={search}
            onChange={setSearch}
            placeholder="Search this class by name or student number"
          />

          {isTeacher && classes.length === 0 ? (
            <Alert title="No teaching assignments" tone="warning">
              Ask an admin to assign your classes and subjects on your staff record. Then you can
              open Results by class and subject here.
            </Alert>
          ) : !classId ? (
            <p className="text-sm text-muted-foreground">Select a class to view results.</p>
          ) : ecdMode && loadingEcd ? (
            <p className="text-sm text-muted-foreground">Loading ECD checklists…</p>
          ) : ecdMode ? (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2 text-center">✓ A</th>
                    <th className="px-3 py-2 text-center">✓ D</th>
                    <th className="px-3 py-2 text-center">✓ NY</th>
                    <th className="px-3 py-2">Overall</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td className="px-3 py-6 text-muted-foreground" colSpan={7}>
                        No learners in this class match the search.
                      </td>
                    </tr>
                  ) : (
                    rows.map(({ student }, index) => {
                      const sheet = ecdByStudent.get(student.id)
                      const summaryTicks = sheet ? summariseEcdRatings(sheet.ratings) : null
                      return (
                        <tr
                          key={student.id}
                          className={`cursor-pointer border-t border-border ${
                            selectedId === student.id ? 'bg-primary/5' : 'hover:bg-muted/40'
                          }`}
                          onClick={() => setSelectedId(student.id)}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                          <td className="px-3 py-2 font-medium">{fullName(student)}</td>
                          <td className="px-3 py-2 text-center font-semibold">
                            {summaryTicks ? summaryTicks.A : '—'}
                          </td>
                          <td className="px-3 py-2 text-center font-semibold">
                            {summaryTicks ? summaryTicks.D : '—'}
                          </td>
                          <td className="px-3 py-2 text-center font-semibold">
                            {summaryTicks ? summaryTicks.NY : '—'}
                          </td>
                          <td className="px-3 py-2 text-sm">
                            {sheet?.overall ? ECD_OVERALL_LABELS[sheet.overall] ?? '—' : '—'}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {sheet ? ecdStatusLabel(sheet.status) : 'Not started'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : loadingSummary ? (
            <p className="text-sm text-muted-foreground">Loading {selectedClass?.name} results…</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Student number</th>
                    <th className="px-3 py-2">Name</th>
                    {subjectId
                      ? null
                      : visibleSubjects.map((subject) => (
                          <th key={subject.id} className="px-3 py-2">
                            {subject.name}
                          </th>
                        ))}
                    <th className="px-3 py-2">{subjectId ? 'Mark' : 'Average'}</th>
                    <th className="px-3 py-2">Grade</th>
                    <th className="px-3 py-2">Pos</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        className="px-3 py-6 text-muted-foreground"
                        colSpan={subjectId ? 6 : 6 + visibleSubjects.length}
                      >
                        No students in this class match the search.
                      </td>
                    </tr>
                  ) : (
                    rows.map(({ student, result, position }, index) => {
                      const subjectScore = new Map(
                        (result?.subjects ?? []).map((s) => [s.subjectId, s]),
                      )
                      const focused = subjectId ? subjectScore.get(subjectId) : undefined
                      return (
                        <tr
                          key={student.id}
                          className={`cursor-pointer border-t border-border ${
                            selectedId === student.id ? 'bg-primary/5' : 'hover:bg-muted/40'
                          }`}
                          onClick={() => setSelectedId(student.id)}
                        >
                          <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {student.studentNumber || '—'}
                          </td>
                          <td className="px-3 py-2 font-medium">{fullName(student)}</td>
                          {subjectId
                            ? null
                            : visibleSubjects.map((subject) => {
                                const score = subjectScore.get(subject.id)
                                return (
                                  <td key={subject.id} className="px-3 py-2">
                                    {score
                                      ? `${score.score}/${score.maxScore} · ${score.grade}`
                                      : '—'}
                                  </td>
                                )
                              })}
                          <td className="px-3 py-2">
                            {focused
                              ? `${focused.score}/${focused.maxScore}`
                              : result?.average != null
                                ? `${result.average}%`
                                : '—'}
                          </td>
                          <td className="px-3 py-2 font-semibold">
                            {focused?.grade || result?.grade || '—'}
                          </td>
                          <td className="px-3 py-2">{position ?? '—'}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
          {classId ? (
            <p className="text-xs text-muted-foreground">
              {selectedClass?.name}
              {selectedSubject ? ` · ${selectedSubject.name}` : ' · all subjects'}: {rows.length}{' '}
              student(s). Click a row to open that student&apos;s full results sheet.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {ecdMode && selectedId && ecdSheet ? (
        <EcdResultsSheet
          sheet={ecdSheet}
          learnerName={
            studentById.get(selectedId) ? fullName(studentById.get(selectedId)!) : 'Learner'
          }
          className={selectedClass?.name}
          termName={terms.find((t) => t.id === termId)?.name}
        />
      ) : ecdMode && selectedId && !ecdSheet ? (
        <Alert title="No checklist for this term yet" tone="info">
          Open ECD checklist to tick this learner’s skills for the selected term.
        </Alert>
      ) : selectedId && view ? (
        <StudentProgressCard view={view} />
      ) : selectedId && !view ? (
        <p className="text-sm text-muted-foreground">
          Loading results for {studentById.get(selectedId) ? fullName(studentById.get(selectedId)!) : 'student'}…
        </p>
      ) : null}
    </div>
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
