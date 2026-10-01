import 'server-only'

import type { DocumentReference, Transaction } from 'firebase-admin/firestore'
import { getAdminDb } from '@/lib/firebase/admin'
import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import { badRequest, conflict, forbidden, notFound } from '@/server/errors'
import { getDoc, newId, setDoc } from '@/server/repositories/firestore-repo'
import { schoolToday } from '@/server/lib/school-time'
import {
  DEFAULT_CHECKIN_SETTINGS,
  datesInMonth,
  isLateCheckIn,
  siteFromSettings,
} from '@/lib/checkin'
import {
  evaluatePosition,
  formatMeters,
  isPreciseFix,
  roundMeters,
  type GeofenceSite,
} from '@/lib/geofence'
import type {
  BoundaryUpdateResult,
  CheckinAdminBundle,
  CheckinMessageInput,
  CheckinMessageUpdate,
  CheckinPosition,
  CheckinRosterEntry,
  CheckinSelfBundle,
  CheckinSettings,
  CheckinSettingsInput,
  CheckinTermRange,
  Staff,
  StaffBoundaryEvent,
  StaffCheckin,
  StaffCheckinMessage,
  UserRole,
} from '@/types'
import type { BoundaryUpdate, CheckinPunch } from '@/server/validators/checkin'

const CHECKINS = 'staffCheckins'
const EVENTS = 'staffBoundaryEvents'
const MESSAGES = 'staffCheckinMessages'

const CHECKIN_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'SCHOOL_ADMIN',
  'PRINCIPAL',
  'TEACHER',
  'ACCOUNTANT',
  'FINANCE_OFFICER',
  'REGISTRAR',
  'RECEPTIONIST',
  'LIBRARIAN',
  'TRANSPORT_MANAGER',
  'HR_ADMIN',
  'FINANCE_VIEWER',
]

function normalizeSettings(raw: Partial<CheckinSettings> | null): CheckinSettings {
  const d = DEFAULT_CHECKIN_SETTINGS
  const lat = typeof raw?.latitude === 'number' ? raw.latitude : null
  const lng = typeof raw?.longitude === 'number' ? raw.longitude : null
  const days = Array.isArray(raw?.workingDays)
    ? raw.workingDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    : []
  return {
    id: 'checkin',
    siteName: raw?.siteName?.trim() || d.siteName,
    latitude: lat !== null && lng !== null ? lat : null,
    longitude: lat !== null && lng !== null ? lng : null,
    radiusMeters:
      typeof raw?.radiusMeters === 'number' && raw.radiusMeters >= 10
        ? raw.radiusMeters
        : d.radiusMeters,
    requireInside: raw?.requireInside ?? d.requireInside,
    lateAfter: typeof raw?.lateAfter === 'string' ? raw.lateAfter : d.lateAfter,
    workingDays: days.length > 0 ? days : d.workingDays,
    updatedAt: raw?.updatedAt,
    updatedBy: raw?.updatedBy,
  }
}

export async function getCheckinSettings(): Promise<CheckinSettings> {
  return normalizeSettings(await getDoc<CheckinSettings>('settings', 'checkin'))
}

export async function updateCheckinSettings(
  session: SessionContext,
  input: CheckinSettingsInput,
  requestId?: string,
): Promise<CheckinSettings> {
  requirePermission(session, 'checkin.manage')
  const next: CheckinSettings = {
    ...input,
    id: 'checkin',
    siteName: input.siteName.trim(),
    updatedAt: new Date().toISOString(),
    updatedBy: session.uid,
  }
  await setDoc('settings', 'checkin', next)
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'checkin.settings_update',
    entityType: 'settings',
    entityId: 'checkin',
    requestId,
    metadata: {
      siteName: next.siteName,
      latitude: next.latitude,
      longitude: next.longitude,
      radiusMeters: next.radiusMeters,
      requireInside: next.requireInside,
    },
  })
  return next
}

function requireSite(settings: CheckinSettings): GeofenceSite {
  const site = siteFromSettings(settings)
  if (!site) {
    throw badRequest(
      'The school location has not been set yet. Ask an administrator to set it under Staff attendance → School location.',
    )
  }
  return site
}

