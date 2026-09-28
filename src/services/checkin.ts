import { apiFetch } from '@/services/api/http-client'
import { mockRequest, USE_MOCK_API } from '@/services/api/client'
import { DEFAULT_CHECKIN_SETTINGS, currentMonth, isLateCheckIn, schoolDate, siteFromSettings } from '@/lib/checkin'
import { evaluatePosition, roundMeters } from '@/lib/geofence'
import type {
  BoundaryUpdateInput,
  BoundaryUpdateResult,
  CheckinAdminBundle,
  CheckinMessageInput,
  CheckinMessageUpdate,
  CheckinPunchInput,
  CheckinSelfBundle,
  CheckinSettings,
  CheckinSettingsInput,
  StaffBoundaryEvent,
  StaffCheckin,
  StaffCheckinMessage,
} from '@/types'

export type CheckinService = {
  getMine(month?: string): Promise<CheckinSelfBundle>
  punch(input: CheckinPunchInput): Promise<StaffCheckin>
  updateBoundary(input: BoundaryUpdateInput): Promise<BoundaryUpdateResult>
  sendMessage(input: CheckinMessageInput): Promise<StaffCheckinMessage>
  getAdmin(month?: string): Promise<CheckinAdminBundle>
  updateMessage(id: string, input: CheckinMessageUpdate): Promise<StaffCheckinMessage>
  updateSettings(input: CheckinSettingsInput): Promise<CheckinSettings>
}

function monthQuery(month?: string) {
  return month ? `?month=${encodeURIComponent(month)}` : ''
}

