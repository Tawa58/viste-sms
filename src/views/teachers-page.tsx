import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Download, KeyRound, Plus, Trash2, Ban, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { SearchInput } from '@/components/shared/search-input'
import { LoadingState } from '@/components/shared/loading-state'
import { LoginCredentialsCard } from '@/components/shared/login-credentials-card'
import { isAndroidApp, saveBlobInApp } from '@/lib/native-app'
import { notify } from '@/lib/notify'
import { canViewStaffCredentials } from '@/lib/roles'
import { useAuth } from '@/contexts/auth-context'
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
import { ResolvedAvatar } from '@/components/shared/resolved-avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { catalogService, classService } from '@/services/api'
import {
  defaultAccountRoleForCategory,
  STAFF_ACCOUNT_ROLES,
  STAFF_CATEGORIES,
  staffCategoryLabel,
} from '@/lib/staff-categories'
import { permissionLabel } from '@/lib/permission-labels'
import type { SchoolClass, Staff, StaffCategory, StaffLoginCredential, Subject } from '@/types'

const emptyForm = {
  firstName: '',
  lastName: '',
  department: '',
  title: '',
  category: 'TEACHER' as StaffCategory,
  accountRole: 'TEACHER' as import('@/types').StaffAccountRole,
  email: '',
  phone: '',
  password: '',
  subjectIds: [] as string[],
  classIds: [] as string[],
}

function classNamesForStaff(staff: Staff, classes: SchoolClass[]) {
  const fromIds = (staff.classIds ?? [])
    .map((id) => classes.find((c) => c.id === id)?.name)
    .filter(Boolean) as string[]
  const fromTeacher = classes
    .filter((c) => c.classTeacherId === staff.id && (c.status ?? 'ACTIVE') !== 'ARCHIVED')
    .map((c) => c.name)
  return [...new Set([...fromIds, ...fromTeacher])]
}

