import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Archive,
  ArrowRightLeft,
  Baby,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FilePlus2,
  GraduationCap,
  MessageSquareText,
  Plus,
  School,
  Trash2,
  Users,
  UserCheck,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { EmptyState } from '@/components/shared/empty-state'
import { SearchInput } from '@/components/shared/search-input'
import { StatCard } from '@/components/shared/stat-card'
import { StatusBadge } from '@/components/shared/status-badge'
import { Badge } from '@/components/ui/badge'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  DataTableShell,
} from '@/components/shared/data-table'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuth } from '@/contexts/auth-context'
import { EDUCATION_LEVELS, educationLevelName } from '@/lib/education-levels'
import { notify } from '@/lib/notify'
import { canManageClasses } from '@/lib/roles'
import { catalogService, classService, studentService } from '@/services/api'
import { cn } from '@/lib/utils'
import type {
  AcademicYear,
  SchoolClass,
  Staff,
  Student,
  StudentClassStats,
  Subject,
  Term,
} from '@/types'

type ClassForm = {
  name: string
  educationLevelId: string
  academicYearId: string
  termSequence: 1 | 2 | 3
  classTeacherId: string
  subjectIds: string[]
  description: string
}

const emptyForm = (): ClassForm => ({
  name: '',
  educationLevelId: 'form-1',
  academicYearId: '',
  termSequence: 1,
  classTeacherId: '',
  subjectIds: [],
  description: '',
})

