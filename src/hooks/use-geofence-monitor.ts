import { useCallback, useEffect, useRef, useState } from 'react'
import {
  elapsedSeconds,
  runGeofenceTick,
  type GeofenceReading,
  type GeofenceSite,
  type PremisesZone,
} from '@/lib/geofence'
import { getCurrentLocation, watchLocation, type LocationFix, type LocationResult } from '@/lib/location'
import { checkinService } from '@/services/checkin'
import type { StaffBoundaryEvent, StaffCheckin } from '@/types'

const RECENT_FIX_MS = 60_000

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * Live GPS + geofence for the check-in page. While the staff member is checked in
 * (`tracking`), leaving and re-entering the school boundary is saved as premises exits.
 */
export function useGeofenceMonitor(opts: {
  site: GeofenceSite | null
  tracking: boolean
  initialEvents: StaffBoundaryEvent[]
  onRecord: (record: StaffCheckin) => void
}) {
  const { site, tracking, initialEvents, onRecord } = opts
  const [gps, setGps] = useState<LocationResult | null>(null)
  const [gpsLoading, setGpsLoading] = useState(true)
  const [reading, setReading] = useState<GeofenceReading | null>(null)
  const [zone, setZone] = useState<PremisesZone | null>(null)
  const [events, setEvents] = useState<StaffBoundaryEvent[]>(initialEvents)
  const [syncError, setSyncError] = useState('')
  const [reasonSaving, setReasonSaving] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const openEvent = events.find((e) => e.status === 'OPEN') ?? null
  const lastClosed = events.find((e) => e.status === 'CLOSED') ?? null

  const siteRef = useRef(site)
  const trackingRef = useRef(tracking)
  const zoneRef = useRef(zone)
  const openRef = useRef(openEvent)
  const onRecordRef = useRef(onRecord)
  const busyRef = useRef(false)
  siteRef.current = site
  trackingRef.current = tracking
  zoneRef.current = zone
  openRef.current = openEvent
  onRecordRef.current = onRecord

  useEffect(() => {
    setEvents(initialEvents)
    if (initialEvents.some((e) => e.status === 'OPEN')) setZone('outside')
  }, [initialEvents])

  const upsert = useCallback((event: StaffBoundaryEvent) => {
    setEvents((prev) => [event, ...prev.filter((e) => e.id !== event.id)].sort((a, b) => b.exitAt.localeCompare(a.exitAt)))
  }, [])

  const applyFix = useCallback(
    async (fix: LocationFix) => {
      const currentSite = siteRef.current
      if (!currentSite || busyRef.current) return
      const tick = runGeofenceTick({
        zone: zoneRef.current,
        site: currentSite,
        fix,
        openExit: openRef.current,
      })
      setReading(tick.reading)
      setZone(tick.nextZone)
      if (!trackingRef.current || tick.kind === 'idle') return

      busyRef.current = true
      try {
        const position = { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy }
        const open = openRef.current
        const result =
          tick.kind === 'exit'
            ? await checkinService.updateBoundary({ action: 'EXIT', ...position })
            : open
              ? await checkinService.updateBoundary({
                  action: tick.kind === 'return' ? 'RETURN' : 'PROGRESS',
                  eventId: open.id,
                  ...position,
                })
              : null
        if (result) {
          upsert(result.event)
          onRecordRef.current(result.record)
        }
        setSyncError('')
      } catch (err) {
        setSyncError(errorMessage(err, 'Could not save the premises update.'))
      } finally {
        busyRef.current = false
      }
    },
    [upsert],
  )

  const lastFixRef = useRef<{ fix: LocationFix; at: number } | null>(null)

  const handleResult = useCallback(
    (result: LocationResult) => {
      if (result.ok) lastFixRef.current = { fix: result.fix, at: Date.now() }
      // A failed one-off read shouldn't hide a fix the live watch still has.
      if (!result.ok && lastFixRef.current && Date.now() - lastFixRef.current.at < RECENT_FIX_MS) {
        setGpsLoading(false)
        return
      }
      setGps(result)
      setGpsLoading(false)
      if (result.ok) void applyFix(result.fix)
    },
    [applyFix],
  )

  /** Fresh GPS fix, or the live watch's fix from the last minute if a fresh one fails. */
  const refresh = useCallback(async (): Promise<LocationResult> => {
    setGpsLoading(true)
    const result = await getCurrentLocation()
    handleResult(result)
    const recent = lastFixRef.current
    if (!result.ok && recent && Date.now() - recent.at < RECENT_FIX_MS) {
      return { ok: true, fix: recent.fix }
    }
    return result
  }, [handleResult])

  useEffect(() => watchLocation(handleResult), [handleResult])

  useEffect(() => {
    if (!openEvent) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [openEvent])

  const submitReason = useCallback(
    async (eventId: string, reason: string, reasonNote?: string) => {
      setReasonSaving(true)
      try {
        const result = await checkinService.updateBoundary({
          action: 'REASON',
          eventId,
          reason,
          reasonNote,
        })
        upsert(result.event)
      } finally {
        setReasonSaving(false)
      }
    },
    [upsert],
  )

  return {
    gps,
    gpsLoading,
    fix: gps?.ok ? gps.fix : null,
    reading,
    zone,
    events,
    openEvent,
    lastClosed,
    secondsOutside: openEvent ? elapsedSeconds(openEvent.exitAt, nowMs) : 0,
    syncError,
    reasonSaving,
    refresh,
    submitReason,
  }
}