function checkinId(uid: string, date: string) {
  return `${uid}_${date}`
}

function staffIdentity(session: SessionContext) {
  const p = session.profile
  return {
    uid: session.uid,
    staffId: p.staffId,
    name: p.name,
    role: session.role,
    department: p.department,
    employeeNumber: p.employeeNumber,
  }
}

async function listTerms(): Promise<CheckinTermRange[]> {
  const snap = await getAdminDb().collection('terms').get()
  return snap.docs
    .map((d) => d.data() as { startDate?: string; endDate?: string })
    .filter((t): t is CheckinTermRange => Boolean(t.startDate && t.endDate))
    .map((t) => ({ startDate: t.startDate.slice(0, 10), endDate: t.endDate.slice(0, 10) }))
}

async function getCheckinsByIds(uid: string, dates: string[]): Promise<StaffCheckin[]> {
  if (dates.length === 0) return []
  const db = getAdminDb()
  const refs = dates.map((date) => db.collection(CHECKINS).doc(checkinId(uid, date)))
  const snaps = await db.getAll(...refs)
  return snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data() }) as StaffCheckin)
}

async function listEventsFor(uid: string, month: string): Promise<StaffBoundaryEvent[]> {
  const snap = await getAdminDb()
    .collection(EVENTS)
    .where('monthKey', '==', `${uid}_${month}`)
    .get()
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as StaffBoundaryEvent)
    .sort((a, b) => b.exitAt.localeCompare(a.exitAt))
}

async function listMessagesFor(uid: string): Promise<StaffCheckinMessage[]> {
  const snap = await getAdminDb().collection(MESSAGES).where('uid', '==', uid).get()
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as StaffCheckinMessage)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 100)
}

export async function getSelfBundle(
  session: SessionContext,
  month?: string,
): Promise<CheckinSelfBundle> {
  requirePermission(session, 'checkin.self')
  const today = schoolToday()
  const currentMonth = today.slice(0, 7)
  const target = month && month <= currentMonth ? month : currentMonth
  const dates = datesInMonth(target).filter((d) => d <= today)

  const [settings, records, events, todayEvents, messages, terms, todayRecords] =
    await Promise.all([
      getCheckinSettings(),
      getCheckinsByIds(session.uid, dates),
      listEventsFor(session.uid, target),
      target === currentMonth
        ? Promise.resolve(null)
        : listEventsFor(session.uid, currentMonth),
      listMessagesFor(session.uid),
      listTerms(),
      target === currentMonth ? Promise.resolve(null) : getCheckinsByIds(session.uid, [today]),
    ])

  const todayRecord =
    (todayRecords ?? records).find((r) => r.date === today) ?? null
  return {
    settings,
    today,
    serverTime: new Date().toISOString(),
    month: target,
    todayRecord,
    todayEvents: (todayEvents ?? events).filter((e) => e.date === today),
    records: records.sort((a, b) => b.date.localeCompare(a.date)),
    events,
    messages,
    terms,
  }
}

function positionFields(prefix: 'checkIn' | 'checkOut', pos: CheckinPosition, site: GeofenceSite) {
  const reading = evaluatePosition(site, pos)
  return {
    reading,
    fields: {
      [`${prefix}Latitude`]: pos.latitude,
      [`${prefix}Longitude`]: pos.longitude,
      [`${prefix}Accuracy`]: pos.accuracy ?? null,
      [`${prefix}Distance`]: roundMeters(reading.fromCentre),
      [`${prefix}Inside`]: reading.inside,
    },
  }
}

function impreciseMessage(accuracy: number | null | undefined) {
  return `Your location is only accurate to within ±${formatMeters(accuracy ?? 0)}, which can’t confirm you are on the school premises. Use a phone with location turned on, then try again.`
}

function outsideMessage(action: 'check in' | 'check out', fromBoundary: number) {
  return `You are about ${Math.max(1, Math.round(fromBoundary))} m outside the school boundary. Move onto the school premises to ${action}.`
}

