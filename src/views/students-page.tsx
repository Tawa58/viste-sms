import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  KeyRound,
  MoreHorizontal,
  Plus,
  Printer,
  Users,
} from 'lucide-react'
import { printPortalSlips } from '@/components/shared/student-portal-access-card'
import { currentPortalMonth, formatPortalMonth } from '@/lib/student-portal'
import { notify } from '@/lib/notify'
import { canManageStudents } from '@/lib/roles'
import { useAuth } from '@/contexts/auth-context'
import { USE_SERVER_API } from '@/services/api'
import { USE_MOCK_API } from '@/services/api/client'
import { PageHeader } from '@/components/shared/page-header'
import { SearchInput } from '@/components/shared/search-input'
import { Pagination } from '@/components/shared/pagination'
import { TableSkeleton } from '@/components/shared/loading-state'
import { EmptyState } from '@/components/shared/empty-state'
import { StatusBadge } from '@/components/shared/status-badge'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
  DataTableShell,
} from '@/components/shared/data-table'
import {
  StudentEditorForm,
  studentToFormValues,
  type StudentFormValues,
} from '@/components/shared/student-editor-form'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Select } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { catalogService, classService, studentService } from '@/services/api'
import { cn, fullName } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { EDUCATION_LEVELS, educationLevelName } from '@/lib/education-levels'
import { previewNextVhsNumber } from '@/lib/student-numbers'
import type {
  ClubActivity,
  Guardian,
  House,
  SchoolClass,
  Sport,
  Stream,
  Student,
  StudentPortalBatchRow,
  Subject,
} from '@/types'

const PAGE_SIZE = 8

