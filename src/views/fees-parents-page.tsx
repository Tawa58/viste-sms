import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Download, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { SearchInput } from '@/components/shared/search-input'
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
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/contexts/auth-context'
import { catalogService, classService, studentService } from '@/services/api'
import { notify } from '@/lib/notify'
import { canManageStudents } from '@/lib/roles'
import { downloadParentsPdf, type ParentPdfVariant } from '@/lib/parents-pdf'
import { educationLevelName } from '@/lib/education-levels'
import { balanceForBillingPeriod, currentBillingTerm, currentMonthPeriod } from '@/lib/fees'
import { formatCurrency, fullName } from '@/lib/utils'
import type { Invoice, SchoolClass, Student, Guardian, Term } from '@/types'

export function ParentsPage() {
  const [loading, setLoading] = useState(true)
  const [guardians, setGuardians] = useState<Guardian[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    let mounted = true
    Promise.all([
      catalogService.getGuardians(),
      studentService.list(),
      classService.list().catch(() => [] as SchoolClass[]),
    ])
      .then(([g, s, c]) => {
        if (!mounted) return
        setGuardians(g)
        setStudents(s)
        setClasses(c)
      })
      .catch((err) => {
        console.error(err)
        notify.error(
          'Could not load parents',
          'Check that you are signed in and try again.',
        )
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  const levelByStudentId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of students) {
      const cls = classes.find((c) => c.id === s.classId)
      map[s.id] =
        educationLevelName(s.educationLevelId || cls?.educationLevelId) ||
        cls?.name ||
        '—'
    }
    return map
  }, [students, classes])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return guardians
      .filter((g) => {
        if (!q) return true
        const hay = `${g.firstName} ${g.lastName} ${g.phone} ${g.email} ${g.relationship}`.toLowerCase()
        return hay.includes(q)
      })
      .sort((a, b) =>
        `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
      )
  }, [guardians, search])

  function pdfRows() {
    return rows.map((g) => ({
      guardian: g,
      children: students.filter((s) => g.studentIds.includes(s.id)),
      levelByStudentId,
    }))
  }

  function handleDownload(variant: ParentPdfVariant) {
    try {
      downloadParentsPdf({ variant, rows: pdfRows() })
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not open PDF')
    }
  }

  if (loading) return <LoadingState message="Loading parents…" />

  return (
    <div>
      <PageHeader
        title="Parents / Guardians"
        description="Contact directory for parents and guardians linked to students."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Parents/Guardians' }]}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="h-4 w-4" />
                Download PDF
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel>Export options</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleDownload('contacts')}>
                Contacts only (no address)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload('names_address')}>
                Names and addresses
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload('names_contacts')}>
                Names and contacts
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload('names_contacts_children')}>
                Names, contacts, children and levels
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="mb-4 max-w-md">
        <SearchInput
          id="parents-search"
          name="parents-search"
          value={search}
          onChange={setSearch}
          placeholder="Search by name, phone, or email…"
        />
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          No parents found. Add a guardian when registering a student.
        </p>
      ) : (
        <DataTableShell>
          <DataTable>
            <DataTableHead>
              <tr>
                <DataTableHeaderCell>Name</DataTableHeaderCell>
                <DataTableHeaderCell>Relationship</DataTableHeaderCell>
                <DataTableHeaderCell>Phone</DataTableHeaderCell>
                <DataTableHeaderCell>Email</DataTableHeaderCell>
                <DataTableHeaderCell>Children</DataTableHeaderCell>
              </tr>
            </DataTableHead>
            <DataTableBody>
              {rows.map((g) => {
                const children = students.filter((s) => g.studentIds.includes(s.id))
                return (
                  <DataTableRow key={g.id}>
                    <DataTableCell>
                      <Link
                        to={`/parents/${g.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {g.firstName} {g.lastName}
                      </Link>
                    </DataTableCell>
                    <DataTableCell className="text-muted-foreground">
                      {g.relationship || '—'}
                    </DataTableCell>
                    <DataTableCell className="text-sm">{g.phone || '—'}</DataTableCell>
                    <DataTableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                      {g.email || '—'}
                    </DataTableCell>
                    <DataTableCell className="text-xs text-muted-foreground">
                      {children.length
                        ? children
                            .map((s) => `${fullName(s)} · ${levelByStudentId[s.id] || '—'}`)
                            .join(', ')
                        : '—'}
                    </DataTableCell>
                  </DataTableRow>
                )
              })}
            </DataTableBody>
          </DataTable>
        </DataTableShell>
      )}
    </div>
  )
}