export async function punch(
  session: SessionContext,
  input: CheckinPunch,
): Promise<StaffCheckin> {
  requirePermission(session, 'checkin.self')
  const settings = await getCheckinSettings()
  const site = requireSite(settings)
  const now = new Date()
  const nowIso = now.toISOString()
  const today = schoolToday(now)
  const db = getAdminDb()
  const ref = db.collection(CHECKINS).doc(checkinId(session.uid, today))
  const prefix = input.action === 'CHECK_IN' ? 'checkIn' : 'checkOut'
  const { reading, fields } = positionFields(prefix, input, site)

  if (settings.requireInside && !isPreciseFix(input)) throw badRequest(impreciseMessage(input.accuracy))
  if (settings.requireInside && !reading.inside) {
    throw badRequest(
      outsideMessage(input.action === 'CHECK_IN' ? 'check in' : 'check out', reading.fromBoundary),
    )
  }

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const existing = snap.exists ? ({ id: snap.id, ...snap.data() } as StaffCheckin) : null

    if (input.action === 'CHECK_IN') {
      if (existing) throw conflict('You have already checked in today.')
      const record = {
        id: ref.id,
        ...staffIdentity(session),
        date: today,
        checkInAt: nowIso,
        ...fields,
        late: isLateCheckIn(now, settings.lateAfter),
        openExitId: null,
        exitCount: 0,
        secondsOutside: 0,
        siteName: site.name,
        updatedAt: nowIso,
      } as StaffCheckin
      tx.set(ref, record)
      return record
    }

    if (!existing) throw badRequest('Check in first — there is no check-in for today.')
    if (existing.checkOutAt) throw conflict('You have already checked out today.')

    let secondsOutside = existing.secondsOutside ?? 0
    if (existing.openExitId) {
      const eventRef = db.collection(EVENTS).doc(existing.openExitId)
      const eventSnap = await tx.get(eventRef)
      if (eventSnap.exists) {
        const event = eventSnap.data() as StaffBoundaryEvent
        if (event.status === 'OPEN') {
          const duration = Math.max(0, Math.floor((now.getTime() - Date.parse(event.exitAt)) / 1000))
          secondsOutside += duration
          tx.update(eventRef, {
            status: 'CLOSED',
            returnAt: nowIso,
            durationSeconds: duration,
            closedBy: 'CHECK_OUT',
            updatedAt: nowIso,
          })
        }
      }
    }

    const update = {
      ...fields,
      checkOutAt: nowIso,
      openExitId: null,
      secondsOutside,
      updatedAt: nowIso,
    }
    tx.update(ref, update)
    return { ...existing, ...update } as StaffCheckin
  })
}

async function loadOpenSession(
  tx: Transaction,
  ref: DocumentReference,
): Promise<StaffCheckin> {
  const snap = await tx.get(ref)
  if (!snap.exists) throw badRequest('Check in first to track time off the premises.')
  const record = { id: snap.id, ...snap.data() } as StaffCheckin
  if (record.checkOutAt) throw badRequest('You have already checked out today.')
  return record
}

async function loadOwnEvent(
  tx: Transaction,
  session: SessionContext,
  eventId: string,
): Promise<{ ref: DocumentReference; event: StaffBoundaryEvent }> {
  const ref = getAdminDb().collection(EVENTS).doc(eventId)
  const snap = await tx.get(ref)
  if (!snap.exists) throw notFound('Premises exit not found')
  const event = { id: snap.id, ...snap.data() } as StaffBoundaryEvent
  if (event.uid !== session.uid) throw forbidden()
  return { ref, event }
}

