import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { Alert } from '@/components/shared/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/auth-context'
import { EcdChecklistTicks } from '@/components/shared/ecd-checklist-ticks'
import {
  ECD_EXPECTATIONS,
  ECD_OVERALL_LABELS,
  ageFromDateOfBirth,
  ecdStageLabel,
  isEcdClass,
  resolveEcdStage,
  summariseEcdRatings,
  type EcdRating,
} from '@/lib/ecd-checklist'
import { notify } from '@/lib/notify'
import { catalogService, classService, studentService } from '@/services/api'
import { cn, fullName } from '@/lib/utils'
import type {
  AcademicYear,
  EcdChecklist,
  EcdChecklistSignature,
  EcdChecklistWrite,
  EcdOverallProgress,
  SchoolClass,
  Staff,
  Student,
  Term,
} from '@/types'

const emptySignatures = {
  classTeacher: { name: '', date: '' },
  ecdCoordinator: { name: '', date: '' },
  principal: { name: '', date: '' },
  parentGuardian: { name: '', date: '' },
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export function EcdChecklistPage() {
  const { user, hasPermission } = useAuth()
  const canEnter = hasPermission('results.enter')
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [years, setYears] = useState<AcademicYear[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [rows, setRows] = useState<EcdChecklist[]>([])
  const classId = searchParams.get('classId') ?? ''
  const termId = searchParams.get('termId') ?? ''
  const studentId = searchParams.get('studentId') ?? ''

  useEffect(() => {
    void (async () => {
      try {
        const [cls, t, y, st] = await Promise.all([
          classService.list(),
          catalogService.getTerms(),
          catalogService.getYears(),
          catalogService.getStaff().catch(() => [] as Staff[]),
        ])
        const ecd = cls.filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE' && isEcdClass(c))
        setClasses(ecd)
        setTerms(t)
        setYears(y)
        setStaff(st)
        const nextClass = classId && ecd.some((c) => c.id === classId) ? classId : ecd[0]?.id ?? ''
        const nextTerm = termId && t.some((x) => x.id === termId) ? termId : t[0]?.id ?? ''
        if (nextClass !== classId || nextTerm !== termId) {
          const next = new URLSearchParams(searchParams)
          if (nextClass) next.set('classId', nextClass)
          if (nextTerm) next.set('termId', nextTerm)
          setSearchParams(next, { replace: true })
        }
      } catch (err) {
        console.error(err)
        notify.error('Could not load ECD classes')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once
  }, [])

  useEffect(() => {
    if (!classId) {
      setStudents([])
      return
    }
    let cancelled = false
    void studentService
      .list({ classId })
      .then((list) => {
        if (!cancelled) setStudents(list.filter((s) => s.status === 'ACTIVE'))
      })
      .catch(() => {
        if (!cancelled) setStudents([])
      })
    return () => {
      cancelled = true
    }
  }, [classId])

  async function reloadRows() {
    if (!classId || !termId) {
      setRows([])
      return
    }
    const list = await catalogService.listEcdChecklists(classId, termId)
    setRows(list)
  }

  useEffect(() => {
    void reloadRows().catch(() => notify.error('Could not load ECD checklists'))
  }, [classId, termId])

  function setParam(patch: Record<string, string>) {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setSearchParams(next)
  }

  const selectedClass = classes.find((c) => c.id === classId)
  const selectedTerm = terms.find((t) => t.id === termId)
  const selectedYear = years.find((y) => y.id === selectedClass?.academicYearId)
  const teacher = staff.find((s) => s.id === selectedClass?.classTeacherId)
  const teacherName = teacher
    ? `${teacher.firstName} ${teacher.lastName}`.trim()
    : user?.name ?? ''

  if (loading) return <LoadingState message="Loading ECD checklist…" />

  if (classes.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="ECD learner development"
          description="Official VISTE ECD A and ECD B progress checklist."
          breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'ECD checklist' }]}
        />
        <Alert title="No ECD class found" tone="warning">
          Create an ECD A or ECD B class (education level ECD / ECD A / ECD B), then return here
          to assess each learner once per term.
        </Alert>
      </div>
    )
  }

  const student = students.find((s) => s.id === studentId)

  return (
    <div className="space-y-4 print:space-y-2">
      <PageHeader
        title="ECD learner development checklist"
        description="Visionary Institute of Science and Technology Education — continuous, termly monitoring of every ECD A and ECD B learner."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'ECD checklist' }]}
      />

      <Card className="print:hidden">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Class</Label>
            <Select
              value={classId}
              onChange={(e) => setParam({ classId: e.target.value, studentId: '' })}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Term</Label>
            <Select
              value={termId}
              onChange={(e) => setParam({ termId: e.target.value, studentId: '' })}
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Academic year</Label>
            <Input value={selectedYear?.name ?? '—'} readOnly />
          </div>
        </CardContent>
      </Card>

      {student && selectedClass && selectedTerm ? (
        <EcdChecklistForm
          student={student}
          klass={selectedClass}
          term={selectedTerm}
          yearName={selectedYear?.name ?? ''}
          teacherName={teacherName}
          existing={rows.find((r) => r.studentId === student.id)}
          canEnter={canEnter}
          onBack={() => setParam({ studentId: '' })}
          onSaved={reloadRows}
        />
      ) : (
        <EcdRoster
          students={students}
          rows={rows}
          className={selectedClass?.name ?? ''}
          educationLevelId={selectedClass?.educationLevelId}
          onOpen={(id) => setParam({ studentId: id })}
        />
      )}
    </div>
  )
}

