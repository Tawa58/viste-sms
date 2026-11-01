import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import {
  getCatalogSnapshot,
  listAnnouncementsService,
} from '@/server/services/catalog-service'
import { listStudents } from '@/server/services/students-service'
import { listStaff } from '@/server/services/staff-service'
import { listGuardians } from '@/server/services/guardians-service'
import { listAttendance } from '@/server/services/attendance-service'
import { listInvoices, listPayments } from '@/server/services/finance-service'
import { hasPermission } from '@/server/authorization/rbac-map'

type Scope = 'critical' | 'rest' | 'all'

/**
 * Warm-up payload.
 * - critical: dashboard + catalog + announcements (fast first paint)
 * - rest: heavier lists for other screens (idle prefetch)
 * - all: everything (compat)
 */
export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  const url = new URL(request.url)
  const scope = (url.searchParams.get('scope') as Scope) || 'critical'
  const result: Record<string, unknown> = {}

  const tasks: Promise<void>[] = []
  const put = (key: string, enabled: boolean, fn: () => Promise<unknown>) => {
    if (!enabled) {
      result[key] = null
      return
    }
    tasks.push(
      fn()
        .then((data) => {
          result[key] = data
        })
        .catch(() => {
          result[key] = null
        }),
    )
  }

  const wantCritical = scope === 'critical' || scope === 'all'
  const wantRest = scope === 'rest' || scope === 'all'

  if (wantCritical) {
    put(
      'catalog',
      hasPermission(session.role, 'classes.read') || hasPermission(session.role, 'subjects.read'),
      async () => {
        const snap = await getCatalogSnapshot(session)
        return {
          years: snap.academicYears,
          terms: snap.terms,
          classes: snap.classes,
          streams: snap.streams,
          subjects: snap.subjects,
        }
      },
    )
    put('announcements', true, () => listAnnouncementsService(session))
  }

  if (wantRest) {
    put('students', hasPermission(session.role, 'students.read'), () => listStudents(session))
    put('staff', hasPermission(session.role, 'teachers.read'), () => listStaff(session))
    put('guardians', hasPermission(session.role, 'parents.read'), () => listGuardians(session))
    put('attendance', hasPermission(session.role, 'attendance.read'), () =>
      listAttendance(session),
    )
    put('invoices', hasPermission(session.role, 'fees.read'), () => listInvoices(session))
    put('payments', hasPermission(session.role, 'payments.read'), () => listPayments(session))
  }

  await Promise.all(tasks)
  return jsonOk(result)
})