export async function updateBoundary(
  session: SessionContext,
  input: BoundaryUpdate,
): Promise<BoundaryUpdateResult> {
  requirePermission(session, 'checkin.self')
  const settings = await getCheckinSettings()
  const site = requireSite(settings)
  const now = new Date()
  const nowIso = now.toISOString()
  const today = schoolToday(now)
  const db = getAdminDb()
  const checkinRef = db.collection(CHECKINS).doc(checkinId(session.uid, today))

  return db.runTransaction(async (tx) => {
    if (input.action === 'REASON') {
      const { ref, event } = await loadOwnEvent(tx, session, input.eventId)
      const recordSnap = await tx.get(db.collection(CHECKINS).doc(checkinId(session.uid, event.date)))
      const patch = {
        reason: input.reason,
        reasonNote: input.reasonNote || undefined,
        updatedAt: nowIso,
      }
      tx.update(ref, patch)
      return {
        event: { ...event, ...patch },
        record: { id: recordSnap.id, ...recordSnap.data() } as StaffCheckin,
      }
    }

    if (!isPreciseFix(input)) throw badRequest(impreciseMessage(input.accuracy))
    const record = await loadOpenSession(tx, checkinRef)
    const reading = evaluatePosition(site, input)

    if (input.action === 'EXIT') {
      if (record.openExitId) {
        const open = await tx.get(db.collection(EVENTS).doc(record.openExitId))
        if (open.exists && (open.data() as StaffBoundaryEvent).status === 'OPEN') {
          return {
            event: { id: open.id, ...open.data() } as StaffBoundaryEvent,
            record,
          }
        }
      }
      if (reading.inside) throw badRequest('You are still inside the school boundary.')
      const id = newId('exit')
      const event: StaffBoundaryEvent = {
        id,
        uid: session.uid,
        staffId: session.profile.staffId,
        name: session.profile.name,
        department: session.profile.department,
        date: today,
        monthKey: `${session.uid}_${today.slice(0, 7)}`,
        status: 'OPEN',
        exitAt: nowIso,
        latitude: input.latitude,
        longitude: input.longitude,
        distanceFromBoundary: roundMeters(reading.fromBoundary),
        distanceFromCentre: roundMeters(reading.fromCentre),
        maxDistanceFromBoundary: roundMeters(reading.fromBoundary),
        maxDistanceFromCentre: roundMeters(reading.fromCentre),
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      tx.set(db.collection(EVENTS).doc(id), event)
      const recordPatch = {
        openExitId: id,
        exitCount: (record.exitCount ?? 0) + 1,
        updatedAt: nowIso,
      }
      tx.update(checkinRef, recordPatch)
      return { event, record: { ...record, ...recordPatch } }
    }

    const { ref, event } = await loadOwnEvent(tx, session, input.eventId)
    if (event.status !== 'OPEN') return { event, record }

    if (input.action === 'PROGRESS') {
      const patch = {
        latitude: input.latitude,
        longitude: input.longitude,
        distanceFromBoundary: roundMeters(reading.fromBoundary),
        distanceFromCentre: roundMeters(reading.fromCentre),
        maxDistanceFromBoundary: Math.max(event.maxDistanceFromBoundary, roundMeters(reading.fromBoundary)),
        maxDistanceFromCentre: Math.max(event.maxDistanceFromCentre, roundMeters(reading.fromCentre)),
        updatedAt: nowIso,
      }
      tx.update(ref, patch)
      return { event: { ...event, ...patch }, record }
    }

    if (!reading.inside) throw badRequest('You are still outside the school boundary.')
    const duration = Math.max(0, Math.floor((now.getTime() - Date.parse(event.exitAt)) / 1000))
    const patch = {
      status: 'CLOSED' as const,
      returnAt: nowIso,
      durationSeconds: duration,
      closedBy: 'RETURN' as const,
      updatedAt: nowIso,
    }
    tx.update(ref, patch)
    const recordPatch = {
      openExitId: null,
      secondsOutside: (record.secondsOutside ?? 0) + duration,
      updatedAt: nowIso,
    }
    tx.update(checkinRef, recordPatch)
    return { event: { ...event, ...patch }, record: { ...record, ...recordPatch } }
  })
}

export async function createCheckinMessage(
  session: SessionContext,
  input: CheckinMessageInput,
): Promise<StaffCheckinMessage> {
  requirePermission(session, 'checkin.self')
  const nowIso = new Date().toISOString()
  const id = newId('ci_msg')
  const message: StaffCheckinMessage = {
    id,
    uid: session.uid,
    staffId: session.profile.staffId,
    name: session.profile.name,
    role: session.role,
    department: session.profile.department,
    kind: input.kind,
    category: input.category,
    details: input.details.trim(),
    absenceDate: input.kind === 'ABSENCE' ? input.absenceDate : undefined,
    status: 'OPEN',
    createdAt: nowIso,
    updatedAt: nowIso,
  }
  await setDoc(MESSAGES, id, message)
  return message
}

export async function updateCheckinMessage(
  session: SessionContext,
  id: string,
  input: CheckinMessageUpdate,
  requestId?: string,
): Promise<StaffCheckinMessage> {
  requirePermission(session, 'checkin.manage')
  const existing = await getDoc<StaffCheckinMessage>(MESSAGES, id)
  if (!existing) throw notFound('Message not found')
  const nowIso = new Date().toISOString()
  const reply = input.adminReply?.trim()
  const patch: Partial<StaffCheckinMessage> = {
    updatedAt: nowIso,
    ...(input.status ? { status: input.status } : {}),
    ...(reply !== undefined
      ? {
          adminReply: reply,
          repliedAt: nowIso,
          repliedByName: session.profile.name,
          ...(input.status ? {} : existing.status === 'OPEN' ? { status: 'SEEN' as const } : {}),
        }
      : {}),
  }
  await setDoc(MESSAGES, id, patch, true)
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: 'checkin.message_update',
    entityType: MESSAGES,
    entityId: id,
    requestId,
    metadata: { status: patch.status ?? existing.status, replied: reply !== undefined },
  })
  return { ...existing, ...patch }
}

