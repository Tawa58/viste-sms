import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Download, FileSpreadsheet, FileText, Printer } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { SearchInput } from '@/components/shared/search-input'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { staffCategoryLabel } from '@/lib/staff-categories'
import { educationLevelName } from '@/lib/education-levels'
import { notify } from '@/lib/notify'
import {
  downloadReportCsv,
  downloadReportPdf,
  REPORT_KIND_DESCRIPTIONS,
  REPORT_KIND_LABELS,
  type ReportKind,
  type ReportTable,
} from '@/lib/reports-export'
import { catalogService, classService, studentService } from '@/services/api'
import { formatCurrency, formatDate, fullName } from '@/lib/utils'
import { invoiceBalance } from '@/lib/fees'
import type {
  AcademicYear,
  Assessment,
  AttendanceRecord,
  Invoice,
  Mark,
  Payment,
  SchoolClass,
  Staff,
  Student,
  Subject,
  Term,
} from '@/types'

function monthStart() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

const KINDS: ReportKind[] = [
  'students',
  'attendance',
  'fees',
  'academic',
  'results',
  'staff',
]

export function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'hub' | 'detail'>('hub')
  const [kind, setKind] = useState<ReportKind>('students')
  const [search, setSearch] = useState('')
  const [fromDate, setFromDate] = useState(monthStart())
  const [toDate, setToDate] = useState(today())
  const [classId, setClassId] = useState('all')
  const [statusFilter, setStatusFilter] = useState('ACTIVE')
  const [yearId, setYearId] = useState('all')
  const [termId, setTermId] = useState('all')

  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<SchoolClass[]>([])
  const [years, setYears] = useState<AcademicYear[]>([])
  const [terms, setTerms] = useState<Term[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [marks, setMarks] = useState<Mark[]>([])
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [schoolName, setSchoolName] = useState('Viste High School')

  useEffect(() => {
    let mounted = true
    Promise.all([
      studentService.list(),
      classService.list().catch(() => [] as SchoolClass[]),
      catalogService.getYears().catch(() => [] as AcademicYear[]),
      catalogService.getTerms().catch(() => [] as Term[]),
      catalogService.getSubjects().catch(() => [] as Subject[]),
      catalogService.getStaff().catch(() => [] as Staff[]),
      catalogService.getAttendance().catch(() => [] as AttendanceRecord[]),
      catalogService.getInvoices().catch(() => [] as Invoice[]),
      catalogService.getPayments().catch(() => [] as Payment[]),
      catalogService.getMarks().catch(() => [] as Mark[]),
      catalogService.getAssessments().catch(() => [] as Assessment[]),
      catalogService.getSchoolProfile().catch(() => null),
    ])
      .then(
        ([
          stu,
          cls,
          yrs,
          tms,
          subs,
          stf,
          att,
          inv,
          pay,
          mk,
          asmt,
          profile,
        ]) => {
          if (!mounted) return
          setStudents(stu)
          setClasses(cls)
          setYears(yrs)
          setTerms(tms)
          setSubjects(subs)
          setStaff(stf)
          setAttendance(att)
          setInvoices(inv)
          setPayments(pay)
          setMarks(mk)
          setAssessments(asmt)
          if (profile?.name) setSchoolName(profile.name)
          const currentYear = yrs.find((y) => y.isCurrent)
          if (currentYear) {
            setYearId(currentYear.id)
            const yearTerms = tms
              .filter((t) => t.academicYearId === currentYear.id)
              .sort((a, b) => a.sequence - b.sequence)
            const todayStr = today()
            const inRange = yearTerms.find((t) => t.startDate <= todayStr && t.endDate >= todayStr)
            if (inRange) setTermId(inRange.id)
            else if (yearTerms[0]) setTermId(yearTerms[0].id)
          }
        },
      )
      .catch((err) => {
        console.error(err)
        notify.error('Could not load report data')
      })
      .finally(() => {
        if (mounted) setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  const className = useMemo(() => {
    const map: Record<string, string> = {}
    for (const c of classes) map[c.id] = c.name
    return map
  }, [classes])

  const subjectName = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of subjects) map[s.id] = s.name
    return map
  }, [subjects])

  const studentName = useMemo(() => {
    const map: Record<string, string> = {}
    for (const s of students) map[s.id] = fullName(s)
    return map
  }, [students])

  const filteredTerms = useMemo(() => {
    if (yearId === 'all') return terms
    return terms.filter((t) => t.academicYearId === yearId)
  }, [terms, yearId])

  const table: ReportTable = useMemo(() => {
    const q = search.trim().toLowerCase()
    const title = REPORT_KIND_LABELS[kind]

    if (kind === 'students') {
      const rows = students
        .filter((s) => statusFilter === 'all' || s.status === statusFilter)
        .filter((s) => classId === 'all' || s.classId === classId)
        .filter((s) => {
          if (!q) return true
          return `${fullName(s)} ${s.admissionNumber} ${s.studentNumber} ${s.phone} ${s.email}`
            .toLowerCase()
            .includes(q)
        })
        .sort((a, b) => fullName(a).localeCompare(fullName(b)))
        .map((s, i) => [
          String(i + 1),
          fullName(s),
          s.admissionNumber || s.studentNumber || '—',
          className[s.classId] || '—',
          educationLevelName(s.educationLevelId) || '—',
          s.status,
          s.phone || '—',
          s.gender || '—',
        ])
      return {
        title,
        headers: ['#', 'Name', 'Admission no.', 'Class', 'Level', 'Status', 'Phone', 'Gender'],
        rows,
        summary: `${rows.length} student(s)`,
      }
    }

    if (kind === 'attendance') {
      const rows = attendance
        .filter((a) => a.date >= fromDate && a.date <= toDate)
        .filter((a) => classId === 'all' || a.classId === classId)
        .filter((a) => {
          if (!q) return true
          return `${studentName[a.studentId] || ''} ${a.status} ${a.date}`
            .toLowerCase()
            .includes(q)
        })
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            (studentName[a.studentId] || '').localeCompare(studentName[b.studentId] || ''),
        )
        .map((a, i) => [
          String(i + 1),
          formatDate(a.date),
          studentName[a.studentId] || a.studentId,
          className[a.classId] || a.classId || '—',
          a.status,
          a.kind || 'DAILY',
        ])
      const present = rows.filter((r) => r[4] === 'PRESENT' || r[4] === 'LATE').length
      return {
        title: `${title} (${fromDate} → ${toDate})`,
        headers: ['#', 'Date', 'Student', 'Class', 'Status', 'Kind'],
        rows,
        summary: `${rows.length} records · ${present} present/late`,
      }
    }

    if (kind === 'fees') {
      const rows = invoices
        .filter((inv) => {
          const d = inv.dueDate
          return (!fromDate || d >= fromDate) && (!toDate || d <= toDate)
        })
        .filter((inv) => {
          if (classId === 'all') return true
          const s = students.find((x) => x.id === inv.studentId)
          return s?.classId === classId
        })
        .filter((inv) => statusFilter === 'all' || inv.status === statusFilter)
        .filter((inv) => {
          if (!q) return true
          return `${studentName[inv.studentId] || ''} ${inv.number} ${inv.status}`
            .toLowerCase()
            .includes(q)
        })
        .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
        .map((inv, i) => {
          const outstanding = invoiceBalance(inv)
          return [
            String(i + 1),
            inv.number,
            studentName[inv.studentId] || inv.studentId,
            formatDate(inv.dueDate),
            formatCurrency(inv.total),
            formatCurrency(inv.paid),
            formatCurrency(inv.scholarshipAmount ?? 0),
            formatCurrency(outstanding),
            inv.status,
          ]
        })
      const totalOut = invoices
        .filter((inv) => rows.some((r) => r[1] === inv.number))
        .reduce((sum, inv) => sum + invoiceBalance(inv), 0)
      const paidPeriod = payments
        .filter((p) => p.paidAt.slice(0, 10) >= fromDate && p.paidAt.slice(0, 10) <= toDate)
        .reduce(
          (sum, p) => sum + (p.status === 'CONFIRMED' || p.status === 'PENDING' ? p.amount : 0),
          0,
        )
      return {
        title: `${title} (${fromDate} → ${toDate})`,
        headers: [
          '#',
          'Invoice',
          'Student',
          'Due',
          'Total',
          'Paid',
          'Scholarship',
          'Outstanding',
          'Status',
        ],
        rows,
        summary: `${rows.length} invoice(s) · Outstanding ${formatCurrency(totalOut)} · Payments in range ${formatCurrency(paidPeriod)}`,
      }
    }

    if (kind === 'academic') {
      const activeClasses = classes.filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE')
      const scoped = activeClasses.filter((c) => classId === 'all' || c.id === classId)
      const rows = scoped
        .map((c) => {
          const enrolled = students.filter(
            (s) => s.classId === c.id && (statusFilter === 'all' || s.status === statusFilter),
          )
          return { class: c, enrolled }
        })
        .filter((x) => {
          if (!q) return true
          return `${x.class.name} ${educationLevelName(x.class.educationLevelId)}`
            .toLowerCase()
            .includes(q)
        })
        .sort((a, b) => a.class.name.localeCompare(b.class.name))
        .map((x, i) => [
          String(i + 1),
          x.class.name,
          educationLevelName(x.class.educationLevelId) || x.class.level || '—',
          String(x.enrolled.length),
          String(x.class.capacity ?? '—'),
          x.class.status ?? 'ACTIVE',
        ])
      return {
        title,
        headers: ['#', 'Class', 'Level', 'Enrolled', 'Capacity', 'Status'],
        rows,
        summary: `${rows.length} class(es)`,
      }
    }

    if (kind === 'results') {
      const termIdsForYear =
        yearId === 'all'
          ? null
          : new Set(terms.filter((t) => t.academicYearId === yearId).map((t) => t.id))
      const published = assessments.filter(
        (a) => a.status === 'PUBLISHED' || a.status === 'LOCKED',
      )
      const rows = marks
        .filter((m) => m.status === 'PUBLISHED' || m.status === 'LOCKED')
        .map((m) => {
          const a = published.find((x) => x.id === m.assessmentId)
          return { m, a }
        })
        .filter((x) => x.a)
        .filter((x) => classId === 'all' || x.a!.classId === classId || !x.a!.classId)
        .filter((x) => !termIdsForYear || termIdsForYear.has(x.a!.termId))
        .filter((x) => termId === 'all' || x.a!.termId === termId)
        .filter((x) => {
          if (!q) return true
          return `${studentName[x.m.studentId] || ''} ${subjectName[x.a!.subjectId] || ''} ${x.a!.name}`
            .toLowerCase()
            .includes(q)
        })
        .sort((a, b) => (b.a!.name || '').localeCompare(a.a!.name || ''))
        .map((x, i) => [
          String(i + 1),
          x.a!.name,
          x.a!.type,
          subjectName[x.a!.subjectId] || x.a!.subjectId,
          studentName[x.m.studentId] || x.m.studentId,
          className[x.a!.classId || ''] || '—',
          String(x.m.score),
          x.m.grade || '—',
          x.m.status,
        ])
      return {
        title,
        headers: [
          '#',
          'Assessment',
          'Type',
          'Subject',
          'Student',
          'Class',
          'Score',
          'Grade',
          'Status',
        ],
        rows,
        summary: `${rows.length} published mark(s)`,
      }
    }

    const rows = staff
      .filter((s) => statusFilter === 'all' || s.status === statusFilter)
      .filter((s) => {
        if (!q) return true
        return `${s.firstName} ${s.lastName} ${s.title} ${s.department} ${s.email}`
          .toLowerCase()
          .includes(q)
      })
      .sort((a, b) =>
        `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`),
      )
      .map((s, i) => [
        String(i + 1),
        `${s.firstName} ${s.lastName}`,
        staffCategoryLabel(s.category),
        s.title || '—',
        s.department || '—',
        s.email || '—',
        s.phone || '—',
        s.status,
      ])
    return {
      title,
      headers: ['#', 'Name', 'Category', 'Title', 'Department', 'Email', 'Phone', 'Status'],
      rows,
      summary: `${rows.length} staff member(s)`,
    }
  }, [
    kind,
    search,
    students,
    attendance,
    invoices,
    payments,
    classes,
    staff,
    marks,
    assessments,
    terms,
    fromDate,
    toDate,
    classId,
    statusFilter,
    yearId,
    termId,
    className,
    subjectName,
    studentName,
  ])

  function openReport(next: ReportKind) {
    setKind(next)
    setSearch('')
    if (next === 'fees') setStatusFilter('all')
    else if (next === 'staff' || next === 'students' || next === 'academic') setStatusFilter('ACTIVE')
    setView('detail')
  }

  function exportPdf() {
    try {
      downloadReportPdf({
        schoolName,
        table,
        filename: `viste-${kind}-report-${today()}`,
      })
      notify.success('PDF downloaded')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not create PDF')
    }
  }

  function exportCsv() {
    try {
      downloadReportCsv(table, `viste-${kind}-report-${today()}`)
      notify.success('CSV downloaded')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not create CSV')
    }
  }

  function printReport() {
    if (view !== 'detail') {
      notify.info('Open a report first, then print.')
      return
    }
    try {
      downloadReportPdf({
        schoolName,
        table,
        filename: `viste-${kind}-report-${today()}`,
      })
      notify.success('Printable PDF ready')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Could not create PDF')
    }
  }

  if (loading) return <LoadingState message="Loading reports…" />

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Filter and export live school reports — PDF or CSV."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Reports' }]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={printReport}>
              <Printer className="h-4 w-4" />
              Print
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button">
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  {view === 'detail' ? 'Export current report' : 'Open a report to export'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={view !== 'detail'} onClick={exportPdf}>
                  <FileText className="mr-2 h-4 w-4" />
                  Download PDF
                </DropdownMenuItem>
                <DropdownMenuItem disabled={view !== 'detail'} onClick={exportCsv}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Download CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field>
          <Label>Start Date</Label>
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </Field>
        <Field>
          <Label>End Date</Label>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </Field>
        <Field>
          <Label>Academic Session</Label>
          <Select
            value={yearId}
            onChange={(e) => {
              setYearId(e.target.value)
              setTermId('all')
            }}
          >
            <option value="all">All sessions</option>
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label>Term</Label>
          <Select value={termId} onChange={(e) => setTermId(e.target.value)}>
            <option value="all">All terms</option>
            {filteredTerms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {view === 'hub' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {KINDS.map((k) => (
            <Card key={k}>
              <CardHeader>
                <CardTitle>{REPORT_KIND_LABELS[k]}</CardTitle>
                <CardDescription>{REPORT_KIND_DESCRIPTIONS[k]}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" onClick={() => openReport(k)}>
                  Open
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setView('hub')}>
              <ArrowLeft className="h-4 w-4" />
              All reports
            </Button>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={kind === k ? 'default' : 'outline'}
                  onClick={() => openReport(k)}
                >
                  {REPORT_KIND_LABELS[k].replace(' Reports', '')}
                </Button>
              ))}
            </div>
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(kind === 'students' ||
              kind === 'attendance' ||
              kind === 'fees' ||
              kind === 'academic' ||
              kind === 'results') && (
              <Field>
                <Label>Class</Label>
                <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
                  <option value="all">All classes</option>
                  {classes
                    .filter((c) => (c.status ?? 'ACTIVE') === 'ACTIVE')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              </Field>
            )}
            {(kind === 'students' || kind === 'staff' || kind === 'fees' || kind === 'academic') && (
              <Field>
                <Label>Status</Label>
                <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All</option>
                  {kind === 'fees' ? (
                    <>
                      <option value="OPEN">Open</option>
                      <option value="PARTIAL">Partial</option>
                      <option value="PAID">Paid</option>
                      <option value="OVERDUE">Overdue</option>
                    </>
                  ) : kind === 'staff' ? (
                    <>
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                    </>
                  ) : (
                    <>
                      <option value="ACTIVE">Active</option>
                      <option value="TRANSFERRED">Transferred</option>
                      <option value="ARCHIVED">Archived</option>
                      <option value="SUSPENDED">Suspended</option>
                    </>
                  )}
                </Select>
              </Field>
            )}
            <Field className="sm:col-span-2">
              <Label>Search</Label>
              <SearchInput
                id="report-search"
                name="report-search"
                value={search}
                onChange={setSearch}
                placeholder="Filter rows…"
              />
            </Field>
          </div>

          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">{table.title}</h2>
              {table.summary ? (
                <p className="text-xs text-muted-foreground">{table.summary}</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={exportCsv}>
                CSV
              </Button>
              <Button type="button" size="sm" onClick={exportPdf}>
                PDF
              </Button>
            </div>
          </div>

          {table.rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
              No rows match the current filters.
            </p>
          ) : (
            <DataTableShell>
              <DataTable>
                <DataTableHead>
                  <tr>
                    {table.headers.map((h) => (
                      <DataTableHeaderCell key={h}>{h}</DataTableHeaderCell>
                    ))}
                  </tr>
                </DataTableHead>
                <DataTableBody>
                  {table.rows.map((row, idx) => (
                    <DataTableRow key={`${kind}-${idx}`}>
                      {row.map((cell, cIdx) => (
                        <DataTableCell
                          key={`${idx}-${cIdx}`}
                          className={cIdx === 0 ? 'text-muted-foreground' : 'text-sm'}
                        >
                          {cell}
                        </DataTableCell>
                      ))}
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
