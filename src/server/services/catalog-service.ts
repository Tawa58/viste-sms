import 'server-only'

import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import { listAccessibleStudents } from '@/server/authorization/isolation'
import { getAdminDb } from '@/lib/firebase/admin'
import { invoiceBalance } from '@/lib/fees'
import { queryCollection } from '@/server/repositories/firestore-repo'
import type {
  AcademicYear,
  Announcement,
  AuditLog,
  ClubActivity,
  DashboardStats,
  House,
  Invoice,
  Payment,
  SchoolClass,
  Sport,
  Stream,
  Subject,
  Term,
  Assessment,
} from '@/types'
import { listClasses as listClassesManaged } from '@/server/services/classes-service'
import { listSubjects as listSubjectsManaged } from '@/server/services/extracurricular-service'
import { computeTodayAttendancePct } from '@/server/services/attendance-service'

export type ClassDto = SchoolClass
export type StreamDto = Stream
export type SubjectDto = Subject
export type AcademicYearDto = AcademicYear
export type TermDto = Term

export async function listClasses(session: SessionContext): Promise<ClassDto[]> {
  return listClassesManaged(session)
}

export async function listStreams(session: SessionContext): Promise<StreamDto[]> {
  requirePermission(session, 'classes.read')
  const rows = await queryCollection<Stream>('streams', { limit: 100 })
  if (session.role !== 'TEACHER') return rows
  const { resolveTeacherClassIds } = await import('@/server/authorization/isolation')
  const allowed = new Set(await resolveTeacherClassIds(session))
  return rows.filter((s) => allowed.has(s.classId))
}

export async function listSubjects(session: SessionContext): Promise<SubjectDto[]> {
  return listSubjectsManaged(session)
}

export async function listAcademicYears(session: SessionContext): Promise<AcademicYearDto[]> {
  requirePermission(session, 'classes.read')
  return queryCollection<AcademicYear>('academicYears', { limit: 100 })
}

export async function listTerms(session: SessionContext): Promise<TermDto[]> {
  requirePermission(session, 'classes.read')
  return queryCollection<Term>('terms', { limit: 100 })
}

export async function getCatalogSnapshot(session: SessionContext) {
  requirePermission(session, 'classes.read')
  const { remember, sessionCacheKey } = await import('@/server/http/memo')
  return remember(sessionCacheKey(session, 'catalog'), 30_000, async () => {
    const { ensureCurrentAcademicCalendar } = await import(
      '@/server/services/academic-calendar-service'
    )
    await ensureCurrentAcademicCalendar()

    const [classes, streams, subjects, academicYears, terms, sports, clubs, houses] =
      await Promise.all([
        // Prefer managed lists so teachers only receive assigned classes/subjects.
        listClassesManaged(session),
        listStreams(session),
        listSubjectsManaged(session),
        queryCollection<AcademicYear>('academicYears', { limit: 100 }),
        queryCollection<Term>('terms', { limit: 100 }),
        queryCollection<Sport>('sports', { limit: 100 }).catch(() => [] as Sport[]),
        queryCollection<ClubActivity>('clubs', { limit: 100 }).catch(() => [] as ClubActivity[]),
        queryCollection<House>('houses', { limit: 100 }).catch(() => [] as House[]),
      ])
    return {
      classes,
      streams,
      subjects,
      academicYears,
      terms,
      sports,
      clubs,
      houses,
    }
  })
}

export const getCatalogService = getCatalogSnapshot

export type DashboardBundle = {
  stats: DashboardStats
  recentPayments: Payment[]
}

/**
 * Single round of Firestore reads for the dashboard.
 * Admin/staff roles use count() for headcounts (avoids downloading every student doc).
 */
export async function getDashboardBundle(session: SessionContext): Promise<DashboardBundle> {
  requirePermission(session, 'students.read')
  const db = getAdminDb()
  const scopedRole = session.role === 'PARENT' || session.role === 'STUDENT'

  const [accessibleStudents, studentCountSnap, teacherCount, invoices, payments, assessments, todayPct] =
    await Promise.all([
      scopedRole ? listAccessibleStudents(session) : Promise.resolve(null),
      scopedRole
        ? Promise.resolve(null)
        : db.collection('students').where('status', '==', 'ACTIVE').count().get(),
      db
        .collection('staff')
        .where('status', '==', 'ACTIVE')
        .count()
        .get()
        .then((snap) => snap.data().count),
      queryCollection<Invoice>('invoices', { limit: 100 }),
      queryCollection<Payment>('payments', { limit: 100 }),
      queryCollection<Assessment>('assessments', { limit: 100 }),
      computeTodayAttendancePct().catch(() => 0),
    ])

  let studentHeadcount: number
  let scopedInvoices = invoices
  let scopedPayments = payments

  if (accessibleStudents) {
    studentHeadcount = accessibleStudents.filter((s) => s.status === 'ACTIVE').length
    const studentIds = new Set(accessibleStudents.map((s) => s.id))
    scopedInvoices = invoices.filter((i) => studentIds.has(i.studentId))
    scopedPayments = payments.filter((p) => studentIds.has(p.studentId))
  } else {
    studentHeadcount = studentCountSnap?.data().count ?? 0
  }

  const stats: DashboardStats = {
    totalStudents: studentHeadcount,
    totalTeachers: teacherCount,
    todayAttendancePct: todayPct,
    outstandingFees: scopedInvoices.reduce((sum, invoice) => sum + invoiceBalance(invoice), 0),
    feesCollected: scopedPayments
      .filter((p) => p.status === 'CONFIRMED')
      .reduce((sum, p) => sum + p.amount, 0),
    pendingResults: assessments.filter((a) =>
      ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(a.status),
    ).length,
  }

  return {
    stats,
    recentPayments: scopedPayments.filter((p) => p.status === 'CONFIRMED').slice(0, 5),
  }
}

export async function getDashboardService(session: SessionContext): Promise<DashboardStats> {
  return (await getDashboardBundle(session)).stats
}

export async function listAnnouncementsService(session: SessionContext): Promise<Announcement[]> {
  // Any authenticated user may read announcements (portal + console)
  void session
  return queryCollection<Announcement>('announcements', { limit: 30 })
}

export async function listAuditLogsService(session: SessionContext): Promise<AuditLog[]> {
  const { listAuditLogsDetailedService } = await import('@/server/services/admin-users-service')
  return listAuditLogsDetailedService(session)
}

// Re-export attendance helpers expected by early API routes
export {
  listAttendance as listAttendanceService,
  listAttendanceSessions as listAttendanceSessionsService,
  upsertAttendance as upsertAttendanceService,
  submitDailyRegister as submitDailyRegisterService,
} from '@/server/services/attendance-service'
