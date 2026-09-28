import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { badRequest } from '@/server/errors'
import { rateLimit } from '@/server/http/rate-limit'
import { boundaryUpdateSchema } from '@/server/validators/checkin'
import { updateBoundary } from '@/server/services/checkin-service'

/** Record leaving / returning to the school premises while checked in. */
export const POST = withApiHandler(async (request) => {
  const session = await requireSession(request)
  rateLimit(`checkin:boundary:${session.uid}`, 60, 60_000)
  const parsed = boundaryUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid premises update', parsed.error.flatten())
  return jsonOk(await updateBoundary(session, parsed.data))
})
