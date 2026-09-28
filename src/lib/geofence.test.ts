import { describe, expect, it } from 'vitest'
import {
  evaluatePosition,
  formatDurationClock,
  formatMeters,
  gpsAccuracyAllowance,
  haversineMeters,
  isPreciseFix,
  resolveZone,
  runGeofenceTick,
  type GeofenceSite,
} from '@/lib/geofence'

const site: GeofenceSite = { name: 'School', latitude: -17.8292, longitude: 31.0522, radiusMeters: 100 }

/** Point `metres` due north of the site centre. */
function north(metres: number) {
  return { latitude: site.latitude + metres / 111_195, longitude: site.longitude }
}

describe('geofence', () => {
  it('measures distance with haversine', () => {
    expect(haversineMeters(site, north(250))).toBeCloseTo(250, 0)
  })

  it('caps the GPS accuracy allowance', () => {
    expect(gpsAccuracyAllowance(null)).toBe(0)
    expect(gpsAccuracyAllowance(12)).toBe(12)
    expect(gpsAccuracyAllowance(500)).toBe(40)
  })

  it('counts accuracy in the user’s favour near the boundary', () => {
    expect(evaluatePosition(site, { ...north(120) }).inside).toBe(false)
    expect(evaluatePosition(site, { ...north(120), accuracy: 30 }).inside).toBe(true)
    expect(evaluatePosition(site, north(160)).fromBoundary).toBeCloseTo(60, 0)
  })

  it('uses hysteresis around the boundary', () => {
    expect(resolveZone('inside', 105, 100)).toBe('inside')
    expect(resolveZone('inside', 110, 100)).toBe('outside')
    expect(resolveZone('outside', 98, 100)).toBe('outside')
    expect(resolveZone('outside', 95, 100)).toBe('inside')
  })

  it('reports exit, progress and return', () => {
    const exit = runGeofenceTick({ zone: 'inside', site, fix: north(150), openExit: null })
    expect(exit.kind).toBe('exit')
    const open = { maxDistanceFromCentre: 150, maxDistanceFromBoundary: 50 }
    expect(runGeofenceTick({ zone: 'outside', site, fix: north(155), openExit: open }).kind).toBe(
      'idle',
    )
    const progress = runGeofenceTick({ zone: 'outside', site, fix: north(200), openExit: open })
    expect(progress.kind).toBe('progress')
    expect(progress.maxDistanceFromBoundary).toBeCloseTo(100, 0)
    expect(runGeofenceTick({ zone: 'outside', site, fix: north(20), openExit: open }).kind).toBe(
      'return',
    )
  })

  it('ignores fixes too vague to place someone on or off the premises', () => {
    expect(isPreciseFix({ ...north(0), accuracy: 60 })).toBe(true)
    expect(isPreciseFix({ ...north(0), accuracy: null })).toBe(true)
    expect(isPreciseFix({ ...north(0), accuracy: 20_000 })).toBe(false)
    const vague = runGeofenceTick({
      zone: 'inside',
      site,
      fix: { ...north(1200), accuracy: 20_000 },
      openExit: null,
    })
    expect(vague).toMatchObject({ kind: 'idle', nextZone: 'inside', imprecise: true })
  })

  it('formats durations and distances', () => {
    expect(formatDurationClock(3725)).toBe('01:02:05')
    expect(formatMeters(42.4)).toBe('42 m')
    expect(formatMeters(1530)).toBe('1.5 km')
  })
})
