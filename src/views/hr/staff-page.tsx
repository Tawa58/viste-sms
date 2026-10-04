import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Briefcase, Plus, Trash2, UserCheck, UserMinus, Users } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { EmptyState } from '@/components/shared/empty-state'
import { SearchInput } from '@/components/shared/search-input'
import { StatCard } from '@/components/shared/stat-card'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_TYPE_LABEL,
  HR_CATEGORIES,
  HR_CATEGORY_LABEL,
  HR_STATUSES,
  HR_STATUS_LABEL,
  formatMoney,
} from '@/lib/hr/constants'
import { downloadLedgerPdf } from '@/lib/hr/hr-pdf'
import { notify } from '@/lib/notify'
import { formatDate } from '@/lib/utils'
import { downloadXlsx } from '@/lib/xlsx'
import { hrService } from '@/services/hr'
import type {
  HrEmployee,
  HrEmployeeInput,
  HrLinkableAccount,
  HrStaffCategory,
  SalaryScaleVersion,
} from '@/types'
import {
  ExportButtons,
  StaffStatusBadge,
  TablePager,
  errorText,
  todayIso,
  useHrAccess,
  useLetterhead,
  usePaged,
} from '@/views/hr/shared'

const emptyForm = (): HrEmployeeInput => ({
  fullName: '',
  nationalId: '',
  gender: 'FEMALE',
  dateOfBirth: '',
  phone: '',
  email: '',
  address: '',
  emergencyContact: { name: '', relationship: '', phone: '' },
  position: '',
  department: '',
  category: 'TEACHER',
  dateEmployed: todayIso(),
  employmentType: 'PERMANENT',
  status: 'ACTIVE',
  salaryScaleId: '',
  bank: { bankName: '', accountNumber: '', branch: '' },
  linkedUid: '',
  notes: '',
})

function toForm(e: HrEmployee): HrEmployeeInput {
  return {
    fullName: e.fullName,
    nationalId: e.nationalId,
    gender: e.gender,
    dateOfBirth: e.dateOfBirth || '',
    phone: e.phone,
    email: e.email || '',
    address: e.address || '',
    emergencyContact: { ...e.emergencyContact },
    position: e.position,
    department: e.department || '',
    category: e.category,
    dateEmployed: e.dateEmployed,
    employmentType: e.employmentType,
    status: e.status,
    salaryScaleId: e.salaryScaleId || '',
    bank: { ...e.bank },
    linkedUid: e.linkedUid || '',
    notes: e.notes || '',
  }
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-3 sm:grid-cols-2">
      <legend className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  )
}

