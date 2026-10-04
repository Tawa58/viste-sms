import { requireSession } from '@/server/auth/session'
import { sessionPermissions } from '@/server/authorization/permissions'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'

export const GET = withApiHandler(async (request, { requestId }) => {
  rateLimit(`me:${request.headers.get('x-forwarded-for') ?? 'local'}`, 60, 60_000)
  const session = await requireSession(request)
  return jsonOk({
    user: session.profile,
    permissions: sessionPermissions(session),
    requestId,
  })
}, { requireAdmin: false })