export function ParentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const canManage = user ? canManageStudents(user.role) : false
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [guardian, setGuardian] = useState<Guardian | undefined>()
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])

  useEffect(() => {
    if (!id) return
    Promise.all([
      catalogService.getGuardian(id),
      studentService.list(),
      catalogService.getTermsAndClasses(),
      catalogService.getInvoices(),
    ]).then(([g, s, schoolCatalog, inv]) => {
      const { classes: c, terms: termRows } = schoolCatalog
      setGuardian(g)
      setStudents(s.filter((x) => g?.studentIds.includes(x.id)))
      setClasses(c)
      setTerms(termRows)
      setInvoices(inv.filter((i) => g?.studentIds.includes(i.studentId)))
      setLoading(false)
    })
  }, [id])

  async function handleDelete() {
    if (!guardian) return
    const ok = window.confirm(
      `Delete ${guardian.firstName} ${guardian.lastName}? They will be unlinked from all students.`,
    )
    if (!ok) return
    setDeleting(true)
    try {
      await notify.process(() => catalogService.deleteGuardian(guardian.id), {
        loading: 'Deleting guardian…',
        success: 'Guardian deleted',
        error: 'Could not delete guardian',
      })
      navigate('/parents')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <LoadingState message="Loading guardian profile…" />
  if (!guardian) return <p>Guardian not found.</p>

  const billingTerm = currentBillingTerm(terms)
  const outstanding = balanceForBillingPeriod(
    invoices,
    billingTerm?.id,
    currentMonthPeriod(),
  )

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${guardian.firstName} ${guardian.lastName}`}
        description={`${guardian.relationship || 'Guardian'} · ${guardian.phone || guardian.email || 'No contact on file'}`}
        breadcrumbs={[
          { label: 'Home', to: '/dashboard' },
          { label: 'Parents', to: '/parents' },
          { label: guardian.lastName },
        ]}
        actions={
          canManage ? (
            <Button variant="destructive" loading={deleting} onClick={() => void handleDelete()}>
              <Trash2 className="h-4 w-4" />
              Delete guardian
            </Button>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Contact
          </h3>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{guardian.phone || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Email</dt>
              <dd>{guardian.email || '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Address</dt>
              <dd>{guardian.address || '—'}</dd>
            </div>
            {guardian.occupation ? (
              <div>
                <dt className="text-muted-foreground">Occupation</dt>
                <dd>{guardian.occupation}</dd>
              </div>
            ) : null}
            <p className="pt-1 text-xs text-muted-foreground">
              Current-term balance across linked students
              {billingTerm ? ` · ${billingTerm.name}` : ''}:{' '}
              <span className="font-medium text-foreground">{formatCurrency(outstanding)}</span>
            </p>
          </dl>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Children
          </h3>
          {students.length === 0 ? (
            <p className="text-sm text-muted-foreground">No students linked to this parent.</p>
          ) : (
            <ul className="divide-y divide-border/70">
              {students.map((s) => {
                const cls = classes.find((c) => c.id === s.classId)
                const level =
                  educationLevelName(s.educationLevelId || cls?.educationLevelId) ||
                  cls?.name ||
                  '—'
                return (
                  <li key={s.id} className="flex items-baseline justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        to={`/students/${s.id}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {fullName(s)}
                      </Link>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                        {level}
                        {cls?.name ? ` · ${cls.name}` : ''}
                        {s.studentNumber || s.admissionNumber
                          ? ` · ${s.studentNumber || s.admissionNumber}`
                          : ''}
                      </p>
                    </div>
                    <StatusBadge status={s.status} />
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