export function HrStaffPage() {
  const can = useHrAccess()
  const canManage = can('hr.manage')
  const school = useLetterhead()
  const [loading, setLoading] = useState(true)
  const [employees, setEmployees] = useState<HrEmployee[]>([])
  const [accounts, setAccounts] = useState<HrLinkableAccount[]>([])
  const [scales, setScales] = useState<SalaryScaleVersion[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<HrEmployee | null>(null)
  const [form, setForm] = useState<HrEmployeeInput>(emptyForm())
  const [saving, setSaving] = useState(false)

  async function reload() {
    const [bundle, scaleRows] = await Promise.all([
      hrService.listStaff(),
      hrService.listScales().catch(() => [] as SalaryScaleVersion[]),
    ])
    setEmployees(bundle.employees)
    setAccounts(bundle.accounts)
    setScales(scaleRows)
  }

  useEffect(() => {
    reload()
      .catch((err) => notify.error(errorText(err, 'Could not load staff records')))
      .finally(() => setLoading(false))
  }, [])

  const currentScales = useMemo(() => scales.filter((s) => s.current), [scales])
  const scaleById = useMemo(
    () => new Map(currentScales.map((s) => [s.scaleId, s])),
    [currentScales],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return employees
      .filter((e) => category === 'all' || e.category === category)
      .filter((e) => status === 'all' || e.status === status)
      .filter(
        (e) =>
          !q ||
          `${e.employeeNumber} ${e.fullName} ${e.nationalId} ${e.position} ${e.department} ${e.phone} ${e.email}`
            .toLowerCase()
            .includes(q),
      )
  }, [employees, search, category, status])
  const { page, setPage, pageCount, pageRows } = usePaged(filtered)
  useEffect(() => setPage(1), [search, category, status, setPage])

  const stats = useMemo(
    () => ({
      total: employees.length,
      active: employees.filter((e) => e.status === 'ACTIVE').length,
      onLeave: employees.filter((e) => e.status === 'ON_LEAVE').length,
      teachers: employees.filter((e) => e.category === 'TEACHER' && e.status !== 'RESIGNED').length,
      inactive: employees.filter((e) => e.status === 'SUSPENDED' || e.status === 'RESIGNED').length,
    }),
    [employees],
  )

  const scaleChoices = useMemo(
    () =>
      currentScales.filter(
        (s) =>
          (s.status === 'ACTIVE' && s.category === form.category) ||
          s.scaleId === form.salaryScaleId,
      ),
    [currentScales, form.category, form.salaryScaleId],
  )

  function openCreate() {
    setEditing(null)
    setForm(emptyForm())
    setOpen(true)
  }

  function openEdit(e: HrEmployee) {
    setEditing(e)
    setForm(toForm(e))
    setOpen(true)
  }

  const set = <K extends keyof HrEmployeeInput>(key: K, value: HrEmployeeInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function save() {
    if (form.fullName.trim().length < 2) return notify.error('Full name is required')
    if (form.nationalId.trim().length < 3) return notify.error('National ID is required')
    if (form.phone.trim().length < 5) return notify.error('Phone number is required')
    if (form.position.trim().length < 2) return notify.error('Position is required')
    if (!form.dateEmployed) return notify.error('Date employed is required')
    setSaving(true)
    try {
      if (editing) {
        await hrService.updateStaff(editing.id, form)
        notify.success('Employee record updated')
      } else {
        const created = await hrService.createStaff(form)
        notify.success('Employee added', `Employee number ${created.employeeNumber}`)
      }
      setOpen(false)
      await reload()
    } catch (err) {
      notify.error(errorText(err, 'Could not save the employee'))
    } finally {
      setSaving(false)
    }
  }

  async function remove(e: HrEmployee) {
    if (!window.confirm(`Delete ${e.fullName} (${e.employeeNumber})? This cannot be undone.`)) return
    try {
      await hrService.deleteStaff(e.id)
      notify.success('Employee removed')
      await reload()
    } catch (err) {
      notify.error(errorText(err, 'Could not delete the employee'))
    }
  }

  const exportRows = () =>
    filtered.map((e) => {
      const scale = e.salaryScaleId ? scaleById.get(e.salaryScaleId) : undefined
      return {
        e,
        scale: scale ? `${scale.scaleId} · ${scale.grade}` : '—',
        gross: scale?.grossSalary ?? 0,
      }
    })

  async function exportPdf() {
    try {
      await downloadLedgerPdf({
        school,
        title: 'Staff register',
        subtitle: `${filtered.length} employee${filtered.length === 1 ? '' : 's'}`,
        head: ['Emp no.', 'Name', 'Position', 'Department', 'Category', 'Type', 'Status', 'Phone', 'Gross'],
        rows: exportRows().map(({ e, gross }) => [
          e.employeeNumber,
          e.fullName,
          e.position,
          e.department || '—',
          HR_CATEGORY_LABEL[e.category],
          EMPLOYMENT_TYPE_LABEL[e.employmentType],
          HR_STATUS_LABEL[e.status],
          e.phone,
          gross ? formatMoney(gross) : '—',
        ]),
        rightAlign: [8],
        filename: 'staff-register.pdf',
      })
      notify.success('Staff register downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the PDF'))
    }
  }

  async function exportExcel() {
    try {
      await downloadXlsx(
        [
          {
            name: 'Staff',
            title: [school.name, 'Staff register'],
            columns: [
              { header: 'Employee no.', width: 14 },
              { header: 'Full name', width: 26 },
              { header: 'National ID', width: 18 },
              { header: 'Gender', width: 9 },
              { header: 'Date of birth', width: 13 },
              { header: 'Phone', width: 18 },
              { header: 'Email', width: 26 },
              { header: 'Address', width: 30 },
              { header: 'Emergency contact', width: 30 },
              { header: 'Position', width: 20 },
              { header: 'Department', width: 18 },
              { header: 'Category', width: 20 },
              { header: 'Date employed', width: 14 },
              { header: 'Employment type', width: 16 },
              { header: 'Status', width: 12 },
              { header: 'Salary scale', width: 16 },
              { header: 'Gross salary', width: 14, money: true },
              { header: 'Bank', width: 18 },
              { header: 'Account number', width: 18 },
              { header: 'Branch', width: 18 },
            ],
            rows: exportRows().map(({ e, scale, gross }) => [
              e.employeeNumber,
              e.fullName,
              e.nationalId,
              e.gender === 'MALE' ? 'Male' : 'Female',
              e.dateOfBirth,
              e.phone,
              e.email,
              e.address,
              [e.emergencyContact.name, e.emergencyContact.relationship, e.emergencyContact.phone]
                .filter(Boolean)
                .join(' · '),
              e.position,
              e.department,
              HR_CATEGORY_LABEL[e.category],
              e.dateEmployed,
              EMPLOYMENT_TYPE_LABEL[e.employmentType],
              HR_STATUS_LABEL[e.status],
              scale,
              gross || null,
              e.bank.bankName,
              e.bank.accountNumber,
              e.bank.branch,
            ]),
          },
        ],
        'staff-register.xlsx',
      )
      notify.success('Staff register downloaded')
    } catch (err) {
      notify.error(errorText(err, 'Could not create the spreadsheet'))
    }
  }

  if (loading) return <LoadingState message="Loading staff records…" />

  const readOnly = !canManage

  return (
    <div>
      <PageHeader
        title="Staff records"
        description="Teachers, ancillary, administrative staff and general workers — personal, employment and banking details."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'HR & Payroll' }, { label: 'Staff records' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <ExportButtons onPdf={exportPdf} onExcel={exportExcel} disabled={!filtered.length} />
            {canManage ? (
              <Button type="button" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                Add employee
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <StatCard label="Employees on record" value={String(stats.total)} icon={Users} compact />
        <StatCard label="Active" value={String(stats.active)} icon={UserCheck} tone="success" compact />
        <StatCard label="Teaching staff" value={String(stats.teachers)} icon={Briefcase} tone="accent" compact />
        <StatCard
          label="On leave"
          value={String(stats.onLeave)}
          hint={`${stats.inactive} suspended or resigned`}
          icon={UserMinus}
          tone="warning"
          compact
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <SearchInput
          id="hr-staff-search"
          name="hr-staff-search"
          value={search}
          onChange={setSearch}
          placeholder="Search name, employee no., ID, position…"
          className="min-w-[220px] flex-1"
        />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-48">
          <option value="all">All categories</option>
          {HR_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {HR_CATEGORY_LABEL[c]}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="all">All statuses</option>
          {HR_STATUSES.map((s) => (
            <option key={s} value={s}>
              {HR_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={employees.length ? 'No employees match' : 'No staff records yet'}
          description={
            employees.length
              ? 'Try a different search or filter.'
              : 'Add teachers, ancillary, administrative staff and general workers to start building payroll.'
          }
          actionLabel={!employees.length && canManage ? 'Add employee' : undefined}
          onAction={!employees.length && canManage ? openCreate : undefined}
        />
      ) : (
        <>
          <DataTableShell>
            <DataTable>
              <DataTableHead>
                <tr>
                  <DataTableHeaderCell>Employee</DataTableHeaderCell>
                  <DataTableHeaderCell>Position</DataTableHeaderCell>
                  <DataTableHeaderCell>Category</DataTableHeaderCell>
                  <DataTableHeaderCell>Employed</DataTableHeaderCell>
                  <DataTableHeaderCell>Salary scale</DataTableHeaderCell>
                  <DataTableHeaderCell>Status</DataTableHeaderCell>
                  <DataTableHeaderCell />
                </tr>
              </DataTableHead>
              <DataTableBody>
                {pageRows.map((e) => {
                  const scale = e.salaryScaleId ? scaleById.get(e.salaryScaleId) : undefined
                  return (
                    <DataTableRow key={e.id}>
                      <DataTableCell>
                        <button
                          type="button"
                          className="text-left font-medium hover:underline"
                          onClick={() => openEdit(e)}
                        >
                          {e.fullName}
                        </button>
                        <p className="text-xs text-muted-foreground">
                          {e.employeeNumber} · {e.phone}
                        </p>
                      </DataTableCell>
                      <DataTableCell className="text-sm">
                        <div>{e.position}</div>
                        <div className="text-xs text-muted-foreground">{e.department || '—'}</div>
                      </DataTableCell>
                      <DataTableCell className="text-sm">
                        <div>{HR_CATEGORY_LABEL[e.category]}</div>
                        <div className="text-xs text-muted-foreground">
                          {EMPLOYMENT_TYPE_LABEL[e.employmentType]}
                        </div>
                      </DataTableCell>
                      <DataTableCell className="whitespace-nowrap text-sm">
                        {e.dateEmployed ? formatDate(e.dateEmployed) : '—'}
                      </DataTableCell>
                      <DataTableCell className="text-sm">
                        {scale ? (
                          <>
                            <div className="tabular-nums">{formatMoney(scale.grossSalary)}</div>
                            <div className="text-xs text-muted-foreground">
                              {scale.scaleId} · Grade {scale.grade}
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Not assigned</span>
                        )}
                      </DataTableCell>
                      <DataTableCell>
                        <StaffStatusBadge status={e.status} />
                      </DataTableCell>
                      <DataTableCell>
                        <div className="flex gap-1">
                          <Button type="button" size="sm" variant="outline" onClick={() => openEdit(e)}>
                            {canManage ? 'Edit' : 'View'}
                          </Button>
                          {canManage ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={`Delete ${e.fullName}`}
                              onClick={() => void remove(e)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </DataTableCell>
                    </DataTableRow>
                  )
                })}
              </DataTableBody>
            </DataTable>
          </DataTableShell>
          <TablePager
            page={page}
            pageCount={pageCount}
            onPageChange={setPage}
            total={filtered.length}
            noun="employee"
          />
        </>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? `${editing.fullName} · ${editing.employeeNumber}`
                : 'Add employee'}
            </DialogTitle>
          </DialogHeader>
          {!editing ? (
            <p className="-mt-1 text-xs text-muted-foreground">
              The employee number is generated automatically when you save.
            </p>
          ) : null}
          <fieldset disabled={readOnly} className="grid gap-5">
            <FormSection title="Personal information">
              <Field className="sm:col-span-2">
                <Label>Full name</Label>
                <Input value={form.fullName} onChange={(e) => set('fullName', e.target.value)} />
              </Field>
              <Field>
                <Label>National ID</Label>
                <Input value={form.nationalId} onChange={(e) => set('nationalId', e.target.value)} />
              </Field>
              <Field>
                <Label>Gender</Label>
                <Select
                  value={form.gender}
                  onChange={(e) => set('gender', e.target.value as HrEmployeeInput['gender'])}
                >
                  <option value="FEMALE">Female</option>
                  <option value="MALE">Male</option>
                </Select>
              </Field>
              <Field>
                <Label>Date of birth</Label>
                <Input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => set('dateOfBirth', e.target.value)}
                />
              </Field>
              <Field>
                <Label>Phone number</Label>
                <Input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <Field>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
              <Field>
                <Label>Address</Label>
                <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
              </Field>
              <Field>
                <Label>Emergency contact name</Label>
                <Input
                  value={form.emergencyContact.name}
                  onChange={(e) =>
                    set('emergencyContact', { ...form.emergencyContact, name: e.target.value })
                  }
                />
              </Field>
              <Field>
                <Label>Relationship</Label>
                <Input
                  value={form.emergencyContact.relationship}
                  onChange={(e) =>
                    set('emergencyContact', { ...form.emergencyContact, relationship: e.target.value })
                  }
                />
              </Field>
              <Field className="sm:col-span-2">
                <Label>Emergency contact phone</Label>
                <Input
                  type="tel"
                  value={form.emergencyContact.phone}
                  onChange={(e) =>
                    set('emergencyContact', { ...form.emergencyContact, phone: e.target.value })
                  }
                />
              </Field>
            </FormSection>

            <FormSection title="Employment information">
              <Field>
                <Label>Position</Label>
                <Input value={form.position} onChange={(e) => set('position', e.target.value)} />
              </Field>
              <Field>
                <Label>Department</Label>
                <Input value={form.department} onChange={(e) => set('department', e.target.value)} />
              </Field>
              <Field>
                <Label>Staff category</Label>
                <Select
                  value={form.category}
                  onChange={(e) => set('category', e.target.value as HrStaffCategory)}
                >
                  {HR_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {HR_CATEGORY_LABEL[c]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <Label>Date employed</Label>
                <Input
                  type="date"
                  value={form.dateEmployed}
                  onChange={(e) => set('dateEmployed', e.target.value)}
                />
              </Field>
              <Field>
                <Label>Employment type</Label>
                <Select
                  value={form.employmentType}
                  onChange={(e) =>
                    set('employmentType', e.target.value as HrEmployeeInput['employmentType'])
                  }
                >
                  {EMPLOYMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {EMPLOYMENT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onChange={(e) => set('status', e.target.value as HrEmployeeInput['status'])}
                >
                  {HR_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {HR_STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field>
                <Label>Salary scale</Label>
                <Select
                  value={form.salaryScaleId || ''}
                  onChange={(e) => set('salaryScaleId', e.target.value)}
                >
                  <option value="">Not assigned</option>
                  {scaleChoices.map((s) => (
                    <option key={s.scaleId} value={s.scaleId}>
                      {s.scaleId} · {s.position} grade {s.grade} · {formatMoney(s.grossSalary)}
                      {s.status === 'INACTIVE' ? ' (inactive)' : ''}
                    </option>
                  ))}
                </Select>
                {canManage && scaleChoices.length === 0 ? (
                  <p className="text-xs text-warning">
                    No salary amounts are set for this category yet. Create a role-based scale
                    before generating payroll.
                  </p>
                ) : null}
                {canManage ? (
                  <Button asChild type="button" size="sm" variant="outline" className="mt-1">
                    <Link to="/hr/salary-scales">Set role salary amounts</Link>
                  </Button>
                ) : null}
              </Field>
              <Field>
                <Label>Console login (for check-in)</Label>
                <Select value={form.linkedUid || ''} onChange={(e) => set('linkedUid', e.target.value)}>
                  <option value="">Not linked</option>
                  {accounts.map((a) => (
                    <option key={a.uid} value={a.uid}>
                      {a.name} · {a.role.replaceAll('_', ' ').toLowerCase()}
                    </option>
                  ))}
                  {form.linkedUid && !accounts.some((a) => a.uid === form.linkedUid) ? (
                    <option value={form.linkedUid}>{editing?.linkedName || 'Linked account'}</option>
                  ) : null}
                </Select>
              </Field>
            </FormSection>

            <FormSection title="Banking information">
              <Field>
                <Label>Bank name</Label>
                <Input
                  value={form.bank.bankName}
                  onChange={(e) => set('bank', { ...form.bank, bankName: e.target.value })}
                />
              </Field>
              <Field>
                <Label>Account number</Label>
                <Input
                  value={form.bank.accountNumber}
                  onChange={(e) => set('bank', { ...form.bank, accountNumber: e.target.value })}
                />
              </Field>
              <Field className="sm:col-span-2">
                <Label>Branch</Label>
                <Input
                  value={form.bank.branch}
                  onChange={(e) => set('bank', { ...form.bank, branch: e.target.value })}
                />
              </Field>
            </FormSection>

            <Field>
              <Label>Notes</Label>
              <Textarea value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </fieldset>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {readOnly ? null : (
              <Button type="button" loading={saving} onClick={() => void save()}>
                Save
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