export function ClassesPage() {
  const { user } = useAuth()
  const canManage = user ? canManageClasses(user.role) : false
  const isTeacher = user?.role === 'TEACHER'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [staffSelf, setStaffSelf] = useState<Staff | null>(null)
  const [students, setStudents] = useState<Student[]>([])
  const [years, setYears] = useState<AcademicYear[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [stats, setStats] = useState<StudentClassStats | null>(null)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('ACTIVE')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SchoolClass | null>(null)
  const [form, setForm] = useState<ClassForm>(emptyForm())

  async function reload() {
    const [c, sf, stu, y, t, sub, st] = await Promise.all([
      classService.list(),
      catalogService.getStaff().catch(() => [] as Staff[]),
      studentService.list(),
      catalogService.getYears(),
      catalogService.getTerms(),
      catalogService.getSubjects(),
      classService.getStats().catch(() => null),
    ])
    setClasses(c)
    setStaff(sf)
    setStudents(stu)
    setYears(y)
    setTerms(t)
    setSubjects(sub)
    setStats(st)
    if (user?.staffId) {
      const me =
        sf.find((s) => s.id === user.staffId) ??
        (await catalogService.getStaffMember(user.staffId).catch(() => null))
      setStaffSelf(me ?? null)
    } else {
      setStaffSelf(null)
    }
  }

  useEffect(() => {
    reload()
      .catch((err) => {
        console.error(err)
        notify.error('Could not load classes')
      })
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return classes.filter((c) => {
      const status = c.status ?? 'ACTIVE'
      const matchesStatus = statusFilter === 'all' || status === statusFilter
      const matchesLevel = levelFilter === 'all' || c.educationLevelId === levelFilter
      const matchesSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.level ?? '').toLowerCase().includes(q) ||
        educationLevelName(c.educationLevelId).toLowerCase().includes(q)
      return matchesStatus && matchesLevel && matchesSearch
    })
  }, [classes, search, levelFilter, statusFilter])

  const myOwnedClasses = useMemo(() => {
    if (!user?.staffId) return []
    return filtered.filter((c) => c.classTeacherId === user.staffId)
  }, [filtered, user?.staffId])

  const taughtClasses = useMemo(() => {
    if (!isTeacher) return []
    // list() is already scoped to this teacher's classes
    return filtered
  }, [filtered, isTeacher])

  const taughtSubjectIds = useMemo(() => {
    const fromStaff = new Set(staffSelf?.subjectIds ?? [])
    for (const s of subjects) {
      if (user?.staffId && (s.teacherIds ?? []).includes(user.staffId)) {
        fromStaff.add(s.id)
      }
    }
    return fromStaff
  }, [staffSelf?.subjectIds, subjects, user?.staffId])

  function subjectsForClass(cls: SchoolClass) {
    const classSubs = cls.subjectIds?.length
      ? subjects.filter((s) => (cls.subjectIds ?? []).includes(s.id))
      : subjects
    if (!isTeacher) return classSubs
    return classSubs.filter((s) => taughtSubjectIds.has(s.id))
  }

  const currentYear = useMemo(
    () => years.find((y) => y.isCurrent) ?? years[0],
    [years],
  )

  const levelSubjects = useMemo(() => {
    return subjects.filter((s) => {
      if (s.active === false) return false
      if (!s.educationLevelIds?.length) return true
      return s.educationLevelIds.includes(form.educationLevelId)
    })
  }, [subjects, form.educationLevelId])

  function toggleSubject(id: string) {
    setForm((f) => ({
      ...f,
      subjectIds: f.subjectIds.includes(id)
        ? f.subjectIds.filter((x) => x !== id)
        : [...f.subjectIds, id],
    }))
  }

  function openCreate() {
    setEditing(null)
    setForm({
      ...emptyForm(),
      academicYearId: currentYear?.id ?? '',
      termSequence: 1,
      subjectIds: [],
    })
    setOpen(true)
  }

  function openEdit(cls: SchoolClass) {
    const seq =
      (cls.termSequence as 1 | 2 | 3 | undefined) ||
      (terms.find((t) => t.id === cls.termId)?.sequence as 1 | 2 | 3 | undefined) ||
      1
    setEditing(cls)
    setForm({
      name: cls.name,
      educationLevelId: cls.educationLevelId ?? 'form-1',
      academicYearId: cls.academicYearId || currentYear?.id || '',
      termSequence: seq,
      classTeacherId: cls.classTeacherId ?? '',
      subjectIds: [...(cls.subjectIds ?? [])],
      description: cls.description ?? '',
    })
    setOpen(true)
  }

  async function saveClass() {
    if (!form.name.trim() || !form.educationLevelId) {
      notify.error('Class name and education level are required')
      return
    }
    if (![1, 2, 3].includes(form.termSequence)) {
      notify.error('Select Term 1, 2, or 3')
      return
    }
    if (!form.classTeacherId) {
      notify.error('Select a class teacher')
      return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        educationLevelId: form.educationLevelId,
        // Server fills current academic year when blank
        academicYearId: form.academicYearId || currentYear?.id || undefined,
        termSequence: form.termSequence,
        classTeacherId: form.classTeacherId,
        subjectIds: form.subjectIds,
        description: form.description.trim() || undefined,
      }
      if (editing) {
        await notify.process(() => classService.update(editing.id, payload), {
          loading: 'Updating class…',
          success: 'Class updated',
        })
      } else {
        await notify.process(() => classService.create(payload), {
          loading: 'Creating class…',
          success: 'Class created',
        })
      }
      setOpen(false)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function deleteClass(cls: SchoolClass) {
    const count = students.filter((s) => s.classId === cls.id).length
    if (count > 0) {
      notify.error(
        'Cannot delete this class',
        `${count} student(s) are still assigned. Transfer them first.`,
      )
      return
    }
    if (
      !confirm(
        `Permanently delete class “${cls.name}”? This cannot be undone.`,
      )
    ) {
      return
    }
    await notify.process(() => classService.remove(cls.id), {
      loading: 'Deleting class…',
      success: 'Class deleted',
      error: 'Could not delete class',
    })
    await reload()
  }

  if (loading) return <LoadingState message="Loading classes…" />

  if (isTeacher && !canManage) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="My classes"
          description="Mark registers for your class, view students, and create tests for subjects you teach."
          breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Classes' }]}
        />

        <section className="space-y-3">
          <div>
            <h2 className="font-display text-lg font-semibold">My class</h2>
            <p className="text-sm text-muted-foreground">
              Classes where you are the class teacher — mark the daily register, view the student list,
              write final report comments, and keep the duty roster.
            </p>
          </div>
          {myOwnedClasses.length === 0 ? (
            <EmptyState
              icon={School}
              title="No class teacher assignment"
              description="When an admin assigns you as class teacher, that class appears here."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {myOwnedClasses.map((cls) => {
                const count = students.filter(
                  (s) => s.classId === cls.id && s.status === 'ACTIVE',
                ).length
                return (
                  <Card key={cls.id}>
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base">{cls.name}</CardTitle>
                          <p className="text-sm text-muted-foreground">
                            {educationLevelName(cls.educationLevelId) || cls.level} · {count}{' '}
                            students
                          </p>
                        </div>
                        <Badge>My class</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      <Button asChild size="sm">
                        <Link to={`/attendance?classId=${cls.id}`}>
                          <ClipboardList className="h-4 w-4" />
                          Mark register
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/classes/${cls.id}`}>
                          <Users className="h-4 w-4" />
                          Student list
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/classes/${cls.id}?open=reports`}>
                          <MessageSquareText className="h-4 w-4" />
                          Final report comments
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link to={`/classes/${cls.id}?open=duty`}>
                          <CalendarDays className="h-4 w-4" />
                          Duty roster
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Classes I teach</h2>
            <p className="text-sm text-muted-foreground">
              Create a monthly, weekly, or mock test for each subject you teach, then record marks and
              comments.
            </p>
          </div>
          {taughtClasses.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="No teaching classes"
              description="Ask an admin to assign classes and subjects on your teacher profile."
            />
          ) : (
            <div className="space-y-3">
              {taughtClasses.map((cls) => {
                const teachSubs = subjectsForClass(cls)
                const count = students.filter(
                  (s) => s.classId === cls.id && s.status === 'ACTIVE',
                ).length
                const isMine = cls.classTeacherId === user?.staffId
                return (
                  <Card key={`teach-${cls.id}`}>
                    <CardContent className="space-y-3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">
                            {cls.name}
                            {isMine ? (
                              <Badge className="ml-2 text-[10px]" variant="secondary">
                                My class
                              </Badge>
                            ) : null}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {educationLevelName(cls.educationLevelId) || cls.level} · {count}{' '}
                            students
                          </p>
                        </div>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/classes/${cls.id}`}>Open class</Link>
                        </Button>
                      </div>
                      {teachSubs.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No subjects assigned to you for this class yet.
                        </p>
                      ) : (
                        <ul className="space-y-2">
                          {teachSubs.map((sub) => (
                            <li
                              key={sub.id}
                              className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                            >
                              <div className="flex items-center gap-2">
                                <FilePlus2 className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">{sub.name}</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                <Button asChild size="sm" variant="outline">
                                  <Link
                                    to={`/examinations?classId=${cls.id}&subjectId=${sub.id}&periodType=MONTHLY`}
                                  >
                                    Monthly
                                  </Link>
                                </Button>
                                <Button asChild size="sm" variant="outline">
                                  <Link
                                    to={`/examinations?classId=${cls.id}&subjectId=${sub.id}&periodType=WEEKLY`}
                                  >
                                    Weekly
                                  </Link>
                                </Button>
                                <Button asChild size="sm" variant="outline">
                                  <Link
                                    to={`/examinations?classId=${cls.id}&subjectId=${sub.id}&periodType=MOCK`}
                                  >
                                    Mock
                                  </Link>
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Class Management"
        description={
          canManage
            ? 'Manage ECD through Form 6 classes for the current academic structure.'
            : 'Your class-teacher classes and the classes you teach.'
        }
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Classes' }]}
        actions={
          canManage ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Create class
            </Button>
          ) : null
        }
      />

      {stats ? (
        <div className="mb-4 grid w-full max-w-4xl grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-8">
          <StatCard compact label="Students" value={String(stats.totalStudents)} icon={Users} />
          <StatCard compact label="Classes" value={String(stats.totalClasses)} icon={School} />
          <StatCard compact label="ECD" value={String(stats.ecdStudents)} icon={Baby} />
          <StatCard
            compact
            label="Primary"
            value={String(stats.primaryStudents)}
            icon={BookOpen}
          />
          <StatCard
            compact
            label="Secondary"
            value={String(stats.secondaryStudents)}
            icon={GraduationCap}
          />
          <StatCard
            compact
            label="Active"
            value={String(stats.activeStudents)}
            icon={UserCheck}
            tone="success"
          />
          <StatCard
            compact
            label="Transferred"
            value={String(stats.transferredStudents)}
            icon={ArrowRightLeft}
            tone="warning"
          />
          <StatCard
            compact
            label="Archived"
            value={String(stats.archivedStudents)}
            icon={Archive}
          />
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search classes…"
          className="sm:max-w-xs"
        />
        <Select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
          <option value="all">All levels</option>
          {EDUCATION_LEVELS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
          <option value="all">All statuses</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={School}
          title="No classes yet"
          description={
            canManage
              ? 'Create your first class — ECD A, Grade 4 Blue, Form 1A, and more.'
              : 'No classes match your filters.'
          }
          actionLabel={canManage ? 'Create class' : undefined}
          onAction={canManage ? openCreate : undefined}
        />
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Class</DataTableHeaderCell>
                <DataTableHeaderCell>Level</DataTableHeaderCell>
                <DataTableHeaderCell>Teacher</DataTableHeaderCell>
                <DataTableHeaderCell>Year / term</DataTableHeaderCell>
                <DataTableHeaderCell>Students</DataTableHeaderCell>
                <DataTableHeaderCell>Subjects</DataTableHeaderCell>
                <DataTableHeaderCell>Status</DataTableHeaderCell>
                <DataTableHeaderCell className="text-right">Actions</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {filtered.map((cls) => {
                const teacher = staff.find((s) => s.id === cls.classTeacherId)
                const count = students.filter(
                  (s) => s.classId === cls.id && s.status === 'ACTIVE',
                ).length
                const year = years.find((y) => y.id === cls.academicYearId)
                const term = terms.find((t) => t.id === cls.termId)
                return (
                  <DataTableRow key={cls.id}>
                    <DataTableCell>
                      <Link
                        to={`/classes/${cls.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {cls.name}
                      </Link>
                    </DataTableCell>
                    <DataTableCell>
                      {educationLevelName(cls.educationLevelId) || cls.level}
                    </DataTableCell>
                    <DataTableCell>
                      <div className="space-y-0.5">
                        <p>
                          {teacher
                            ? `${teacher.firstName} ${teacher.lastName}`
                            : cls.classTeacherId
                              ? 'Assigned'
                              : '—'}
                        </p>
                        {!canManage && user?.staffId && cls.classTeacherId === user.staffId ? (
                          <Badge className="text-[10px]">Class teacher</Badge>
                        ) : null}
                      </div>
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {year?.name ?? '—'}
                      {cls.termSequence
                        ? ` · Term ${cls.termSequence}`
                        : term
                          ? ` · ${term.name}`
                          : ''}
                    </DataTableCell>
                    <DataTableCell>{count}</DataTableCell>
                    <DataTableCell>{(cls.subjectIds ?? []).length}</DataTableCell>
                    <DataTableCell>
                      <StatusBadge status={cls.status ?? 'ACTIVE'} />
                    </DataTableCell>
                    <DataTableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/classes/${cls.id}`}>Open</Link>
                        </Button>
                        {canManage ? (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(cls)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => void deleteClass(cls)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </DataTableCell>
                  </DataTableRow>
                )
              })}
            </DataTableBody>
          </DataTable>
        </DataTableShell>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[min(90dvh,720px)] w-[calc(100%-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100%-2rem)]">
          <DialogHeader className="shrink-0 border-b border-border px-6 py-4">
            <DialogTitle>{editing ? 'Edit class' : 'Create class'}</DialogTitle>
            <DialogDescription>
              Class names are free-form — e.g. ECD A, Grade 4 Blue, Form 6 Upper Six.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="grid gap-5 lg:grid-cols-2 lg:gap-6">
              <div className="grid gap-3 content-start">
                <Field>
                  <Label htmlFor="class-name">Class name</Label>
                  <Input
                    id="class-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Form 1A"
                  />
                </Field>
                <Field>
                  <Label htmlFor="class-level">Education level</Label>
                  <Select
                    id="class-level"
                    value={form.educationLevelId}
                    onChange={(e) => {
                      const educationLevelId = e.target.value
                      setForm((f) => ({
                        ...f,
                        educationLevelId,
                        subjectIds: f.subjectIds.filter((id) => {
                          const sub = subjects.find((s) => s.id === id)
                          if (!sub?.educationLevelIds?.length) return true
                          return sub.educationLevelIds.includes(educationLevelId)
                        }),
                      }))
                    }}
                  >
                    {EDUCATION_LEVELS.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} ({l.band})
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <Label htmlFor="class-year">Academic year</Label>
                    <Input
                      id="class-year"
                      value={
                        (years.find((y) => y.id === (form.academicYearId || currentYear?.id))
                          ?.name ??
                          currentYear?.name ??
                          'Current year') + ' (automatic)'
                      }
                      disabled
                    />
                    <p className="text-xs text-muted-foreground">
                      Set automatically to the school’s current academic year.
                    </p>
                  </Field>
                  <Field>
                    <Label htmlFor="class-term">Term</Label>
                    <Select
                      id="class-term"
                      value={String(form.termSequence)}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          termSequence: Number(e.target.value) as 1 | 2 | 3,
                        }))
                      }
                    >
                      <option value="1">Term 1</option>
                      <option value="2">Term 2</option>
                      <option value="3">Term 3</option>
                    </Select>
                  </Field>
                </div>
                <Field>
                  <Label htmlFor="class-teacher">Class teacher</Label>
                  <Select
                    id="class-teacher"
                    value={form.classTeacherId}
                    onChange={(e) => setForm((f) => ({ ...f, classTeacherId: e.target.value }))}
                  >
                    <option value="">Select teacher</option>
                    {staff
                      .filter((s) => s.status === 'ACTIVE')
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.firstName} {s.lastName}
                        </option>
                      ))}
                  </Select>
                  {staff.filter((s) => s.status === 'ACTIVE').length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No active staff yet. Register teachers under Teachers & Staff first.
                    </p>
                  ) : null}
                </Field>
                <Field>
                  <Label htmlFor="class-notes">Description / notes</Label>
                  <Textarea
                    id="class-notes"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    rows={3}
                    placeholder="Optional notes about this class"
                  />
                </Field>
              </div>

              <div className="flex min-h-0 flex-col gap-2">
                <Label>Subjects undertaken by this class</Label>
                <div className="grid max-h-[min(50vh,360px)] flex-1 gap-2 overflow-y-auto rounded-xl border border-border p-3 sm:grid-cols-2 lg:max-h-none lg:min-h-[280px]">
                  {levelSubjects.length === 0 ? (
                    <p className="text-sm text-muted-foreground sm:col-span-2">
                      No subjects for this level. Add subjects under Subjects management.
                    </p>
                  ) : (
                    levelSubjects.map((subject) => {
                      const checked = form.subjectIds.includes(subject.id)
                      return (
                        <label
                          key={subject.id}
                          className={cn(
                            'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-sm',
                            checked ? 'border-accent/40 bg-accent/5' : 'border-transparent',
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleSubject(subject.id)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="font-medium">{subject.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {subject.code}
                            </span>
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {form.subjectIds.length} selected · filtered for{' '}
                  {educationLevelName(form.educationLevelId)}
                </p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-card px-6 py-3">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void saveClass()}>
              {editing ? 'Save changes' : 'Create class'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
