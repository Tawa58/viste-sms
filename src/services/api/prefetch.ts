import { apiFetch, invalidateApiCache, seedApiCache } from '@/services/api/http-client'

type BootstrapPayload = {
  catalog?: {
    years: unknown[]
    terms: unknown[]
    classes: unknown[]
    streams: unknown[]
    subjects: unknown[]
  } | null
  students?: unknown[] | null
  staff?: unknown[] | null
  guardians?: unknown[] | null
  attendance?: unknown[] | null
  invoices?: unknown[] | null
  payments?: unknown[] | null
  announcements?: unknown[] | null
  dashboard?: unknown | null
}

function seedFromBootstrap(data: BootstrapPayload) {
  if (data.catalog) seedApiCache('GET:/api/v1/catalog', data.catalog)
  if (data.students) seedApiCache('GET:/api/v1/students', data.students)
  if (data.staff) seedApiCache('GET:/api/v1/teachers', data.staff)
  if (data.guardians) seedApiCache('GET:/api/v1/parents', data.guardians)
  if (data.attendance) seedApiCache('GET:/api/v1/attendance', data.attendance)
  if (data.invoices) seedApiCache('GET:/api/v1/invoices', data.invoices)
  if (data.payments) seedApiCache('GET:/api/v1/payments', data.payments)
  if (data.announcements) seedApiCache('GET:/api/v1/announcements', data.announcements)
  if (data.dashboard) seedApiCache('GET:/api/v1/dashboard', data.dashboard)
}

function runIdle(fn: () => void) {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(() => fn(), { timeout: 4000 })
  } else {
    setTimeout(fn, 1200)
  }
}

/** Critical warm-up only — does not block login/first paint with every collection. */
export async function prefetchCriticalSchoolData(): Promise<void> {
  try {
    const data = await apiFetch<BootstrapPayload>('/api/v1/bootstrap?scope=critical', {
      cacheTtlMs: 30_000,
    })
    seedFromBootstrap(data)
  } catch (err) {
    console.warn('[prefetch] critical bootstrap failed', err)
  }
}

/** Heavier lists after the UI is interactive. */
export async function prefetchRestSchoolData(): Promise<void> {
  try {
    const data = await apiFetch<BootstrapPayload>('/api/v1/bootstrap?scope=rest', {
      cacheTtlMs: 30_000,
    })
    seedFromBootstrap(data)
  } catch (err) {
    console.warn('[prefetch] rest bootstrap failed', err)
  }
}

/**
 * Warm catalog + announcements only. Dashboard and full collection dumps
 * were burning Firestore quota on every login.
 */
export function prefetchSchoolData(): void {
  void prefetchCriticalSchoolData()
}

export function clearSchoolDataCache() {
  invalidateApiCache()
}
