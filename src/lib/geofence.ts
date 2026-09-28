/**
 * School geofence maths, shared by the check-in page (live monitoring) and the
 * API (server-side verification). Ported from Checkin 360.
 */

export type GeoPoint = { latitude: number; longitude: number }

export type GeoFix = GeoPoint & { accuracy?: number | null }

export type GeofenceSite = GeoPoint & {
  name: string
  radiusMeters: number
}

export type PremisesZone = 'inside' | 'outside'

export type GeofenceReading = {
  inside: boolean
  fromCentre: number
  fromBoundary: number
}

export type GeofenceTick = {
  kind: 'idle' | 'exit' | 'return' | 'progress'
  nextZone: PremisesZone
  reading: GeofenceReading
  maxDistanceFromCentre?: number
  maxDistanceFromBoundary?: number
}

const EARTH_RADIUS_M = 6_371_000
const EXIT_BUFFER_M = 8
const ENTER_BUFFER_M = 4
const PROGRESS_STEP_M = 10
/** GPS accuracy counted in the user's favour is capped so a vague fix can't stretch the fence. */
const MAX_ACCURACY_ALLOWANCE_M = 40

export const MIN_GEOFENCE_RADIUS_M = 10
export const MAX_GEOFENCE_RADIUS_M = 5000

export function haversineMeters(from: GeoPoint, to: GeoPoint): number {
  const lat1 = (from.latitude * Math.PI) / 180
  const lat2 = (to.latitude * Math.PI) / 180
  const dLat = lat2 - lat1
  const dLng = ((to.longitude - from.longitude) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function gpsAccuracyAllowance(accuracy: number | null | undefined): number {
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy <= 0) return 0
  return Math.min(accuracy, MAX_ACCURACY_ALLOWANCE_M)
}

export function evaluatePosition(site: GeofenceSite, fix: GeoFix): GeofenceReading {
  const fromCentre = haversineMeters(site, fix)
  const radius = site.radiusMeters + gpsAccuracyAllowance(fix.accuracy)
  return {
    inside: fromCentre <= radius,
    fromCentre,
    fromBoundary: Math.max(0, fromCentre - site.radiusMeters),
  }
}

/** Zone with hysteresis so GPS jitter on the boundary doesn't flip in and out. */
export function resolveZone(
  current: PremisesZone | null,
  fromCentre: number,
  radiusMeters: number,
): PremisesZone {
  if (current === null) return fromCentre <= radiusMeters ? 'inside' : 'outside'
  if (current === 'inside') {
    return fromCentre > radiusMeters + EXIT_BUFFER_M ? 'outside' : 'inside'
  }
  return fromCentre <= Math.max(0, radiusMeters - ENTER_BUFFER_M) ? 'inside' : 'outside'
}

export function runGeofenceTick(input: {
  zone: PremisesZone | null
  site: GeofenceSite
  fix: GeoFix
  openExit: { maxDistanceFromCentre: number; maxDistanceFromBoundary: number } | null
}): GeofenceTick {
  const reading = evaluatePosition(input.site, input.fix)
  const nextZone = resolveZone(
    input.zone,
    reading.fromCentre,
    input.site.radiusMeters + gpsAccuracyAllowance(input.fix.accuracy),
  )

  if (!input.openExit && nextZone === 'outside') return { kind: 'exit', nextZone, reading }
  if (input.openExit && nextZone === 'inside') return { kind: 'return', nextZone, reading }
  if (input.openExit && nextZone === 'outside') {
    const maxDistanceFromCentre = Math.max(input.openExit.maxDistanceFromCentre, reading.fromCentre)
    const maxDistanceFromBoundary = Math.max(
      input.openExit.maxDistanceFromBoundary,
      reading.fromBoundary,
    )
    const grew = maxDistanceFromCentre >= input.openExit.maxDistanceFromCentre + PROGRESS_STEP_M
    return {
      kind: grew ? 'progress' : 'idle',
      nextZone,
      reading,
      maxDistanceFromCentre,
      maxDistanceFromBoundary,
    }
  }
  return { kind: 'idle', nextZone, reading }
}

export function isValidCoordinate(point: Partial<GeoPoint> | null | undefined): point is GeoPoint {
  return (
    !!point &&
    typeof point.latitude === 'number' &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  )
}

export function roundMeters(value: number): number {
  return Math.round(value * 10) / 10
}

export function elapsedSeconds(fromIso: string, to: Date | number = Date.now()): number {
  const started = Date.parse(fromIso)
  if (!Number.isFinite(started)) return 0
  const end = typeof to === 'number' ? to : to.getTime()
  return Math.max(0, Math.floor((end - started) / 1000))
}

export function formatMeters(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)} km`
  return `${Math.round(value)} m`
}

export function formatDurationClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join(':')
}

export function formatDurationHuman(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
  if (minutes > 0) return `${minutes} min ${secs} sec`
  return `${secs} sec`
}

export function formatDurationShort(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${total}s`
}