export function StudentsPage() {
  const { user } = useAuth()
  const canManage = user ? canManageStudents(user.role) : false
  const isTeacher = user?.role === 'TEACHER'
  const [loading, setLoading] = useState(true)
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [streams, setStreams] = useState<Stream[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [sports, setSports] = useState<Sport[]>([])
  const [clubs, setClubs] = useState<ClubActivity[]>([])
  const [houses, setHouses] = useState<House[]>([])
  const [guardians, setGuardians] = useState<Guardian[]>([])
  const [search, setSearch] = useState('')
  // Teachers must pick a class first — no school-wide "all" directory.
  const [classFilter, setClassFilter] = useState(isTeacher ? '' : 'all')
  const [levelFilter, setLevelFilter] = useState('all')
  const [genderFilter, setGenderFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [subjectFilter, setSubjectFilter] = useState('all')
  const [sportFilter, setSportFilter] = useState('all')
  const [sort, setSort] = useState<'name' | 'number'>('name')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Student | null>(null)
  const [form, setForm] = useState<StudentFormValues>(studentToFormValues())
  const [saving, setSaving] = useState(false)
  const [portalOpen, setPortalOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    // Teachers only need their assigned classes; directory catalogs are admin tools.
    Promise.all([
      isTeacher ? classService.list() : catalogService.getClasses(),
      isTeacher ? Promise.resolve([] as Stream[]) : catalogService.getStreams(),
      isTeacher ? Promise.resolve([] as Subject[]) : catalogService.getSubjects(),
      isTeacher
        ? Promise.resolve([] as Sport[])
        : (catalogService.getSports?.() ?? Promise.resolve([] as Sport[])),
      isTeacher
        ? Promise.resolve([] as ClubActivity[])
        : (catalogService.getClubs?.() ?? Promise.resolve([] as ClubActivity[])),
      isTeacher
        ? Promise.resolve([] as House[])
        : (catalogService.getHouses?.() ?? Promise.resolve([] as House[])),
      isTeacher
        ? Promise.resolve([] as Guardian[])
        : catalogService.getGuardians().catch(() => [] as Guardian[]),
      isTeacher ? Promise.resolve(null) : classService.getStats().catch(() => null),
    ])
      .then(([c, st, sub, sp, cl, ho, g]) => {
        if (!mounted) return
        setClasses(c)
        setStreams(st)
        setSubjects(sub)
        setSports(sp)
        setClubs(cl)
        setHouses(ho)
        setGuardians(g)
        if (isTeacher) {
          const active = c.filter((x) => (x.status ?? 'ACTIVE') === 'ACTIVE')
          setClassFilter((prev) => {
            if (prev && active.some((x) => x.id === prev)) return prev
            return ''
          })
        }
      })
      .catch((err) => {
        console.error(err)
        notify.error(
          'Could not load students',
          USE_SERVER_API || USE_MOCK_API
            ? err instanceof Error
              ? err.message
              : 'Check your sign-in and server logs, then try again.'
            : 'Client Firestore mode is enabled, but the security rules intentionally block direct data access. Set NEXT_PUBLIC_USE_CLIENT_FIRESTORE=false to use the server API. Do not open the Firestore rules.',
        )
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [isTeacher])

  useEffect(() => {
    if (loading) return
    let mounted = true

    // Teachers: wait for a class selection before loading any roster.
    if (isTeacher && !classFilter) {
      setStudents([])
      setStudentsLoading(false)
      return () => {
        mounted = false
      }
    }

    setStudentsLoading(true)
    const opts =
      isTeacher || (classFilter && classFilter !== 'all')
        ? { classId: classFilter }
        : undefined

    studentService
      .list(opts)
      .then((s) => {
        if (!mounted) return
        setStudents(s)
        setSelected([])
      })
      .catch((err) => {
        console.error(err)
        if (mounted) {
          setStudents([])
          notify.error('Could not load students for this class')
        }
      })
      .finally(() => {
        if (mounted) setStudentsLoading(false)
      })

    return () => {
      mounted = false
    }
  }, [loading, isTeacher, classFilter])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let rows = students.filter((s) => {
      const name = fullName(s).toLowerCase()
      const matchesSearch =
        !q ||
        name.includes(q) ||
        s.studentNumber.toLowerCase().includes(q) ||
        s.admissionNumber.toLowerCase().includes(q)
      const matchesClass = classFilter === 'all' || s.classId === classFilter
      const cls = classes.find((c) => c.id === s.classId)
      const levelId = s.educationLevelId || cls?.educationLevelId
      const matchesLevel = levelFilter === 'all' || levelId === levelFilter
      const matchesGender = genderFilter === 'all' || s.gender === genderFilter
      const matchesStatus = statusFilter === 'all' || s.status === statusFilter
      const matchesSubject =
        subjectFilter === 'all' || (s.subjectIds ?? []).includes(subjectFilter)
      const matchesSport =
        sportFilter === 'all' || (s.sportIds ?? []).includes(sportFilter)
      return (
        matchesSearch &&
        matchesClass &&
        matchesLevel &&
        matchesGender &&
        matchesStatus &&
        matchesSubject &&
        matchesSport
      )
    })
    rows = [...rows].sort((a, b) =>
      sort === 'name'
        ? fullName(a).localeCompare(fullName(b))
        : a.studentNumber.localeCompare(b.studentNumber),
    )
    return rows
  }, [
    students,
    classes,
    search,
    classFilter,
    levelFilter,
    genderFilter,
    statusFilter,
    subjectFilter,
    sportFilter,
    sort,
  ])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allPageSelected =
    pageRows.length > 0 && pageRows.every((r) => selected.includes(r.id))

  useEffect(() => {
    setPage(1)
  }, [search, classFilter, levelFilter, genderFilter, statusFilter, subjectFilter, sportFilter, sort])

  function openCreate() {
    const defaultClass = classes.find((c) => (c.status ?? 'ACTIVE') === 'ACTIVE')
    const defaultStream = defaultClass
      ? streams.find((s) => s.classId === defaultClass.id)
      : undefined
    setEditing(null)
    setForm({
      ...studentToFormValues(),
      classId: defaultClass?.id ?? '',
      streamId: defaultStream?.id ?? '',
      educationLevelId: defaultClass?.educationLevelId ?? '',
      academicYearId: defaultClass?.academicYearId ?? '',
      termId: defaultClass?.termId ?? '',
      studentNumber: '',
      admissionNumber: '',
      subjectIds: [],
    })
    setFormOpen(true)
  }

  function openEdit(student: Student) {
    setEditing(student)
    setForm(studentToFormValues(student))
    setFormOpen(true)
  }

  async function handleSave() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      notify.error('First and last name are required')
      return
    }
    if (!form.classId) {
      notify.error('Class is required')
      return
    }

    setSaving(true)
    try {
      const payload = {
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim() || undefined,
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth,
        gender: form.gender,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        address: form.address.trim() || '—',
        admissionDate: form.admissionDate,
        status: form.status,
        residency: form.residency,
        paymentPlan: form.paymentPlan,
        classId: form.classId,
        streamId: form.streamId || undefined,
        educationLevelId: form.educationLevelId || undefined,
        academicYearId: form.academicYearId || undefined,
        termId: form.termId || undefined,
        subjectIds: form.subjectIds,
        sportIds: form.sportIds,
        clubIds: form.clubIds,
        houseId: form.houseId || undefined,
        // Create never links existing parents — only optional newGuardians below.
        guardianIds: editing ? form.guardianIds : [],
        // Blank on create → server assigns VHS-{year}-{001} for both numbers
        studentNumber: editing ? form.studentNumber.trim() : '',
        admissionNumber: editing ? form.admissionNumber.trim() : '',
        newGuardians:
          !editing &&
          form.newGuardian &&
          form.newGuardian.firstName.trim() &&
          form.newGuardian.lastName.trim() &&
          form.newGuardian.phone.trim()
            ? [
                {
                  firstName: form.newGuardian.firstName.trim(),
                  lastName: form.newGuardian.lastName.trim(),
                  relationship: form.newGuardian.relationship.trim() || 'Parent',
                  phone: form.newGuardian.phone.trim(),
                  email: form.newGuardian.email.trim() || undefined,
                  address: form.newGuardian.address.trim() || undefined,
                  occupation: form.newGuardian.occupation.trim() || undefined,
                  emergencyContact: form.newGuardian.emergencyContact,
                },
              ]
            : undefined,
      }

      if (editing) {
        const { newGuardians: _ng, ...updatePayload } = payload
        const updated = await notify.process(
          () => studentService.update(editing.id, updatePayload),
          {
            loading: 'Updating student…',
            success: 'Student profile updated',
          },
        )
        setStudents((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      } else {
        const created = await notify.process(
          () => studentService.create(payload as Parameters<typeof studentService.create>[0]),
          {
            loading: 'Registering student…',
            success: (s) =>
              `Student registered · student number ${s.studentNumber}. Issue a portal code from their profile once fees are paid.`,
          },
        )
        setStudents((prev) => [created, ...prev])
      }
      setFormOpen(false)
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <TableSkeleton rows={6} message="Loading students…" />

  if (isTeacher) {
    return (
      <TeacherStudentsView
        classes={classes}
        staffId={user?.staffId}
        classId={classFilter}
        onClassChange={(id) => {
          setSearch('')
          setClassFilter(id)
        }}
        students={students}
        loading={studentsLoading}
        search={search}
        onSearchChange={setSearch}
      />
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Students"
        description="Browse, register, and manage the school student directory."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Students' }]}
        actions={
          canManage ? (
            <>
              {studentService.issuePortalCodesForClass ? (
                <Button variant="outline" onClick={() => setPortalOpen(true)}>
                  <KeyRound /> Portal codes
                </Button>
              ) : null}
              <Button onClick={openCreate}>
                <Plus /> Register student
              </Button>
            </>
          ) : null
        }
      />

      {canManage ? (
        <PortalCodesDialog open={portalOpen} onOpenChange={setPortalOpen} classes={classes} />
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-b from-card to-card/80 shadow-card">
        <div className="space-y-4 border-b border-border/70 bg-muted/25 p-3 sm:p-5">
          <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
            <SearchInput
              value={search}
              onChange={setSearch}
              placeholder="Search name or admission number…"
              className="col-span-2"
            />
            <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option value="all">All classes</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)}>
              <option value="all">All levels</option>
              {EDUCATION_LEVELS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="TRANSFERRED">Transferred</option>
              <option value="WITHDRAWN">Withdrawn</option>
              <option value="GRADUATED">Graduated</option>
              <option value="ARCHIVED">Archived</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
            <Select value={genderFilter} onChange={(e) => setGenderFilter(e.target.value)}>
              <option value="all">All genders</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
            </Select>
            <Select value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
              <option value="all">All subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select value={sportFilter} onChange={(e) => setSportFilter(e.target.value)}>
              <option value="all">All sports</option>
              {sports.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {studentsLoading ? (
          <TableSkeleton rows={6} message="Loading students…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No students found"
            description="Try adjusting filters or register a new student."
            className="m-6"
          />
        ) : (
          <div>
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-3 sm:gap-3 sm:px-5">
              <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
                <Checkbox
                  checked={allPageSelected}
                  onCheckedChange={(checked) => {
                    if (checked === true) {
                      setSelected((prev) => [
                        ...new Set([...prev, ...pageRows.map((r) => r.id)]),
                      ])
                    } else {
                      const ids = new Set(pageRows.map((r) => r.id))
                      setSelected((prev) => prev.filter((id) => !ids.has(id)))
                    }
                  }}
                  aria-label="Select page"
                />
                Select page
              </label>
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <p className="whitespace-nowrap text-sm text-muted-foreground">
                  {filtered.length} students
                </p>
                <Select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as 'name' | 'number')}
                  className="h-8 w-auto"
                >
                  <option value="name">Sort by name</option>
                  <option value="number">Sort by number</option>
                </Select>
              </div>
            </div>

            <DataTableShell className="rounded-none border-0 shadow-none">
              <DataTable className="min-w-[720px]">
                <DataTableHead>
                  <tr>
                    <DataTableHeaderCell className="w-10" />
                    <DataTableHeaderCell>Student</DataTableHeaderCell>
                    <DataTableHeaderCell>Admission #</DataTableHeaderCell>
                    <DataTableHeaderCell>Class</DataTableHeaderCell>
                    <DataTableHeaderCell>Level</DataTableHeaderCell>
                    <DataTableHeaderCell>Subjects</DataTableHeaderCell>
                    <DataTableHeaderCell>Status</DataTableHeaderCell>
                    <DataTableHeaderCell className="text-right">Actions</DataTableHeaderCell>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {pageRows.map((s) => {
                    const cls = classes.find((c) => c.id === s.classId)
                    const classLabel = cls?.name ?? '—'
                    const levelLabel = educationLevelName(
                      s.educationLevelId || cls?.educationLevelId,
                    )
                    const subjectCount = s.subjectIds?.length ?? 0
                    return (
                      <DataTableRow key={s.id}>
                        <DataTableCell>
                          <Checkbox
                            checked={selected.includes(s.id)}
                            onCheckedChange={(checked) => {
                              setSelected((prev) =>
                                checked === true
                                  ? [...prev, s.id]
                                  : prev.filter((id) => id !== s.id),
                              )
                            }}
                            aria-label={`Select ${fullName(s)}`}
                          />
                        </DataTableCell>
                        <DataTableCell>
                          <Link
                            to={`/students/${s.id}`}
                            className="flex min-w-0 items-center gap-3 font-medium text-primary hover:underline"
                          >
                            <Avatar name={fullName(s)} className="h-9 w-9 text-xs" />
                            <span className="truncate">{fullName(s)}</span>
                          </Link>
                        </DataTableCell>
                        <DataTableCell className="whitespace-nowrap text-muted-foreground">
                          {s.admissionNumber}
                        </DataTableCell>
                        <DataTableCell>{classLabel}</DataTableCell>
                        <DataTableCell className="text-muted-foreground">
                          {levelLabel}
                        </DataTableCell>
                        <DataTableCell>{subjectCount}</DataTableCell>
                        <DataTableCell>
                          <StatusBadge status={s.status} />
                        </DataTableCell>
                        <DataTableCell>
                          <div className="flex justify-end gap-1">
                            <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5" asChild>
                              <Link to={`/students/${s.id}`}>
                                View
                                <ArrowUpRight className="h-3.5 w-3.5" />
                              </Link>
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link to={`/students/${s.id}`}>View profile</Link>
                                </DropdownMenuItem>
                                {canManage ? (
                                  <DropdownMenuItem onClick={() => openEdit(s)}>
                                    Edit registration
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem asChild>
                                    <Link to={`/students/${s.id}`}>Update contact info</Link>
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </DataTableCell>
                      </DataTableRow>
                    )
                  })}
                </DataTableBody>
              </DataTable>
            </DataTableShell>

            <div className="border-t border-border/70 px-4 py-3 sm:px-5">
              <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
            </div>
          </div>
        )}
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit student' : 'Register student'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update profile, enrolment, subjects, and linked guardians.'
                : 'Capture profile details, class placement, subjects, and guardians.'}
            </DialogDescription>
          </DialogHeader>
          <StudentEditorForm
            mode={editing ? 'edit' : 'create'}
            values={form}
            onChange={setForm}
            classes={classes}
            streams={streams}
            subjects={subjects}
            sports={sports}
            clubs={clubs}
            houses={houses}
            guardians={guardians}
            fullAccess
            numberPreview={
              editing ? undefined : previewNextVhsNumber(students, form.admissionDate)
            }
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void handleSave()}>
              {editing ? 'Save changes' : 'Register student'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function TeacherStudentsView({
  classes,
  staffId,
  classId,
  onClassChange,
  students,
  loading,
  search,
  onSearchChange,
}: {
  classes: SchoolClass[]
  staffId?: string
  classId: string
  onClassChange: (id: string) => void
  students: Student[]
  loading: boolean
  search: string
  onSearchChange: (value: string) => void
}) {
  const active = classes.filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE')
  const myClasses = active.filter((c) => staffId && c.classTeacherId === staffId)
  const taughtClasses = active.filter((c) => !staffId || c.classTeacherId !== staffId)
  const selectedClass = active.find((c) => c.id === classId)
  const isMyClass = Boolean(selectedClass && staffId && selectedClass.classTeacherId === staffId)

  const roster = useMemo(() => {
    const q = search.trim().toLowerCase()
    return students
      .filter((s) => s.status === 'ACTIVE')
      .filter(
        (s) =>
          !q ||
          fullName(s).toLowerCase().includes(q) ||
          s.studentNumber.toLowerCase().includes(q) ||
          s.admissionNumber.toLowerCase().includes(q),
      )
      .sort((a, b) => fullName(a).localeCompare(fullName(b)))
  }, [students, search])

  function classButton(c: SchoolClass, mine: boolean) {
    const selected = c.id === classId
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => onClassChange(c.id)}
        className={cn(
          'flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left text-sm transition-colors',
          selected
            ? 'border-primary bg-primary/10 text-foreground'
            : 'border-border/70 bg-card hover:border-primary/40',
        )}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{c.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {educationLevelName(c.educationLevelId) || c.level}
          </span>
        </span>
        {mine ? <Badge variant="secondary">My class</Badge> : null}
      </button>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Students"
        description="Pick one of your classes to view its students."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Students' }]}
      />

      {active.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No classes assigned"
          description="Ask an admin to assign you as a class teacher or add classes to your teacher profile."
        />
      ) : (
        <div className="space-y-4">
          {myClasses.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">My class (class teacher)</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {myClasses.map((c) => classButton(c, true))}
              </div>
            </section>
          ) : null}
          {taughtClasses.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">Classes I teach</h2>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {taughtClasses.map((c) => classButton(c, false))}
              </div>
            </section>
          ) : null}
        </div>
      )}

      {!selectedClass ? (
        active.length > 0 ? (
          <EmptyState
            icon={Users}
            title="Select a class"
            description="Choose a class above to see its student list."
          />
        ) : null
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
          <div className="flex flex-col gap-3 border-b border-border/70 bg-muted/25 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h2 className="font-display text-lg font-semibold">{selectedClass.name}</h2>
              <p className="text-sm text-muted-foreground">
                {loading ? 'Loading…' : `${roster.length} students`}
                {isMyClass ? ' · You are the class teacher' : ''}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchInput
                value={search}
                onChange={onSearchChange}
                placeholder="Search name or number…"
                className="sm:w-64"
              />
              {isMyClass ? (
                <Button asChild variant="outline">
                  <Link to={`/attendance?classId=${selectedClass.id}`}>Mark register</Link>
                </Button>
              ) : null}
            </div>
          </div>

          {loading ? (
            <TableSkeleton rows={6} message="Loading class roster…" />
          ) : roster.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No students found"
              description={
                search ? 'No students match your search.' : 'No active students in this class yet.'
              }
              className="m-6"
            />
          ) : (
            <DataTableShell className="rounded-none border-0 shadow-none">
              <DataTable>
                <DataTableHead>
                  <tr>
                    <DataTableHeaderCell className="w-12">#</DataTableHeaderCell>
                    <DataTableHeaderCell>Student</DataTableHeaderCell>
                    <DataTableHeaderCell>Student no.</DataTableHeaderCell>
                    <DataTableHeaderCell>Gender</DataTableHeaderCell>
                    <DataTableHeaderCell className="text-right">Profile</DataTableHeaderCell>
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {roster.map((s, index) => (
                    <DataTableRow key={s.id}>
                      <DataTableCell className="text-muted-foreground">{index + 1}</DataTableCell>
                      <DataTableCell>
                        <Link
                          to={`/students/${s.id}`}
                          className="flex min-w-0 items-center gap-3 font-medium text-primary hover:underline"
                        >
                          <Avatar name={fullName(s)} className="h-8 w-8 text-xs" />
                          <span className="truncate">{fullName(s)}</span>
                        </Link>
                      </DataTableCell>
                      <DataTableCell className="text-muted-foreground">
                        {s.studentNumber || s.admissionNumber}
                      </DataTableCell>
                      <DataTableCell className="text-muted-foreground">{s.gender}</DataTableCell>
                      <DataTableCell>
                        <div className="flex justify-end">
                          <Button variant="outline" size="sm" className="h-8 gap-1 px-2.5" asChild>
                            <Link to={`/students/${s.id}`}>
                              View
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      </DataTableCell>
                    </DataTableRow>
                  ))}
                </DataTableBody>
              </DataTable>
            </DataTableShell>
          )}
        </div>
      )}
    </div>
  )
}

function PortalCodesDialog({
  open,
  onOpenChange,
  classes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  classes: SchoolClass[]
}) {
  const active = classes.filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE')
  const [classId, setClassId] = useState('')
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<StudentPortalBatchRow[] | null>(null)
  const month = formatPortalMonth(currentPortalMonth())
  const selectedClass = active.find((c) => c.id === classId)
  const issued = rows?.filter((r) => r.code) ?? []
  const skipped = rows?.filter((r) => r.skipped) ?? []

  useEffect(() => {
    if (open && !classId && active[0]) setClassId(active[0].id)
  }, [open, classId, active])

  async function generate() {
    if (!classId || !studentService.issuePortalCodesForClass) return
    const ok = window.confirm(
      `Generate new ${month} portal codes for fee-cleared students in ${selectedClass?.name ?? 'this class'}? Previous codes will stop working.`,
    )
    if (!ok) return
    setRunning(true)
    setRows(null)
    try {
      const result = await notify.process(
        () => studentService.issuePortalCodesForClass!(classId),
        {
          loading: 'Generating portal codes…',
          success: (r) => `${r.filter((x) => x.code).length} codes issued`,
        },
      )
      setRows(result)
    } catch {
      /* toast already shown */
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setRows(null)
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Student portal codes</DialogTitle>
          <DialogDescription>
            Issue {month} sign-in codes for a class. Only students whose fees are cleared get a
            code; codes expire at the end of the month.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Select
            value={classId}
            onChange={(e) => {
              setClassId(e.target.value)
              setRows(null)
            }}
            className="sm:flex-1"
          >
            {active.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button loading={running} disabled={!classId} onClick={() => void generate()}>
            <KeyRound /> Generate codes
          </Button>
        </div>

        {rows ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {issued.length} issued · {skipped.length} skipped
              </p>
              {issued.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    printPortalSlips(
                      issued.map((r) => ({
                        name: r.name,
                        studentNumber: r.studentNumber,
                        code: r.code!,
                        expiresAt: r.expiresAt,
                      })),
                      `${selectedClass?.name ?? 'Class'} · ${month} portal codes`,
                    )
                  }
                >
                  <Printer className="h-3.5 w-3.5" /> Print slips
                </Button>
              ) : null}
            </div>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active students in this class.</p>
            ) : (
              <ul className="max-h-[50dvh] divide-y divide-border/70 overflow-y-auto rounded-xl border border-border/70">
                {rows.map((r) => (
                  <li
                    key={r.studentId}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block text-xs text-muted-foreground">{r.studentNumber}</span>
                    </span>
                    {r.code ? (
                      <span className="font-mono text-base font-semibold tracking-[0.14em]">
                        {r.code}
                      </span>
                    ) : (
                      <span className="text-right text-xs text-warning">{r.skipped}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
