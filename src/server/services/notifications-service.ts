import 'server-only'

import type { SessionContext } from '@/server/auth/session'
import { forbidden } from '@/server/errors'
import { schoolToday } from '@/server/lib/school-time'
import {
  getDoc,
  newId,
  queryCollection,
  setDoc,
  updateDoc,
} from '@/server/repositories/firestore-repo'
import type {
  AppNotification,
  AppNotificationClassContact,
  SchoolClass,
  Staff,
  Student,
} from '@/types'

const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL', 'REGISTRAR'])

/** Collapse individual submit alerts once more than this many exist for a date. */
export const REGISTER_SUBMIT_NOTIFY_LIMIT = 5

function assertAdminNotifications(session: SessionContext) {
  if (!ADMIN_ROLES.has(session.role)) {
    throw forbidden('Admin notifications are only available to school administrators')
  }
}

/** Create a per-class “teacher submitted register” admin notification. */
export async function notifyRegisterSubmitted(input: {
  date: string
  classId: string
  className: string
  teacherName: string
}): Promise<void> {
  const id = newId('notif')
  const row: AppNotification = {
    id,
    audience: 'ADMIN',
    type: 'REGISTER_SUBMITTED',
    title: `${input.teacherName} submitted register`,
    body: `${input.className} · ${input.date}`,
    createdAt: new Date().toISOString(),
    read: false,
    date: input.date,
    href: '/attendance',
    meta: {
      classId: input.classId,
      className: input.className,
      teacherName: input.teacherName,
    },
  }
  await setDoc('notifications', id, { ...row })
}

export async function notifyResultsSubmitted(input: {
  assessmentId: string
  assessmentName: string
  className: string
  subjectName: string
  teacherName: string
}): Promise<void> {
  const id = newId('notif')
  const row: AppNotification = {
    id,
    audience: 'ADMIN',
    type: 'RESULTS_SUBMITTED',
    title: 'Results waiting for approval',
    body: `${input.teacherName} submitted ${input.subjectName} · ${input.className} (${input.assessmentName})`,
    createdAt: new Date().toISOString(),
    read: false,
    href: '/approvals',
    meta: {
      className: input.className,
      teacherName: input.teacherName,
      assessmentId: input.assessmentId,
      subjectName: input.subjectName,
      status: 'SUBMITTED',
    },
  }
  await setDoc('notifications', id, { ...row })
}

export async function notifyResultsReleased(input: {
  assessmentId: string
  assessmentName: string
  className: string
  subjectName: string
}): Promise<void> {
  const id = newId('notif')
  const row: AppNotification = {
    id,
    audience: 'ADMIN',
    type: 'RESULTS_RELEASED',
    title: 'Results released to the portal',
    body: `${input.subjectName} · ${input.className} is now visible to students (${input.assessmentName})`,
    createdAt: new Date().toISOString(),
    read: false,
    href: '/results',
    meta: {
      className: input.className,
      assessmentId: input.assessmentId,
      subjectName: input.subjectName,
      status: 'PUBLISHED',
    },
  }
  await setDoc('notifications', id, { ...row })
}

export async function notifyResultsUnderReview(input: {
  assessmentId: string
  assessmentName: string
  className: string
  subjectName: string
}): Promise<void> {
  const id = newId('notif')
  const row: AppNotification = {
    id,
    audience: 'ADMIN',
    type: 'RESULTS_UNDER_REVIEW',
    title: 'Results held for review',
    body: `${input.subjectName} · ${input.className} is waiting for review (${input.assessmentName})`,
    createdAt: new Date().toISOString(),
    read: false,
    href: '/approvals',
    meta: {
      className: input.className,
      assessmentId: input.assessmentId,
      subjectName: input.subjectName,
      status: 'UNDER_REVIEW',
    },
  }
  await setDoc('notifications', id, { ...row })
}