const apiCheckinService: CheckinService = {
  getMine: (month) =>
    apiFetch<CheckinSelfBundle>(`/api/v1/checkin${monthQuery(month)}`, { skipCache: true }),
  punch: (input) =>
    apiFetch<StaffCheckin>('/api/v1/checkin', { method: 'POST', body: JSON.stringify(input) }),
  updateBoundary: (input) =>
    apiFetch<BoundaryUpdateResult>('/api/v1/checkin/boundary', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  sendMessage: (input) =>
    apiFetch<StaffCheckinMessage>('/api/v1/checkin/messages', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getAdmin: (month) =>
    apiFetch<CheckinAdminBundle>(`/api/v1/checkin/admin${monthQuery(month)}`, {
      skipCache: true,
    }),
  updateMessage: (id, input) =>
    apiFetch<StaffCheckinMessage>(`/api/v1/checkin/messages/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  updateSettings: (input) =>
    apiFetch<CheckinSettings>('/api/v1/checkin/settings', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
}

/** Demo mode: an in-memory school on the Harare CBD so the pages can be explored offline. */
const mock = {
  settings: {
    ...DEFAULT_CHECKIN_SETTINGS,
    siteName: 'Viste High School (demo)',
    latitude: -17.8292,
    longitude: 31.0522,
    requireInside: false,
  } as CheckinSettings,
  records: [] as StaffCheckin[],
  events: [] as StaffBoundaryEvent[],
  messages: [] as StaffCheckinMessage[],
}
const MOCK_UID = 'demo-user'

function mockToday() {
  return schoolDate()
}

const mockCheckinService: CheckinService = {
  getMine: async (month) => {
    const today = mockToday()
    const target = month ?? currentMonth()
    return mockRequest({
      settings: mock.settings,
      today,
      serverTime: new Date().toISOString(),
      month: target,
      todayRecord: mock.records.find((r) => r.date === today) ?? null,
      todayEvents: mock.events.filter((e) => e.date === today),
      records: mock.records.filter((r) => r.date.startsWith(target)),
      events: mock.events.filter((e) => e.date.startsWith(target)),
      messages: mock.messages,
      terms: [],
    })
  },
  punch: async (input) => {
    const site = siteFromSettings(mock.settings)!
    const reading = evaluatePosition(site, input)
    const now = new Date()
    const today = mockToday()
    const existing = mock.records.find((r) => r.date === today)
    if (input.action === 'CHECK_IN') {
      if (existing) throw new Error('You have already checked in today.')
      const record: StaffCheckin = {
        id: `${MOCK_UID}_${today}`,
        uid: MOCK_UID,
        name: 'Demo teacher',
        role: 'TEACHER',
        date: today,
        checkInAt: now.toISOString(),
        checkInLatitude: input.latitude,
        checkInLongitude: input.longitude,
        checkInAccuracy: input.accuracy ?? null,
        checkInDistance: roundMeters(reading.fromCentre),
        checkInInside: reading.inside,
        late: isLateCheckIn(now, mock.settings.lateAfter),
        openExitId: null,
        exitCount: 0,
        secondsOutside: 0,
        siteName: site.name,
        updatedAt: now.toISOString(),
      }
      mock.records.unshift(record)
      return mockRequest(record)
    }
    if (!existing) throw new Error('Check in first — there is no check-in for today.')
    Object.assign(existing, {
      checkOutAt: now.toISOString(),
      checkOutLatitude: input.latitude,
      checkOutLongitude: input.longitude,
      checkOutAccuracy: input.accuracy ?? null,
      checkOutDistance: roundMeters(reading.fromCentre),
      checkOutInside: reading.inside,
      openExitId: null,
      updatedAt: now.toISOString(),
    })
    return mockRequest({ ...existing })
  },
  updateBoundary: async (input) => {
    const today = mockToday()
    const record = mock.records.find((r) => r.date === today)
    if (!record) throw new Error('Check in first to track time off the premises.')
    const nowIso = new Date().toISOString()
    if (input.action === 'EXIT') {
      const site = siteFromSettings(mock.settings)!
      const reading = evaluatePosition(site, input)
      const event: StaffBoundaryEvent = {
        id: `exit_${Date.now()}`,
        uid: MOCK_UID,
        name: record.name,
        date: today,
        monthKey: `${MOCK_UID}_${today.slice(0, 7)}`,
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
      mock.events.unshift(event)
      record.openExitId = event.id
      record.exitCount += 1
      return mockRequest({ event, record: { ...record } })
    }
    const event = mock.events.find((e) => e.id === input.eventId)
    if (!event) throw new Error('Premises exit not found')
    if (input.action === 'REASON') {
      Object.assign(event, { reason: input.reason, reasonNote: input.reasonNote, updatedAt: nowIso })
    } else if (input.action === 'RETURN') {
      const duration = Math.floor((Date.now() - Date.parse(event.exitAt)) / 1000)
      Object.assign(event, {
        status: 'CLOSED',
        returnAt: nowIso,
        durationSeconds: duration,
        closedBy: 'RETURN',
        updatedAt: nowIso,
      })
      record.openExitId = null
      record.secondsOutside += duration
    }
    return mockRequest({ event: { ...event }, record: { ...record } })
  },
  sendMessage: async (input) => {
    const nowIso = new Date().toISOString()
    const message: StaffCheckinMessage = {
      id: `msg_${Date.now()}`,
      uid: MOCK_UID,
      name: 'Demo teacher',
      role: 'TEACHER',
      ...input,
      status: 'OPEN',
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    mock.messages.unshift(message)
    return mockRequest(message)
  },
  getAdmin: async (month) => {
    const target = month ?? currentMonth()
    return mockRequest({
      settings: mock.settings,
      today: mockToday(),
      serverTime: new Date().toISOString(),
      month: target,
      roster: [{ uid: MOCK_UID, name: 'Demo teacher', role: 'TEACHER' as const }],
      records: mock.records.filter((r) => r.date.startsWith(target)),
      events: mock.events.filter((e) => e.date.startsWith(target)),
      messages: mock.messages,
      terms: [],
    })
  },
  updateMessage: async (id, input) => {
    const message = mock.messages.find((m) => m.id === id)
    if (!message) throw new Error('Message not found')
    Object.assign(message, input, { updatedAt: new Date().toISOString() })
    return mockRequest({ ...message })
  },
  updateSettings: async (input) => {
    mock.settings = { ...mock.settings, ...input }
    return mockRequest(mock.settings)
  },
}

export const checkinService: CheckinService = USE_MOCK_API ? mockCheckinService : apiCheckinService
