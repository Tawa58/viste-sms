import 'server-only'

import { getAdminDb } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import { badRequest, notFound } from '@/server/errors'
import { getDoc, newId, queryCollection, setDoc } from '@/server/repositories/firestore-repo'
import type { LibraryBook, LibraryLoan, SchoolClass, Student } from '@/types'
import type { LibraryBookInput, LibraryLoanInput } from '@/server/validators/school'

export async function listLibraryBooks(session: SessionContext): Promise<LibraryBook[]> {
  requirePermission(session, 'library.manage')
  return queryCollection<LibraryBook>('libraryBooks', { limit: 500, orderBy: 'title' })
}

export async function createLibraryBook(
  session: SessionContext,
  input: LibraryBookInput,
  requestId?: string,
): Promise<LibraryBook> {
  requirePermission(session, 'library.manage')
  const id = newId('book')
  const row: LibraryBook = {
    id,
    title: input.title.trim(),
    author: input.author.trim(),
    category: input.category.trim(),
    isbn: input.isbn?.trim() || undefined,
    publisher: input.publisher?.trim() || undefined,
    publicationYear: input.publicationYear,
    shelfLocation: input.shelfLocation?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    copies: input.copies,
    available: input.copies,
  }
  await setDoc('libraryBooks', id, row)
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'library.book.create',
    entityType: 'libraryBooks',
    entityId: id,
    requestId,
    metadata: { title: row.title, copies: row.copies },
  })
  return row
}

export async function listLibraryLoans(session: SessionContext): Promise<LibraryLoan[]> {
  requirePermission(session, 'library.manage')
  return queryCollection<LibraryLoan>('libraryLoans', { limit: 1000, orderBy: 'borrowedAt', orderDirection: 'desc' })
}

export async function createLibraryLoan(
  session: SessionContext,
  input: LibraryLoanInput,
  requestId?: string,
): Promise<LibraryLoan> {
  requirePermission(session, 'library.manage')
  const [book, student] = await Promise.all([
    getDoc<LibraryBook>('libraryBooks', input.bookId),
    getDoc<Student>('students', input.studentId),
  ])
  if (!book) throw notFound('Book not found')
  if (!student) throw notFound('Student not found')
  if (student.status !== 'ACTIVE') throw badRequest('Only active students can borrow books')
  if (input.dueAt < new Date().toISOString().slice(0, 10)) {
    throw badRequest('Due date cannot be before today')
  }

  const id = newId('loan')
  const borrowedAt = new Date().toISOString()
  const klass = await getDoc<SchoolClass>('classes', student.classId)
  const row: LibraryLoan = {
    id,
    bookId: book.id,
    studentId: student.id,
    studentName: `${student.firstName} ${student.lastName}`.trim(),
    studentNumber: student.studentNumber,
    className: klass?.name ?? student.classId,
    borrowerPhone: input.borrowerPhone?.trim() || student.phone || undefined,
    borrowedAt,
    dueAt: input.dueAt,
    fine: 0,
    notes: input.notes?.trim() || undefined,
  }
  const db = getAdminDb()
  await db.runTransaction(async (tx) => {
    const bookRef = db.collection('libraryBooks').doc(book.id)
    const latest = await tx.get(bookRef)
    if (!latest.exists) throw notFound('Book not found')
    const available = Number(latest.data()?.available ?? 0)
    if (available < 1) throw badRequest('No copies of this book are available')
    tx.update(bookRef, { available: available - 1 })
    tx.set(db.collection('libraryLoans').doc(id), row)
  })
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'library.loan.create',
    entityType: 'libraryLoans',
    entityId: id,
    requestId,
    metadata: { bookId: book.id, studentId: student.id, dueAt: row.dueAt },
  })
  return row
}

export async function returnLibraryLoan(
  session: SessionContext,
  loanId: string,
  requestId?: string,
): Promise<LibraryLoan> {
  requirePermission(session, 'library.manage')
  const db = getAdminDb()
  const loanRef = db.collection('libraryLoans').doc(loanId)
  const updated = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(loanRef)
    if (!snapshot.exists) throw notFound('Loan not found')
    const loan = { ...(snapshot.data() as LibraryLoan), id: snapshot.id }
    if (loan.returnedAt) throw badRequest('This book has already been returned')
    const bookRef = db.collection('libraryBooks').doc(loan.bookId)
    const bookSnapshot = await tx.get(bookRef)
    const returnedAt = new Date().toISOString()
    const next = { ...loan, returnedAt, fine: loan.fine ?? 0 }
    tx.set(loanRef, next)
    if (bookSnapshot.exists) {
      const book = bookSnapshot.data() as LibraryBook
      tx.update(bookRef, { available: Math.min(book.copies, (book.available ?? 0) + 1) })
    }
    return next
  })
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'library.loan.return',
    entityType: 'libraryLoans',
    entityId: loanId,
    requestId,
  })
  return updated
}