export async function notifyResultsDenied(input: {
  assessmentId: string
  assessmentName: string
  className: string
  subjectName: string
}): Promise<void> {
  const id = newId('notif')
  const row: AppNotification = {
    id,
    audience: 'ADMIN',
    type: 'RESULTS_DENIED',
    title: 'Results sent back',
    body: `${input.subjectName} · ${input.className} was denied and sent back to the teacher (${input.assessmentName})`,
    createdAt: new Date().toISOString(),
    read: false,
    href: '/approvals',
    meta: {
      className: input.className,
      assessmentId: input.assessmentId,
      subjectName: input.subjectName,
      status: 'REJECTED',
    },
  }
  await setDoc('notifications', id, { ...row })
}

/**
 * List admin notifications. When more than REGISTER_SUBMIT_NOTIFY_LIMIT
 * REGISTER_SUBMITTED items share a date, they collapse into one digest line:
 * "{n} submitted daily registers".
 */
export async function listAdminNotifications(
  session: SessionContext,
): Promise<AppNotification[]> {
  assertAdminNotifications(session)

  const { remember, sessionCacheKey } = await import('@/server/http/memo')
  return remember(sessionCacheKey(session, 'admin-notifications'), 45_000, async () => {
  let rows: AppNotification[] = []
  try {
    rows = await queryCollection<AppNotification>('notifications', {
      limit: 40,
      where: [{ field: 'audience', op: '==', value: 'ADMIN' }],
    })
  } catch (err) {
    console.error('listAdminNotifications query failed', err)
    rows = []
  }

  rows.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))

  const byDate = new Map<string, AppNotification[]>()
  const others: AppNotification[] = []

  for (const row of rows) {
    if (row.type === 'REGISTER_SUBMITTED' && row.date) {
      const list = byDate.get(row.date) ?? []
      list.push(row)
      byDate.set(row.date, list)
    } else if (row.type !== 'REGISTER_SUBMITTED_DIGEST') {
      others.push(row)
    }
  }

  const collapsed: AppNotification[] = []
  for (const [date, submits] of byDate) {
    if (submits.length > REGISTER_SUBMIT_NOTIFY_LIMIT) {
      const newest = submits[0]!
      const unread = submits.some((s) => !s.read)
      collapsed.push({
        id: `digest_register_${date}`,
        audience: 'ADMIN',
        type: 'REGISTER_SUBMITTED_DIGEST',
        title: `${submits.length} submitted daily registers`,
        body: `For ${date} — open Attendance to review.`,
        createdAt: newest.createdAt,
        read: !unread,
        date,
        href: '/attendance',
        meta: { count: submits.length },
      })
    } else {
      collapsed.push(...submits)
    }
  }

  return [...collapsed, ...others].sort((a, b) =>
    String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
  )
  })
}

export async function markNotificationRead(
  session: SessionContext,
  id: string,
): Promise<AppNotification | null> {
  assertAdminNotifications(session)

  if (id.startsWith('digest_register_')) {
    const date = id.replace('digest_register_', '')
    let rows: AppNotification[] = []
    try {
      rows = await queryCollection<AppNotification>('notifications', {
        limit: 100,
        where: [{ field: 'audience', op: '==', value: 'ADMIN' }],
      })
    } catch {
      rows = []
    }
    const targets = rows.filter((r) => r.type === 'REGISTER_SUBMITTED' && r.date === date && !r.read)
    await Promise.all(
      targets.map((r) => updateDoc('notifications', r.id, { read: true }).catch(() => undefined)),
    )
    return {
      id,
      audience: 'ADMIN',
      type: 'REGISTER_SUBMITTED_DIGEST',
      title: `${targets.length || 'All'} submitted daily registers`,
      body: `For ${date}`,
      createdAt: new Date().toISOString(),
      read: true,
      date,
      href: '/attendance',
      meta: { count: targets.length },
    }
  }

  const existing = await getDoc<AppNotification>('notifications', id)
  if (!existing || existing.audience !== 'ADMIN') return null
  if (!existing.read) {
    await updateDoc('notifications', id, { read: true })
  }
  return { ...existing, read: true }
}

