import { requireSession } from '@/server/auth/session'
import { sessionPermissions } from '@/server/authorization/permissions'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'

export const GET = withApiHandler(async (request, { requestId }) => {
  rateLimit(`me:${request.headers.get('x-forwarded-for') ?? 'local'}`, 60, 60_000)
  let authStage: string = 'AUTH TOKEN MISSING'
  try {
    const session = await requireSession(request, (stage) => {
      authStage = stage
    })
    return jsonOk({
      user: session.profile,
      permissions: sessionPermissions(session),
      requestId,
    })
  } catch (err) {
    const errorName = err instanceof Error ? err.name : typeof err
    console.error('[auth/me] session resolution failed', {
      requestId,
      stage: authStage,
      errorName,
    })
    if (err && typeof err === 'object' && Object.isExtensible(err)) {
      Object.defineProperty(err, 'authStage', { value: authStage, configurable: true })
    }
    throw err
  }
}, { requireAdmin: false })