async function listRoster(): Promise<CheckinRosterEntry[]> {
  const db = getAdminDb()
  const [usersSnap, staffSnap] = await Promise.all([
    db.collection('users').where('role', 'in', CHECKIN_ROLES).get(),
    db.collection('staff').get(),
  ])
  const staffById = new Map(staffSnap.docs.map((d) => [d.id, d.data() as Staff]))
  const roster: CheckinRosterEntry[] = []
  for (const doc of usersSnap.docs) {
    const u = doc.data() as {
      name?: string
      email?: string
      role: UserRole
      staffId?: string
      department?: string
      employeeNumber?: string
      disabled?: boolean
    }
    if (u.disabled) continue
    const staff = u.staffId ? staffById.get(u.staffId) : undefined
    if (staff && staff.status === 'INACTIVE') continue
    roster.push({
      uid: doc.id,
      staffId: u.staffId,
      name:
        (staff ? `${staff.firstName} ${staff.lastName}`.trim() : '') ||
        u.name ||
        u.email?.split('@')[0] ||
        'Staff member',
      role: u.role,
      department: staff?.department || u.department,
      employeeNumber: staff?.employeeNumber || u.employeeNumber,
      category: staff?.category,
    })
  }
  return roster.sort((a, b) => a.name.localeCompare(b.name))
}

export async function getAdminBundle(
  session: SessionContext,
  month?: string,
): Promise<CheckinAdminBundle> {
  requirePermission(session, 'checkin.manage')
  const today = schoolToday()
  const currentMonth = today.slice(0, 7)
  const target = month && month <= currentMonth ? month : currentMonth
  const db = getAdminDb()
  const start = `${target}-01`
  const end = `${target}-31`

  const [settings, roster, recordsSnap, eventsSnap, messagesSnap, terms] = await Promise.all([
    getCheckinSettings(),
    listRoster(),
    db.collection(CHECKINS).where('date', '>=', start).where('date', '<=', end).get(),
    db.collection(EVENTS).where('date', '>=', start).where('date', '<=', end).get(),
    db.collection(MESSAGES).orderBy('createdAt', 'desc').limit(300).get(),
    listTerms(),
  ])

  return {
    settings,
    today,
    serverTime: new Date().toISOString(),
    month: target,
    roster,
    records: recordsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as StaffCheckin)
      .sort((a, b) => b.date.localeCompare(a.date) || b.checkInAt.localeCompare(a.checkInAt)),
    events: eventsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }) as StaffBoundaryEvent)
      .sort((a, b) => b.exitAt.localeCompare(a.exitAt)),
    messages: messagesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as StaffCheckinMessage),
    terms,
  }
}