export async function markAllAdminNotificationsRead(session: SessionContext): Promise<number> {
  assertAdminNotifications(session)
  let rows: AppNotification[] = []
  try {
    rows = await queryCollection<AppNotification>('notifications', {
      limit: 100,
      where: [{ field: 'audience', op: '==', value: 'ADMIN' }],
    })
  } catch {
    rows = []
  }
  const unread = rows.filter((r) => !r.read)
  await Promise.all(
    unread.map((r) => updateDoc('notifications', r.id, { read: true }).catch(() => undefined)),
  )
  return unread.length
}

/**
 * After 08:00 school time, notify admins about active classes that have students
 * but no submitted daily register for today. Idempotent per date.
 */
export async function runMissingRegisterReminder(now = new Date()): Promise<{
  date: string
  missingCount: number
  notificationId: string | null
}> {
  const date = schoolToday(now)
  const notifId = `notif_register_missing_${date}`

  const existing = await getDoc<AppNotification>('notifications', notifId)
  if (existing) {
    return { date, missingCount: existing.meta?.classes?.length ?? 0, notificationId: notifId }
  }

  const [classes, students, staff, sessions] = await Promise.all([
    queryCollection<SchoolClass>('classes', { limit: 100 }),
    queryCollection<Student>('students', { limit: 100 }),
    queryCollection<Staff>('staff', { limit: 100 }),
    queryCollection<{ id: string; date: string; classId: string }>('attendanceSessions', {
      limit: 100,
      where: [{ field: 'date', op: '==', value: date }],
    }).catch(() => [] as { id: string; date: string; classId: string }[]),
  ])

  const submitted = new Set(sessions.map((s) => s.classId))
  const staffById = new Map(staff.map((s) => [s.id, s]))
  const activeClassIdsWithStudents = new Set<string>()
  for (const s of students) {
    if (s.status === 'ACTIVE' && s.classId) activeClassIdsWithStudents.add(s.classId)
  }

  const missing: AppNotificationClassContact[] = []
  for (const cls of classes) {
    if ((cls.status ?? 'ACTIVE') !== 'ACTIVE') continue
    if (!activeClassIdsWithStudents.has(cls.id)) continue
    if (submitted.has(cls.id)) continue

    const teacher = cls.classTeacherId ? staffById.get(cls.classTeacherId) : undefined
    missing.push({
      classId: cls.id,
      className: cls.name,
      teacherName: teacher ? `${teacher.firstName} ${teacher.lastName}`.trim() : undefined,
      teacherPhone: teacher?.phone,
      teacherEmail: teacher?.email,
    })
  }

  if (missing.length === 0) {
    return { date, missingCount: 0, notificationId: null }
  }

  const lines = missing.map((m) => {
    const contact = [m.teacherName, m.teacherPhone, m.teacherEmail].filter(Boolean).join(' · ')
    return contact
      ? `${m.className}\n${contact}`
      : `${m.className}\nNo class teacher assigned`
  })

  const row: AppNotification = {
    id: notifId,
    audience: 'ADMIN',
    type: 'REGISTER_MISSING',
    title: `Registers not submitted (${missing.length})`,
    body: lines.join('\n\n'),
    createdAt: new Date().toISOString(),
    read: false,
    date,
    href: '/attendance',
    meta: { count: missing.length, classes: missing },
  }
  await setDoc('notifications', notifId, { ...row })
  return { date, missingCount: missing.length, notificationId: notifId }
}

export const listAdminNotificationsService = listAdminNotifications
export const markNotificationReadService = markNotificationRead
export const markAllAdminNotificationsReadService = markAllAdminNotificationsRead
export const runMissingRegisterReminderService = runMissingRegisterReminder
export const notifyRegisterSubmittedService = notifyRegisterSubmitted
