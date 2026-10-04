import { useEffect, useState } from 'react'
import { PageHeader } from '@/components/shared/page-header'
import { LoadingState } from '@/components/shared/loading-state'
import { StatusBadge } from '@/components/shared/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { catalogService } from '@/services/api'
import { studentService } from '@/services/api'
import { formatDate, formatDateTime } from '@/lib/utils'
import { notify, runMockProcess } from '@/lib/notify'
import { useAuth } from '@/contexts/auth-context'
import type { Announcement, LibraryBook, LibraryLoan, Student } from '@/types'

export { ReportsPage } from '@/views/reports-page'
export { InventoryPage } from '@/views/inventory-page'
export { TransportPage } from '@/views/transport-page'
export { UsersRolesPage } from '@/views/users-roles-page'
export { AuditLogsPage } from '@/views/audit-logs-page'

export function AnnouncementsPage() {
  const [rows, setRows] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    catalogService.getAnnouncements().then((a) => {
      setRows(a)
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingState message="Loading announcements…" />

  return (
    <div>
      <PageHeader
        title="Announcements"
        description="Create and publish school communications."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Announcements' }]}
        actions={<Button onClick={() => setOpen(true)}>Create announcement</Button>}
      />
      <div className="space-y-3">
        {rows.map((a) => (
          <Card key={a.id}>
            <CardContent className="space-y-2 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-lg font-semibold">{a.title}</h3>
                <StatusBadge status={a.status} />
              </div>
              <p className="text-sm text-muted-foreground">{a.body}</p>
              <p className="text-xs text-muted-foreground">
                Audience: {a.audience.join(', ')} · {a.author}
                {a.publishedAt ? ` · ${formatDateTime(a.publishedAt)}` : ''}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create announcement</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field>
              <Label>Title</Label>
              <Input />
            </Field>
            <Field>
              <Label>Body</Label>
              <Textarea />
            </Field>
            <Field>
              <Label>Audience</Label>
              <Select defaultValue="Parents">
                <option>Parents</option>
                <option>Students</option>
                <option>Teachers</option>
                <option>All</option>
              </Select>
            </Field>
            <Button
              loading={saving}
              onClick={() => {
                void (async () => {
                  setSaving(true)
                  try {
                    await runMockProcess({
                      loading: 'Saving announcement…',
                      success: 'Announcement saved',
                    })
                    setOpen(false)
                  } finally {
                    setSaving(false)
                  }
                })()
              }}
            >
              Save draft
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function LibraryPage() {
  const { hasPermission } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [books, setBooks] = useState<LibraryBook[]>([])
  const [loans, setLoans] = useState<LibraryLoan[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [bookOpen, setBookOpen] = useState(false)
  const [loanOpen, setLoanOpen] = useState(false)
  const [bookForm, setBookForm] = useState({
    title: '',
    author: '',
    category: '',
    isbn: '',
    shelfLocation: '',
    copies: '1',
  })
  const [loanForm, setLoanForm] = useState({
    bookId: '',
    studentId: '',
    dueAt: '',
    borrowerPhone: '',
    notes: '',
  })
  const canManageLibrary = hasPermission('library.manage')

  useEffect(() => {
    void Promise.all([
      catalogService.getBooks(),
      catalogService.getLoans(),
      studentService.list(),
    ])
      .then(([b, l, s]) => {
        setBooks(b)
        setLoans(l)
        setStudents(s.filter((student) => student.status === 'ACTIVE'))
      })
      .catch((error: unknown) => {
        notify.error(error instanceof Error ? error.message : 'Could not load library records')
      })
      .finally(() => setLoading(false))
  }, [])

  async function saveBook() {
    if (!bookForm.title.trim() || !bookForm.author.trim() || !bookForm.category.trim()) {
      notify.error('Title, author and category are required')
      return
    }
    setSaving(true)
    try {
      const created = await notify.process(
        () =>
          catalogService.createBook({
            title: bookForm.title.trim(),
            author: bookForm.author.trim(),
            category: bookForm.category.trim(),
            isbn: bookForm.isbn.trim() || undefined,
            shelfLocation: bookForm.shelfLocation.trim() || undefined,
            copies: Number(bookForm.copies),
          }),
        { loading: 'Adding book…', success: 'Book added to the catalogue' },
      )
      setBooks((prev) => [created, ...prev])
      setBookOpen(false)
      setBookForm({
        title: '',
        author: '',
        category: '',
        isbn: '',
        shelfLocation: '',
        copies: '1',
      })
    } finally {
      setSaving(false)
    }
  }

  async function issueBook() {
    if (!loanForm.bookId || !loanForm.studentId || !loanForm.dueAt) {
      notify.error('Select a book, student and due date')
      return
    }
    setSaving(true)
    try {
      const created = await notify.process(
        () => catalogService.createLoan(loanForm),
        { loading: 'Issuing book…', success: 'Book issued to student' },
      )
      setLoans((prev) => [created, ...prev])
      setBooks((prev) =>
        prev.map((book) =>
          book.id === created.bookId ? { ...book, available: Math.max(0, book.available - 1) } : book,
        ),
      )
      setLoanOpen(false)
      setLoanForm({
        bookId: '',
        studentId: '',
        dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
        borrowerPhone: '',
        notes: '',
      })
    } finally {
      setSaving(false)
    }
  }

  async function returnBook(loan: LibraryLoan) {
    setSaving(true)
    try {
      const updated = await notify.process(
        () => catalogService.returnLoan(loan.id),
        { loading: 'Recording return…', success: 'Book returned' },
      )
      setLoans((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      setBooks((prev) =>
        prev.map((book) =>
          book.id === updated.bookId
            ? { ...book, available: Math.min(book.copies, book.available + 1) }
            : book,
        ),
      )
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingState message="Loading library…" />

  return (
    <div>
      <PageHeader
        title="Library"
        description="Manage the catalogue and track student borrowing and returns."
        breadcrumbs={[{ label: 'Home', to: '/dashboard' }, { label: 'Library' }]}
        actions={
          canManageLibrary ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setBookOpen(true)}>Add book</Button>
              <Button
                onClick={() => {
                  setLoanForm((form) => ({
                    ...form,
                    dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
                  }))
                  setLoanOpen(true)
                }}
              >
                Issue book
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Catalogue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {books.length === 0 ? (
              <p className="text-sm text-muted-foreground">No books have been added yet.</p>
            ) : books.map((b) => (
              <div key={b.id} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-medium">{b.title}</p>
                <p className="text-muted-foreground">
                  {b.author} · {b.category} · {b.available}/{b.copies} available
                </p>
                {[b.shelfLocation, b.isbn].filter(Boolean).length ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[b.shelfLocation ? `Shelf ${b.shelfLocation}` : '', b.isbn ? `ISBN ${b.isbn}` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Loans & fines</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loans.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active loans.</p>
            ) : (
              loans.map((l) => (
                <div key={l.id} className="rounded-lg border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-medium">
                      {books.find((book) => book.id === l.bookId)?.title ?? l.bookId}
                    </p>
                    {!l.returnedAt && canManageLibrary ? (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={saving}
                        onClick={() => void returnBook(l)}
                      >
                        Record return
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground">
                    {l.studentName ?? l.studentId}
                    {l.studentNumber ? ` · ${l.studentNumber}` : ''}
                    {l.className ? ` · ${l.className}` : ''}
                    {' · borrowed '}{formatDate(l.borrowedAt)}
                    {' · due '}{formatDate(l.dueAt)}
                    {l.returnedAt ? ` · returned ${formatDate(l.returnedAt)}` : ''}
                    {l.fine ? ` · fine ${l.fine}` : ''}
                  </p>
                  {l.borrowerPhone ? (
                    <p className="text-xs text-muted-foreground">Contact: {l.borrowerPhone}</p>
                  ) : null}
                  {l.notes ? <p className="mt-1 text-xs text-muted-foreground">{l.notes}</p> : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
      <Dialog open={bookOpen} onOpenChange={setBookOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a book</DialogTitle></DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <Label>Title</Label>
              <Input value={bookForm.title} onChange={(e) => setBookForm((f) => ({ ...f, title: e.target.value }))} />
            </Field>
            <Field>
              <Label>Author</Label>
              <Input value={bookForm.author} onChange={(e) => setBookForm((f) => ({ ...f, author: e.target.value }))} />
            </Field>
            <Field>
              <Label>Category</Label>
              <Input value={bookForm.category} onChange={(e) => setBookForm((f) => ({ ...f, category: e.target.value }))} />
            </Field>
            <Field>
              <Label>Copies</Label>
              <Input type="number" min="1" value={bookForm.copies} onChange={(e) => setBookForm((f) => ({ ...f, copies: e.target.value }))} />
            </Field>
            <Field>
              <Label>ISBN (optional)</Label>
              <Input value={bookForm.isbn} onChange={(e) => setBookForm((f) => ({ ...f, isbn: e.target.value }))} />
            </Field>
            <Field>
              <Label>Shelf location (optional)</Label>
              <Input value={bookForm.shelfLocation} onChange={(e) => setBookForm((f) => ({ ...f, shelfLocation: e.target.value }))} />
            </Field>
          </div>
          <Button loading={saving} onClick={() => void saveBook()}>Save book</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={loanOpen} onOpenChange={setLoanOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Issue a book</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <Field>
              <Label>Book</Label>
              <Select value={loanForm.bookId} onChange={(e) => setLoanForm((f) => ({ ...f, bookId: e.target.value }))}>
                <option value="">Select a book</option>
                {books.filter((book) => book.available > 0).map((book) => (
                  <option key={book.id} value={book.id}>{book.title} ({book.available} available)</option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>Student</Label>
              <Select value={loanForm.studentId} onChange={(e) => setLoanForm((f) => ({ ...f, studentId: e.target.value }))}>
                <option value="">Select a student</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.firstName} {student.lastName} · {student.studentNumber}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <Label>Due date</Label>
                <Input type="date" value={loanForm.dueAt} onChange={(e) => setLoanForm((f) => ({ ...f, dueAt: e.target.value }))} />
              </Field>
              <Field>
                <Label>Borrower contact (optional)</Label>
                <Input value={loanForm.borrowerPhone} onChange={(e) => setLoanForm((f) => ({ ...f, borrowerPhone: e.target.value }))} />
              </Field>
            </div>
            <Field>
              <Label>Notes (optional)</Label>
              <Textarea value={loanForm.notes} onChange={(e) => setLoanForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            </Field>
          </div>
          <Button loading={saving} onClick={() => void issueBook()}>Issue book</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