function EcdRoster({
  students,
  rows,
  className,
  educationLevelId,
  onOpen,
}: {
  students: Student[]
  rows: EcdChecklist[]
  className: string
  educationLevelId?: string
  onOpen: (id: string) => void
}) {
  const byStudent = useMemo(() => new Map(rows.map((r) => [r.studentId, r])), [rows])
  const stage = resolveEcdStage(className, educationLevelId)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {className || 'Class'} · {ecdStageLabel(stage)}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Assess each learner at least once this term. Previous terms stay on file so progress can
          be compared. Attach work samples (writing, drawings, number work) alongside this
          checklist.
        </p>
      </CardHeader>
      <CardContent>
        {students.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active learners in this class.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {students
              .slice()
              .sort((a, b) => fullName(a).localeCompare(fullName(b)))
              .map((s) => {
                const sheet = byStudent.get(s.id)
                const summary = sheet ? summariseEcdRatings(sheet.ratings) : null
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="font-medium">{fullName(s)}</p>
                      <p className="text-xs text-muted-foreground">
                        {sheet
                          ? `${sheet.status === 'COMPLETED' ? 'Completed' : 'Draft'} · ${summary?.A ?? 0} achieved · ${summary?.D ?? 0} developing · ${summary?.NY ?? 0} not yet`
                          : 'Not started this term'}
                      </p>
                    </div>
                    <Button size="sm" variant={sheet ? 'outline' : 'default'} onClick={() => onOpen(s.id)}>
                      {sheet ? 'Open checklist' : 'Start assessment'}
                    </Button>
                  </li>
                )
              })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function EcdChecklistForm({
  student,
  klass,
  term,
  yearName,
  teacherName,
  existing,
  canEnter,
  onBack,
  onSaved,
}: {
  student: Student
  klass: SchoolClass
  term: Term
  yearName: string
  teacherName: string
  existing?: EcdChecklist
  canEnter: boolean
  onBack: () => void
  onSaved: () => Promise<void>
}) {
  const stage = existing?.stage ?? resolveEcdStage(klass.name, klass.educationLevelId)
  const [saving, setSaving] = useState(false)
  const [assessedAt, setAssessedAt] = useState(existing?.assessedAt ?? todayIso())
  const [classTeacherName, setClassTeacherName] = useState(
    existing?.classTeacherName || teacherName,
  )
  const [ageYears, setAgeYears] = useState(
    existing?.ageYears || ageFromDateOfBirth(student.dateOfBirth),
  )
  const [attendanceNote, setAttendanceNote] = useState(existing?.attendanceNote ?? '')
  const [ratings, setRatings] = useState<Record<string, EcdRating | ''>>(
    () => existing?.ratings ?? {},
  )
  const [strengths, setStrengths] = useState(existing?.strengths ?? '')
  const [improvements, setImprovements] = useState(existing?.improvements ?? '')
  const [interventions, setInterventions] = useState(existing?.interventions ?? '')
  const [comments, setComments] = useState(existing?.comments ?? '')
  const [overall, setOverall] = useState<EcdOverallProgress | ''>(existing?.overall ?? '')
  const [signatures, setSignatures] = useState({
    classTeacher: existing?.signatures.classTeacher ?? emptySignatures.classTeacher,
    ecdCoordinator: existing?.signatures.ecdCoordinator ?? emptySignatures.ecdCoordinator,
    principal: existing?.signatures.principal ?? emptySignatures.principal,
    parentGuardian: existing?.signatures.parentGuardian ?? emptySignatures.parentGuardian,
  })

  useEffect(() => {
    setAssessedAt(existing?.assessedAt ?? todayIso())
    setClassTeacherName(existing?.classTeacherName || teacherName)
    setAgeYears(existing?.ageYears || ageFromDateOfBirth(student.dateOfBirth))
    setAttendanceNote(existing?.attendanceNote ?? '')
    setRatings(existing?.ratings ?? {})
    setStrengths(existing?.strengths ?? '')
    setImprovements(existing?.improvements ?? '')
    setInterventions(existing?.interventions ?? '')
    setComments(existing?.comments ?? '')
    setOverall(existing?.overall ?? '')
    setSignatures({
      classTeacher: existing?.signatures.classTeacher ?? emptySignatures.classTeacher,
      ecdCoordinator: existing?.signatures.ecdCoordinator ?? emptySignatures.ecdCoordinator,
      principal: existing?.signatures.principal ?? emptySignatures.principal,
      parentGuardian: existing?.signatures.parentGuardian ?? emptySignatures.parentGuardian,
    })
  }, [existing?.id, student.id, teacherName, student.dateOfBirth])

  const summary = summariseEcdRatings(ratings)

  async function save(status: 'DRAFT' | 'COMPLETED') {
    if (!canEnter) return
    setSaving(true)
    try {
      const cleaned: Record<string, EcdRating> = {}
      for (const [key, value] of Object.entries(ratings)) {
        if (value === 'A' || value === 'D' || value === 'NY' || value === 'NA') cleaned[key] = value
      }
      await notify.process(
        () =>
          catalogService.upsertEcdChecklist({
            studentId: student.id,
            classId: klass.id,
            termId: term.id,
            academicYearId: klass.academicYearId,
            stage,
            status,
            assessedAt,
            classTeacherName,
            ageYears,
            attendanceNote,
            ratings: cleaned,
            strengths,
            improvements,
            interventions,
            comments,
            overall: overall || undefined,
            signatures,
          } satisfies EcdChecklistWrite),
        {
          loading: status === 'COMPLETED' ? 'Saving completed checklist…' : 'Saving draft…',
          success:
            status === 'COMPLETED'
              ? 'Checklist completed for this term'
              : 'Draft saved — you can finish later',
          error: 'Could not save the checklist',
        },
      )
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  function setSig(
    key: keyof typeof signatures,
    patch: Partial<EcdChecklistSignature>,
  ) {
    setSignatures((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" onClick={onBack}>
          Back to class list
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          Print / parent report
        </Button>
      </div>

      <Card>
        <CardHeader>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Visionary Institute of Science and Technology Education
          </p>
          <CardTitle>ECD A &amp; ECD B learner development and progress checklist</CardTitle>
          <p className="text-sm text-muted-foreground">
            Motto: Preserving The Salience of Our Success. Same instrument for both classes;
            expected achievement is higher in ECD B. This is developmental monitoring, not a
            pass/fail exam.
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Learner’s full name" value={fullName(student)} />
          <Field label="Class" value={`${klass.name} · ${ecdStageLabel(stage)}`} />
          <Field label="Academic year" value={yearName || '—'} />
          <Field label="Term" value={term.name} />
          <div className="space-y-1.5">
            <Label>Date of assessment</Label>
            <Input type="date" value={assessedAt} onChange={(e) => setAssessedAt(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Class teacher</Label>
            <Input value={classTeacherName} onChange={(e) => setClassTeacherName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Age (years)</Label>
            <Input value={ageYears} onChange={(e) => setAgeYears(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Attendance</Label>
            <Input
              value={attendanceNote}
              onChange={(e) => setAttendanceNote(e.target.value)}
              placeholder="e.g. Regular / 46 of 50 days"
            />
          </div>
        </CardContent>
      </Card>

      <Alert title="Assessment key" tone="info">
        <span className="block sm:inline">A — Achieved. </span>
        <span className="block sm:inline">D — Developing. </span>
        <span className="block sm:inline">NY — Not yet. </span>
        <span className="block sm:inline">NA — Not applicable.</span>
      </Alert>

      <p className="text-sm text-muted-foreground print:hidden">
        {summary.A} achieved · {summary.D} developing · {summary.NY} not yet · {summary.blank} still
        blank of {summary.total}
      </p>

      <EcdChecklistTicks
        ratings={ratings}
        readOnly={!canEnter}
        onChange={(id, rating) =>
          setRatings((prev) => ({
            ...prev,
            [id]: rating,
          }))
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Teacher’s overall evaluation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Learner’s strengths</Label>
            <Textarea rows={3} value={strengths} onChange={(e) => setStrengths(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Areas requiring improvement</Label>
            <Textarea
              rows={3}
              value={improvements}
              onChange={(e) => setImprovements(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Recommended intervention or remedial activities</Label>
            <Textarea
              rows={3}
              value={interventions}
              onChange={(e) => setInterventions(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>General teacher’s comments</Label>
            <Textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Overall developmental assessment</Label>
            <Select
              value={overall}
              onChange={(e) => setOverall(e.target.value as EcdOverallProgress | '')}
            >
              <option value="">Select…</option>
              {(Object.keys(ECD_OVERALL_LABELS) as EcdOverallProgress[]).map((key) => (
                <option key={key} value={key}>
                  {ECD_OVERALL_LABELS[key]}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Signatures</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['classTeacher', 'Class teacher'],
              ['ecdCoordinator', 'ECD coordinator'],
              ['principal', 'Principal'],
              ['parentGuardian', 'Parent / guardian'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="grid gap-2 rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{label}</p>
              <Input
                placeholder="Name"
                value={signatures[key].name}
                onChange={(e) => setSig(key, { name: e.target.value })}
              />
              <Input
                type="date"
                value={signatures[key].date}
                onChange={(e) => setSig(key, { date: e.target.value })}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="print:break-inside-avoid">
        <CardHeader>
          <CardTitle>Different expectations for ECD A and ECD B</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Area</th>
                <th className={cn('py-2 pr-3 font-medium', stage === 'ECD_A' && 'text-foreground')}>
                  ECD A
                </th>
                <th className={cn('py-2 font-medium', stage === 'ECD_B' && 'text-foreground')}>
                  ECD B
                </th>
              </tr>
            </thead>
            <tbody>
              {ECD_EXPECTATIONS.map((row) => (
                <tr key={row.area} className="border-b border-border/70 align-top">
                  <td className="py-2 pr-3 font-medium">{row.area}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{row.ecdA}</td>
                  <td className="py-2 text-muted-foreground">{row.ecdB}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-muted-foreground">
            Assess against {ecdStageLabel(stage)} expectations, considering the learner’s age and
            opportunities to learn. Share a brief copy of this report with parents.
          </p>
        </CardContent>
      </Card>

      {canEnter ? (
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button loading={saving} variant="outline" onClick={() => void save('DRAFT')}>
            Save draft
          </Button>
          <Button loading={saving} onClick={() => void save('COMPLETED')}>
            Complete this term’s assessment
          </Button>
        </div>
      ) : (
        <Alert title="View only" tone="warning">
          Your account can read ECD checklists. Entering ratings requires results entry permission.
        </Alert>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input value={value} readOnly />
    </div>
  )
}