function downloadCredentialsCsv(
  staff: Staff[],
  credentials: StaffLoginCredential[],
  classes: SchoolClass[],
) {
  const header = ['Name', 'Email / login', 'Password', 'Role', 'Classes', 'Status']
  const lines = staff.map((s) => {
    const cred = credentials.find((c) => c.staffId === s.id)
    const assigned = classNamesForStaff(s, classes).join('; ')
    return [
      `${s.firstName} ${s.lastName}`,
      cred?.email || s.email,
      cred?.password || '',
      cred?.role || 'TEACHER',
      assigned,
      cred?.temporaryPassword ? 'Temp password' : cred ? 'Active' : 'No login',
    ]
      .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
      .join(',')
  })
  const blob = new Blob([[header.join(','), ...lines].join('\n')], {
    type: 'text/csv;charset=utf-8',
  })
  const fileName = `teacher-logins-${new Date().toISOString().slice(0, 10)}.csv`
  if (isAndroidApp()) {
    void saveBlobInApp(blob, fileName)
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function TeachersPage() {
  const { user, hasPermission } = useAuth()
  const showCredentials = user ? canViewStaffCredentials(user.role) : false
  const fileAccess = user
    ? {
        userId: user.id,
        role: user.role,
        staffId: user.staffId,
      }
    : null
  const canManageTeachers =
    showCredentials ||
    hasPermission('teachers.manage') ||
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'SCHOOL_ADMIN' ||
    user?.role === 'PRINCIPAL'
  const [loading, setLoading] = useState(true)
  const [staff, setStaff] = useState<Staff[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [credentials, setCredentials] = useState<StaffLoginCredential[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [credOpen, setCredOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [suspendTarget, setSuspendTarget] = useState<Staff | null>(null)
  const [accessTarget, setAccessTarget] = useState<Staff | null>(null)
  const [suspending, setSuspending] = useState(false)
  const [reactivatingId, setReactivatingId] = useState<string | null>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [suspendEndsAt, setSuspendEndsAt] = useState('')
  const [suspendIndefinite, setSuspendIndefinite] = useState(false)

  useEffect(() => {
    let mounted = true
    Promise.all([
      catalogService.getStaff(),
      catalogService.getSubjects(),
      classService.list().catch(() => [] as SchoolClass[]),
      showCredentials ? catalogService.getStaffCredentials() : Promise.resolve([]),
    ])
      .then(([s, sub, cls, creds]) => {
        if (!mounted) return
        setStaff(s)
        setSubjects(sub)
        setClasses(cls)
        setCredentials(creds)
      })
      .catch((err) => {
        console.error(err)
        notify.error('Could not load teachers', 'Check that you are signed in and try again.')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [showCredentials])

  const rows = useMemo(() => {
    const q = search.toLowerCase()
    return staff.filter(
      (s) =>
        !q ||
        `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q) ||
        s.employeeNumber.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q),
    )
  }, [staff, search])

  async function handleCreate() {
    if (!form.firstName.trim() || !form.lastName.trim()) {
      notify.error('First and last name are required', 'Complete the required fields to continue.')
      return
    }
    const email =
      form.email.trim() ||
      `${form.firstName.toLowerCase()}.${form.lastName.toLowerCase()}@viste.school`
    const password = form.password.trim()
    if (password && password.length < 8) {
      notify.error(
        'Password too short',
        'Use at least 8 characters, or leave blank to auto-generate.',
      )
      return
    }
    setSaving(true)
    try {
      const created = await notify.process(
        () =>
          catalogService.createStaff({
            employeeNumber: `EMP-${1000 + staff.length + 1}`,
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
            email,
            phone: form.phone.trim() || '—',
            department: form.department.trim() || 'General',
            title: form.title.trim() || 'Staff',
            category: form.category,
            accountRole: form.accountRole,
            status: 'ACTIVE',
            subjectIds: form.subjectIds,
            classIds: form.classIds,
            hireDate: new Date().toISOString().slice(0, 10),
            ...(password ? { password } : {}),
          }),
        {
          loading: 'Creating staff and auth account…',
          success: 'Staff added — open View all logins for their email and password',
          error: 'Could not add staff member',
        },
      )
      setStaff((prev) => [created, ...prev])
      if (showCredentials) {
        setCredentials(await catalogService.getStaffCredentials())
        setCredOpen(true)
      }
      setForm(emptyForm)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleSuspendFromList() {
    if (!suspendTarget) return
    const reason = suspendReason.trim()
    if (reason.length < 3) {
      notify.error('Enter a suspension reason (at least 3 characters)')
      return
    }
    if (!suspendIndefinite && !suspendEndsAt) {
      notify.error('Pick an end date, or mark the suspension as indefinite')
      return
    }
    setSuspending(true)
    try {
      const updated = await notify.process(
        () =>
          catalogService.suspendStaff(suspendTarget.id, {
            reason,
            endsAt: suspendIndefinite ? null : suspendEndsAt,
          }),
        {
          loading: 'Suspending teacher…',
          success: 'Teacher suspended — they cannot sign in',
          error: 'Could not suspend teacher',
        },
      )
      setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
      setSuspendTarget(null)
      setSuspendReason('')
      setSuspendEndsAt('')
      setSuspendIndefinite(false)
    } finally {
      setSuspending(false)
    }
  }

  async function handleReactivateFromList(member: Staff) {
    setReactivatingId(member.id)
    try {
      const updated = await notify.process(() => catalogService.reactivateStaff(member.id), {
        loading: 'Reactivating teacher…',
        success: 'Teacher reactivated',
        error: 'Could not reactivate teacher',
      })
      setStaff((prev) => prev.map((s) => (s.id === updated.id ? updated : s)))
    } finally {
      setReactivatingId(null)
    }
  }

  if (loading) return <LoadingState message="Loading staff directory…" />

  return (
    <div className="space-y-5">
      <PageHeader
        title="Teachers & Staff"
        description={
          showCredentials
            ? 'Staff directory, portal logins, and assigned classes.'
            : 'Staff directory, departments, and assigned classes.'
        }
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Teachers & Staff' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            {showCredentials ? (
              <Button variant="outline" onClick={() => setCredOpen(true)}>
                <KeyRound /> View all logins
              </Button>
            ) : null}
            <Button
              onClick={() => {
                setForm(emptyForm)
                setOpen(true)
              }}
            >
              <Plus /> Add staff
            </Button>
          </div>
        }
      />

      <div className="space-y-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Search staff…" />
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No staff match your search.</p>
        ) : (
          <DataTableShell>
            <DataTable>
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Name</DataTableHeaderCell>
                  <DataTableHeaderCell>Category</DataTableHeaderCell>
                  <DataTableHeaderCell>Account role</DataTableHeaderCell>
                  <DataTableHeaderCell>Title / dept</DataTableHeaderCell>
                  <DataTableHeaderCell>Classes</DataTableHeaderCell>
                  <DataTableHeaderCell>Subjects</DataTableHeaderCell>
                  {showCredentials ? (
                    <DataTableHeaderCell>Login</DataTableHeaderCell>
                  ) : null}
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell className="text-right">Actions</DataTableHeaderCell>
                </tr>
              </DataTableHead>
              <DataTableBody>
                {rows.map((s) => {
                  const fullName = `${s.firstName} ${s.lastName}`
                  const cred = credentials.find((c) => c.staffId === s.id)
                  const assigned = classNamesForStaff(s, classes)
                  return (
                    <DataTableRow key={s.id}>
                      <DataTableCell>
                        <Link
                          to={`/teachers/${s.id}`}
                          className="flex items-center gap-3 font-medium text-primary hover:underline"
                        >
                          <ResolvedAvatar
                            name={fullName}
                            src={s.photoUrl}
                            fileId={s.profilePhotoId}
                            access={fileAccess}
                            className="h-9 w-9 text-xs"
                          />
                          <span>
                            {fullName}
                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                              {s.employeeNumber}
                            </span>
                          </span>
                        </Link>
                      </DataTableCell>
                      <DataTableCell className="text-muted-foreground">
                        {staffCategoryLabel(s.category)}
                      </DataTableCell>
                      <DataTableCell className="text-muted-foreground">
                        {STAFF_ACCOUNT_ROLES.find(
                          (role) =>
                            role.value ===
                            (s.accountRole ?? defaultAccountRoleForCategory(s.category)),
                        )?.label ?? 'Teacher'}
                      </DataTableCell>
                      <DataTableCell className="text-muted-foreground">
                        {s.title} · {s.department}
                      </DataTableCell>
                      <DataTableCell>
                        {assigned.length ? assigned.join(', ') : '—'}
                      </DataTableCell>
                      <DataTableCell className="text-muted-foreground">
                        {s.subjectIds
                          .map((id) => subjects.find((x) => x.id === id)?.name)
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </DataTableCell>
                      {showCredentials ? (
                        <DataTableCell className="max-w-[180px] truncate text-xs">
                          {cred?.email ?? '—'}
                        </DataTableCell>
                      ) : null}
                      <DataTableCell>
                        <StatusBadge
                          status={
                            s.status === 'INACTIVE' || s.suspension ? 'SUSPENDED' : s.status
                          }
                        />
                      </DataTableCell>
                      <DataTableCell>
                        <div className="flex justify-end gap-1">
                          {canManageTeachers ? (
                            s.status === 'INACTIVE' || s.suspension ? (
                              <Button
                                variant="outline"
                                size="sm"
                                loading={reactivatingId === s.id}
                                onClick={() => void handleReactivateFromList(s)}
                              >
                                Activate
                              </Button>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSuspendTarget(s)
                                  setSuspendReason('')
                                  setSuspendEndsAt('')
                                  setSuspendIndefinite(false)
                                }}
                              >
                                Suspend
                              </Button>
                            )
                          ) : null}
                          {showCredentials ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setAccessTarget(s)}
                            >
                              Access
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" asChild>
                              <Link to={`/teachers/${s.id}`}>Open</Link>
                            </Button>
                          )}
                        </div>
                      </DataTableCell>
                    </DataTableRow>
                  )
                })}
              </DataTableBody>
            </DataTable>
          </DataTableShell>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add staff member</DialogTitle>
            <DialogDescription>
              Creates a staff profile and portal login with access based on the selected account role.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <Label>First name</Label>
                <Input
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              </Field>
              <Field>
                <Label>Last name</Label>
                <Input
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                />
              </Field>
              <Field>
                <Label>Staff category</Label>
                <Select
                  value={form.category}
                  onChange={(e) => {
                    const category = e.target.value as StaffCategory
                    setForm((f) => ({
                      ...f,
                      category,
                      accountRole: defaultAccountRoleForCategory(category),
                    }))
                  }}
                >
                  {STAFF_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <Label>Account role</Label>
                <Select
                  value={form.accountRole}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      accountRole: e.target.value as import('@/types').StaffAccountRole,
                    }))
                  }
                >
                  {STAFF_ACCOUNT_ROLES.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  Determines the account’s starting access. You can customize individual permissions after creating it.
                </p>
              </Field>
              <Field>
                <Label>Title</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </Field>
              <Field>
                <Label>Department</Label>
                <Input
                  value={form.department}
                  onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                />
              </Field>
              <Field>
                <Label>Email (login)</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="name@viste.school"
                />
              </Field>
              <Field>
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </Field>
              {showCredentials ? (
                <Field className="sm:col-span-2">
                  <Label>Portal password (optional)</Label>
                  <Input
                    type="text"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    placeholder="Leave blank to auto-generate"
                  />
                  <p className="text-xs text-muted-foreground">
                    Saved on the admin login sheet. Marked as a temporary password until they change
                    it under Settings → Security.
                  </p>
                </Field>
              ) : null}
            </div>
            <Field>
              <Label>Subjects they teach</Label>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {subjects.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No subjects in catalog yet.</p>
                ) : (
                  subjects.map((sub) => (
                    <label key={sub.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.subjectIds.includes(sub.id)}
                        onCheckedChange={(checked) =>
                          setForm((f) => ({
                            ...f,
                            subjectIds:
                              checked === true
                                ? [...f.subjectIds, sub.id]
                                : f.subjectIds.filter((id) => id !== sub.id),
                          }))
                        }
                      />
                      {sub.name}
                    </label>
                  ))
                )}
              </div>
            </Field>
            <div className="space-y-2">
              <Label>Classes they teach</Label>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                {classes.filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE').length === 0 ? (
                  <p className="text-xs text-muted-foreground">No classes yet.</p>
                ) : (
                  classes
                    .filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE')
                    .map((cls) => (
                      <label key={cls.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.classIds.includes(cls.id)}
                          onCheckedChange={(checked) =>
                            setForm((f) => ({
                              ...f,
                              classIds:
                                checked === true
                                  ? [...f.classIds, cls.id]
                                  : f.classIds.filter((id) => id !== cls.id),
                            }))
                          }
                        />
                        {cls.name}
                      </label>
                    ))
                )}
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void handleCreate()}>
              Save staff
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={credOpen} onOpenChange={setCredOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Staff login sheet</DialogTitle>
            <DialogDescription>
              Email / username and admin-issued passwords. Use Reset if a password is missing
              (older accounts created before passwords were stored).
            </DialogDescription>
          </DialogHeader>
          <div className="mb-2 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                downloadCredentialsCsv(staff, credentials, classes)
                notify.success('Login sheet downloaded')
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Download CSV
            </Button>
          </div>
          <div className="grid gap-3">
            {staff.map((s) => {
              const cred = credentials.find((c) => c.staffId === s.id)
              return (
                <LoginCredentialsCard
                  key={s.id}
                  staffName={`${s.firstName} ${s.lastName}`}
                  credential={cred}
                  onReset={async () => {
                    const next = await notify.process(
                      () => catalogService.resetStaffPassword(s.id),
                      {
                        loading: 'Issuing temporary password…',
                        success: 'Temporary password ready — copy it from the card',
                        error: 'Could not reset password',
                      },
                    )
                    setCredentials((prev) => {
                      const others = prev.filter((c) => c.staffId !== s.id)
                      return [...others, next]
                    })
                  }}
                />
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(accessTarget)}
        onOpenChange={(next) => {
          if (!next) setAccessTarget(null)
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Access
              {accessTarget
                ? ` · ${accessTarget.firstName} ${accessTarget.lastName}`
                : ''}
            </DialogTitle>
            <DialogDescription>
              Choose which modules and actions this staff member can use. Open their profile from their
              name in the list if you need photo, assignments, or account status.
            </DialogDescription>
          </DialogHeader>
          {accessTarget ? (
            <StaffAccessPanel
              key={accessTarget.id}
              staffId={accessTarget.id}
              staffName={`${accessTarget.firstName} ${accessTarget.lastName}`}
              plain
              onSaved={() => setAccessTarget(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(suspendTarget)}
        onOpenChange={(next) => {
          if (!next) setSuspendTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Suspend {suspendTarget ? `${suspendTarget.firstName} ${suspendTarget.lastName}` : 'teacher'}
            </DialogTitle>
            <DialogDescription>
              They will not be able to sign in or use the portal until the period ends or you
              reactivate them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field>
              <Label>Reason</Label>
              <Textarea
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="e.g. Disciplinary review, leave without notice…"
                rows={3}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={suspendIndefinite}
                onCheckedChange={(v) => {
                  const on = v === true
                  setSuspendIndefinite(on)
                  if (on) setSuspendEndsAt('')
                }}
              />
              Indefinite (until an admin reactivates)
            </label>
            {!suspendIndefinite ? (
              <Field>
                <Label>Suspension ends on</Label>
                <Input
                  type="date"
                  value={suspendEndsAt}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setSuspendEndsAt(e.target.value)}
                />
              </Field>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSuspendTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                loading={suspending}
                onClick={() => void handleSuspendFromList()}
              >
                Suspend teacher
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function TeacherDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()
  const showCredentials = user ? canViewStaffCredentials(user.role) : false
  const fileAccess = user
    ? {
        userId: user.id,
        role: user.role,
        staffId: user.staffId,
      }
    : {
        userId: 'anonymous',
        role: 'SCHOOL_ADMIN' as const,
      }
  const canConfigureAccess =
    showCredentials ||
    hasPermission('teachers.manage') ||
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'SCHOOL_ADMIN' ||
    user?.role === 'PRINCIPAL'
  const [loading, setLoading] = useState(true)
  const [member, setMember] = useState<Staff | undefined>()
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [credential, setCredential] = useState<StaffLoginCredential | null | undefined>()
  const [savingAssign, setSavingAssign] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [suspending, setSuspending] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [suspendReason, setSuspendReason] = useState('')
  const [suspendEndsAt, setSuspendEndsAt] = useState('')
  const [suspendIndefinite, setSuspendIndefinite] = useState(false)
  const [editSubjectIds, setEditSubjectIds] = useState<string[]>([])
  const [editClassIds, setEditClassIds] = useState<string[]>([])
  const [editCategory, setEditCategory] = useState<StaffCategory>('TEACHER')
  const [editAccountRole, setEditAccountRole] =
    useState<import('@/types').StaffAccountRole>('TEACHER')
  const [savingProfile, setSavingProfile] = useState(false)

  useEffect(() => {
    if (!id) return
    Promise.all([
      catalogService.getStaffMember(id),
      catalogService.getSubjects(),
      classService.list().catch(() => [] as SchoolClass[]),
      showCredentials ? catalogService.getStaffCredential(id) : Promise.resolve(undefined),
    ]).then(([s, sub, cls, cred]) => {
      setMember(s)
      setSubjects(sub)
      setClasses(cls)
      setCredential(cred ?? null)
      setEditSubjectIds(s?.subjectIds ?? [])
      setEditClassIds(s?.classIds ?? [])
      setEditCategory(s?.category ?? 'TEACHER')
      setEditAccountRole(
        s?.accountRole ?? defaultAccountRoleForCategory(s?.category),
      )
      setLoading(false)
    })
  }, [id, showCredentials])

  async function saveAssignments() {
    if (!member) return
    setSavingAssign(true)
    try {
      const updated = await notify.process(
        () =>
          catalogService.updateStaff(member.id, {
            subjectIds: editSubjectIds,
            classIds: editClassIds,
          }),
        {
          loading: 'Saving teaching assignments…',
          success: 'Assignments saved',
          error: 'Could not save assignments',
        },
      )
      setMember(updated)
    } finally {
      setSavingAssign(false)
    }
  }

  async function saveProfileCategory() {
    if (!member) return
    setSavingProfile(true)
    try {
      const updated = await notify.process(
        () =>
          catalogService.updateStaff(member.id, {
            category: editCategory,
            accountRole: editAccountRole,
          }),
        {
          loading: 'Saving staff category and account role…',
          success: 'Staff category and account role updated',
          error: 'Could not update staff account',
        },
      )
      setMember(updated)
    } finally {
      setSavingProfile(false)
    }
  }

  async function handleDelete() {
    if (!member) return
    const ok = window.confirm(
      `Delete ${member.firstName} ${member.lastName}? This removes their login and cannot be undone.`,
    )
    if (!ok) return
    setDeleting(true)
    try {
      await notify.process(() => catalogService.deleteStaff(member.id), {
        loading: 'Deleting teacher…',
        success: 'Teacher deleted',
        error: 'Could not delete teacher',
      })
      navigate('/teachers')
    } finally {
      setDeleting(false)
    }
  }

  async function handleSuspend() {
    if (!member) return
    const reason = suspendReason.trim()
    if (reason.length < 3) {
      notify.error('Enter a suspension reason (at least 3 characters)')
      return
    }
    if (!suspendIndefinite && !suspendEndsAt) {
      notify.error('Pick an end date, or mark the suspension as indefinite')
      return
    }
    setSuspending(true)
    try {
      const updated = await notify.process(
        () =>
          catalogService.suspendStaff(member.id, {
            reason,
            endsAt: suspendIndefinite ? null : suspendEndsAt,
          }),
        {
          loading: 'Suspending teacher…',
          success: 'Teacher suspended — they cannot sign in until reactivated',
          error: 'Could not suspend teacher',
        },
      )
      setMember(updated)
      setSuspendOpen(false)
      setSuspendReason('')
      setSuspendEndsAt('')
      setSuspendIndefinite(false)
    } finally {
      setSuspending(false)
    }
  }

  async function handleReactivate() {
    if (!member) return
    setReactivating(true)
    try {
      const updated = await notify.process(() => catalogService.reactivateStaff(member.id), {
        loading: 'Reactivating teacher…',
        success: 'Teacher reactivated — they can sign in again',
        error: 'Could not reactivate teacher',
      })
      setMember(updated)
    } finally {
      setReactivating(false)
    }
  }

  if (loading) return <LoadingState message="Loading staff profile…" />
  if (!member) return <p>Staff member not found.</p>

  const fullName = `${member.firstName} ${member.lastName}`
  const assignedClasses = classNamesForStaff(member, classes)
  const isSuspended = member.status === 'INACTIVE' || Boolean(member.suspension)

  return (
    <div className="space-y-5">
      <PageHeader
        title={fullName}
        description={`${staffCategoryLabel(member.category)} · ${member.title} · ${member.department}`}
        breadcrumbs={[
          { label: 'Home', to: '/dashboard' },
          { label: 'Teachers', to: '/teachers' },
          { label: member.lastName },
        ]}
        actions={
          canConfigureAccess ? (
            <div className="flex flex-wrap gap-2">
              {isSuspended ? (
                <Button
                  variant="outline"
                  loading={reactivating}
                  onClick={() => void handleReactivate()}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Activate
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setSuspendOpen(true)}>
                  <Ban className="h-4 w-4" />
                  Suspend
                </Button>
              )}
              <Button variant="destructive" loading={deleting} onClick={() => void handleDelete()}>
                <Trash2 className="h-4 w-4" />
                Delete teacher
              </Button>
            </div>
          ) : null
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {canConfigureAccess ? (
          <Card className="lg:col-span-2">
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">Account access</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {isSuspended
                    ? 'This teacher is suspended and cannot sign in.'
                    : 'Suspend to block login for a period, or leave active.'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {isSuspended ? (
                  <Button loading={reactivating} onClick={() => void handleReactivate()}>
                    <CheckCircle2 className="h-4 w-4" />
                    Activate teacher
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={() => setSuspendOpen(true)}>
                    <Ban className="h-4 w-4" />
                    Suspend teacher
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardContent className="space-y-5 p-5">
            <div className="flex items-center gap-4">
              <ResolvedAvatar
                name={fullName}
                src={member.photoUrl}
                fileId={member.profilePhotoId}
                access={fileAccess}
                className="h-20 w-20 text-lg ring-2 ring-background"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">Profile photo</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Staff members can change their own photo from Settings.
                </p>
              </div>
            </div>
            <div className="space-y-2 border-t border-border pt-4 text-sm">
              <p>Employee #: {member.employeeNumber}</p>
              <p>Email: {member.email}</p>
              <p>Phone: {member.phone}</p>
              <p>Hired: {member.hireDate}</p>
              {canConfigureAccess ? (
                <div className="space-y-2 pt-1">
                  <Label>Staff category</Label>
                  <Select
                    value={editCategory}
                    onChange={(e) => {
                      const category = e.target.value as StaffCategory
                      setEditCategory(category)
                      setEditAccountRole(defaultAccountRoleForCategory(category))
                    }}
                  >
                    {STAFF_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                  <Label>Account role</Label>
                  <Select
                    value={editAccountRole}
                    onChange={(e) =>
                      setEditAccountRole(e.target.value as import('@/types').StaffAccountRole)
                    }
                  >
                    {STAFF_ACCOUNT_ROLES.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={savingProfile}
                    disabled={
                      editCategory === (member.category ?? 'TEACHER') &&
                      editAccountRole ===
                        (member.accountRole ?? defaultAccountRoleForCategory(member.category))
                    }
                    onClick={() => void saveProfileCategory()}
                  >
                    Save category & account role
                  </Button>
                </div>
              ) : (
                <p>Category: {staffCategoryLabel(member.category)}</p>
              )}
              <StatusBadge status={isSuspended ? 'SUSPENDED' : member.status} />
              {member.suspension ? (
                <div className="mt-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Suspension</p>
                  <p className="mt-1">Reason: {member.suspension.reason}</p>
                  <p>
                    Period:{' '}
                    {member.suspension.startsAt}
                    {member.suspension.endsAt
                      ? ` → ${member.suspension.endsAt}`
                      : ' → indefinite (admin must reactivate)'}
                  </p>
                  {member.suspension.suspendedByName ? (
                    <p>By: {member.suspension.suspendedByName}</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {showCredentials ? (
            <LoginCredentialsCard
              staffName={fullName}
              credential={credential}
              onReset={async () => {
                const next = await notify.process(
                  () => catalogService.resetStaffPassword(member.id),
                  {
                    loading: 'Issuing temporary password…',
                    success: 'Temporary password ready — copy it from the card',
                    error: 'Could not reset password',
                  },
                )
                setCredential(next)
              }}
            />
          ) : null}

          <Card>
            <CardContent className="space-y-3 p-5 text-sm">
              <p className="font-medium">Teaching assignments</p>
              <p className="text-xs text-muted-foreground">
                Teaching assignments determine which classes and subjects are available for mark entry.
                Homeroom class teacher links from Classes are also listed below.
              </p>
              {canConfigureAccess ? (
                <>
                  <div className="space-y-1">
                    <Label>Subjects</Label>
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                      {subjects.map((sub) => (
                        <label key={sub.id} className="flex items-center gap-2">
                          <Checkbox
                            checked={editSubjectIds.includes(sub.id)}
                            onCheckedChange={(checked) =>
                              setEditSubjectIds((prev) =>
                                checked === true
                                  ? [...prev, sub.id]
                                  : prev.filter((x) => x !== sub.id),
                              )
                            }
                          />
                          {sub.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Classes</Label>
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                      {classes
                        .filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE')
                        .map((cls) => (
                          <label key={cls.id} className="flex items-center gap-2">
                            <Checkbox
                              checked={editClassIds.includes(cls.id)}
                              onCheckedChange={(checked) =>
                                setEditClassIds((prev) =>
                                  checked === true
                                    ? [...prev, cls.id]
                                    : prev.filter((x) => x !== cls.id),
                                )
                              }
                            />
                            {cls.name}
                          </label>
                        ))}
                    </div>
                  </div>
                  <Button size="sm" loading={savingAssign} onClick={() => void saveAssignments()}>
                    Save assignments
                  </Button>
                </>
              ) : (
                <>
                  <p className="font-medium">Subjects</p>
                  {member.subjectIds.length ? (
                    member.subjectIds.map((sid) => (
                      <p key={sid}>{subjects.find((s) => s.id === sid)?.name}</p>
                    ))
                  ) : (
                    <p className="text-muted-foreground">No subjects assigned yet.</p>
                  )}
                  <p className="mt-3 font-medium">Classes</p>
                  {assignedClasses.length ? (
                    assignedClasses.map((name) => <p key={name}>{name}</p>)
                  ) : (
                    <p className="text-muted-foreground">No classes assigned yet.</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {canConfigureAccess ? (
            <StaffAccessPanel staffId={member.id} staffName={fullName} />
          ) : null}
        </div>
      </div>

      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Suspend {fullName}</DialogTitle>
            <DialogDescription>
              They will not be able to sign in or use the portal until the period ends or you
              reactivate them. Admins manage access this way — not by viewing the teacher&apos;s
              password.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field>
              <Label>Reason</Label>
              <Textarea
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="e.g. Disciplinary review, leave without notice…"
                rows={3}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={suspendIndefinite}
                onCheckedChange={(v) => {
                  const on = v === true
                  setSuspendIndefinite(on)
                  if (on) setSuspendEndsAt('')
                }}
              />
              Indefinite (until an admin reactivates)
            </label>
            {!suspendIndefinite ? (
              <Field>
                <Label>Suspension ends on</Label>
                <Input
                  type="date"
                  value={suspendEndsAt}
                  min={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setSuspendEndsAt(e.target.value)}
                />
              </Field>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSuspendOpen(false)}>
                Cancel
              </Button>
              <Button variant="destructive" loading={suspending} onClick={() => void handleSuspend()}>
                Suspend teacher
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type StaffAccessPayload = {
  staffId: string
  role: import('@/types').StaffAccountRole
  roleDefaults: string[]
  assignable: string[]
  groups: { label: string; permissions: string[] }[]
  overrides: { grant?: string[]; deny?: string[] }
  effective: string[]
  selected: string[]
}

function StaffAccessPanel({
  staffId,
  staffName,
  plain = false,
  onSaved,
}: {
  staffId: string
  staffName: string
  plain?: boolean
  onSaved?: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [access, setAccess] = useState<StaffAccessPayload | null>(null)
  const [selected, setSelected] = useState<string[]>([])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    catalogService
      .getStaffAccess(staffId)
      .then((data) => {
        if (!mounted) return
        setAccess(data)
        setSelected(data.selected)
      })
      .catch((err) => {
        console.error(err)
        notify.error('Could not load staff access settings')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [staffId])

  async function save() {
    setSaving(true)
    try {
      const next = await notify.process(
        () => catalogService.updateStaffAccess(staffId, selected),
        {
          loading: 'Saving staff access…',
          success: `Access updated for ${staffName}`,
          error: 'Could not save access',
        },
      )
      setAccess(next)
      setSelected(next.selected)
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }

  function resetToDefaults() {
    if (!access) return
    setSelected([...access.roleDefaults].filter((p) => access.assignable.includes(p)))
  }

  const body = loading ? (
    <p className="text-sm text-muted-foreground">Loading access…</p>
  ) : !access ? null : (
    <div className="space-y-4">
      {!plain ? (
        <div>
          <p className="font-medium">What this staff member can see & do</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose the account role’s default access or customize modules and actions for {staffName}.
            Changes apply on their next request (within ~20 seconds).
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Role: <span className="font-medium">{access.role.replaceAll('_', ' ')}</span>.
          Customize this staff member’s modules and actions; changes apply within about 20 seconds.
        </p>
      )}
      {access.groups.map((group) => (
        <div key={group.label}>
          <p className="mb-2 text-sm font-semibold">{group.label}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {group.permissions.map((perm) => (
              <label key={perm} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selected.includes(perm)}
                  onCheckedChange={(checked) => {
                    setSelected((prev) =>
                      checked === true
                        ? [...new Set([...prev, perm])]
                        : prev.filter((p) => p !== perm),
                    )
                  }}
                />
                <span>{permissionLabel(perm)}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button loading={saving} onClick={() => void save()}>
          Save access
        </Button>
        <Button type="button" variant="outline" onClick={resetToDefaults}>
          Reset to {access.role.replaceAll('_', ' ')} defaults
        </Button>
      </div>
    </div>
  )

  if (plain) return body

  return (
    <Card>
      <CardContent className="space-y-4 p-5">{body}</CardContent>
    </Card>
  )
}
