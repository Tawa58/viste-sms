import { isAndroidApp, isDesktopApp } from '@/lib/native-app'

export type LocationFix = {
  latitude: number
  longitude: number
  accuracy: number | null
}

export type LocationFailure = 'permission_denied' | 'position_unavailable' | 'timeout' | 'unsupported'

export type LocationResult =
  | { ok: true; fix: LocationFix }
  | { ok: false; reason: LocationFailure; message: string }

const FIX_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 }
const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 20_000, maximumAge: 3_000 }

const WINDOWS_LOCATION_HELP =
  'Turn on Location in Windows Settings → Privacy & security → Location (including “Let desktop apps access your location”), then try again.'

function deniedMessage() {
  if (isAndroidApp()) {
    return 'Location is blocked for Viste SMS. Allow location in Android Settings → Apps → Viste SMS → Permissions, then try again. If there is no location option, install the latest app from the Viste SMS download page.'
  }
  if (isDesktopApp()) {
    return `Location is blocked. ${WINDOWS_LOCATION_HELP} If it still fails, update Viste SMS from Help → Check for updates and restart the app.`
  }
  return 'Location permission was denied. Allow location for this site in your browser settings, then try again.'
}

function unavailableMessage() {
  return isDesktopApp()
    ? `Windows could not find this computer’s location. ${WINDOWS_LOCATION_HELP}`
    : 'GPS is unavailable. Turn on location services and try again.'
}

/** Shown when a fix is too vague to tell whether someone is on the school premises. */
export function impreciseLocationMessage(accuracyText: string) {
  return isDesktopApp()
    ? `This computer can only place itself within ${accuracyText}, which can’t confirm you are at school. Connect to Wi-Fi and turn on Windows location, or check in from your phone.`
    : `Your location is only accurate to within ${accuracyText}. Turn on precise location, move near a window or outside, then tap Refresh.`
}

function fromError(error: GeolocationPositionError): LocationResult {
  if (error.code === error.PERMISSION_DENIED) {
    return { ok: false, reason: 'permission_denied', message: deniedMessage() }
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return {
      ok: false,
      reason: 'position_unavailable',
      message: unavailableMessage(),
    }
  }
  if (error.code === error.TIMEOUT) {
    return {
      ok: false,
      reason: 'timeout',
      message: 'GPS timed out. Move to an open area and try again.',
    }
  }
  return {
    ok: false,
    reason: 'position_unavailable',
    message: error.message || 'Unable to get your GPS location.',
  }
}

function fromPosition(position: GeolocationPosition): LocationResult {
  const { latitude, longitude, accuracy } = position.coords
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return {
      ok: false,
      reason: 'position_unavailable',
      message: 'GPS coordinates could not be verified.',
    }
  }
  return {
    ok: true,
    fix: { latitude, longitude, accuracy: Number.isFinite(accuracy) ? accuracy : null },
  }
}

const UNSUPPORTED: LocationResult = {
  ok: false,
  reason: 'unsupported',
  message: 'This device or browser does not support GPS location.',
}

function supported() {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

export function getCurrentLocation(): Promise<LocationResult> {
  if (!supported()) return Promise.resolve(UNSUPPORTED)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(fromPosition(position)),
      (error) => resolve(fromError(error)),
      FIX_OPTIONS,
    )
  })
}

/** Stream GPS fixes until the returned function is called. */
export function watchLocation(onUpdate: (result: LocationResult) => void): () => void {
  if (!supported()) {
    onUpdate(UNSUPPORTED)
    return () => undefined
  }
  const id = navigator.geolocation.watchPosition(
    (position) => onUpdate(fromPosition(position)),
    (error) => onUpdate(fromError(error)),
    WATCH_OPTIONS,
  )
  return () => navigator.geolocation.clearWatch(id)
}
