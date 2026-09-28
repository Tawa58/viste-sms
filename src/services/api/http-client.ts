import { getFirebaseAuth } from '@/services/firebase/app'

export class ApiClientError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Duck-typed check — `instanceof` can fail across webpack chunks. */
export function isApiClientError(err: unknown): err is ApiClientError {
  if (err instanceof ApiClientError) return true
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; status?: unknown; code?: unknown }
  return (
    e.name === 'ApiClientError' ||
    (typeof e.status === 'number' && typeof e.code === 'string')
  )
}

export function isForbiddenOrUnauthorized(err: unknown): boolean {
  if (isApiClientError(err) && (err.status === 403 || err.status === 401)) return true
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : err && typeof err === 'object' && 'message' in err
          ? String((err as { message: unknown }).message)
          : ''
  return (
    msg.includes('Missing permission') ||
    msg.includes('Insufficient permissions') ||
    msg.includes('FORBIDDEN')
  )
}

let tokenPromise: Promise<string> | null = null
let tokenCached: { at: number; token: string } | null = null

async function getIdToken(): Promise<string> {
  const user = getFirebaseAuth().currentUser
  if (!user || user.isAnonymous) {
    throw new ApiClientError(401, 'UNAUTHORIZED', 'Not signed in')
  }
  const now = Date.now()
  if (tokenCached && now - tokenCached.at < 50_000) return tokenCached.token
  if (!tokenPromise) {
    tokenPromise = user
      .getIdToken()
      .then((token) => {
        tokenCached = { at: Date.now(), token }
        return token
      })
      .finally(() => {
        tokenPromise = null
      })
  }
  return tokenPromise
}

export function clearAuthTokenCache() {
  tokenCached = null
  tokenPromise = null
}

/** Coalesce identical in-flight GETs and cache briefly to avoid N× same API hits. */
const inflight = new Map<string, Promise<unknown>>()
const cache = new Map<string, { at: number; data: unknown }>()
const DEFAULT_TTL_MS = 30_000

export function invalidateApiCache(prefix?: string) {
  if (!prefix) {
    cache.clear()
    inflight.clear()
    return
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix) || key.includes(prefix)) cache.delete(key)
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(prefix) || key.includes(prefix)) inflight.delete(key)
  }
}

export function seedApiCache(cacheKey: string, data: unknown, ttlMs = DEFAULT_TTL_MS) {
  void ttlMs
  cache.set(cacheKey, { at: Date.now(), data })
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { cacheTtlMs?: number; skipCache?: boolean },
): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const url = path.startsWith('/') ? path : `/api/v1/${path}`
  const cacheKey = `${method}:${url}`
  const ttl = init?.cacheTtlMs ?? DEFAULT_TTL_MS
  const skipCache = Boolean(init?.skipCache) || method !== 'GET'

  if (!skipCache) {
    const hit = cache.get(cacheKey)
    if (hit && Date.now() - hit.at < ttl) return hit.data as T
    const pending = inflight.get(cacheKey)
    if (pending) return pending as Promise<T>
  }

  const run = (async () => {
    const token = await getIdToken()
    const { cacheTtlMs: _ttl, skipCache: _skip, ...rest } = init ?? {}
    const res = await fetch(url, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(rest.headers ?? {}),
      },
    })

    const payload = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Teachers (and similar roles) lack directory list permissions. Soft-resolve
      // so callers never see Uncaught ApiClientError for catalog hydrators.
      const pathOnly = url.split('?')[0]
      if (
        method === 'GET' &&
        (res.status === 403 || res.status === 401) &&
        (pathOnly === '/api/v1/teachers' || pathOnly === '/api/v1/parents')
      ) {
        const empty = [] as unknown as T
        if (!skipCache) cache.set(cacheKey, { at: Date.now(), data: empty })
        return empty
      }
      throw new ApiClientError(
        res.status,
        payload?.error?.code ?? 'ERROR',
        payload?.error?.message ?? res.statusText,
        payload?.error?.details,
      )
    }
    const data = (payload.data ?? payload) as T
    if (!skipCache) cache.set(cacheKey, { at: Date.now(), data })
    return data
  })()

  if (!skipCache) {
    inflight.set(cacheKey, run)
    // Mark rejection handled so soft-fail callers don't trip "Uncaught (in promise)"
    // while other awaiters still receive the rejection.
    void run.catch(() => undefined)
    run.finally(() => inflight.delete(cacheKey))
  }

  if (method !== 'GET') {
    clearAuthTokenCache()
    if (url.includes('/students')) {
      invalidateApiCache('/api/v1/students')
      invalidateApiCache('/api/v1/invoices')
    }
    if (url.includes('/teachers')) invalidateApiCache('/api/v1/teachers')
    if (url.includes('/parents')) invalidateApiCache('/api/v1/parents')
    if (url.includes('/attendance')) invalidateApiCache('/api/v1/attendance')
    if (url.includes('/payments') || url.includes('/invoices')) {
      invalidateApiCache('/api/v1/payments')
      invalidateApiCache('/api/v1/invoices')
    }
    if (url.includes('/results')) invalidateApiCache('/api/v1/results')
    if (url.includes('/announcements')) invalidateApiCache('/api/v1/announcements')
    invalidateApiCache('/api/v1/catalog')
    invalidateApiCache('/api/v1/dashboard')
    invalidateApiCache('/api/v1/bootstrap')
  }

  return run
}
