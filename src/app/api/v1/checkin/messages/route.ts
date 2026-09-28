import { requireSession } from '@/server/auth/session'
import { jsonCreated, withApiHandler } from '@/server/http/handler'
import { badRequest } from '@/server/errors'
import { rateLimit } from '@/server/http/rate-limit'
import { checkinMessageSchema } from '@/server/validators/checkin'
import { createCheckinMessage } from '@/server/services/checkin-service'

/** Staff absence notice or check-in problem report to the administrators. */
export const POST = withApiHandler(async (request) => {
  const session = await requireSession(request)
  rateLimit(`checkin:message:${session.uid}`, 10, 60_000)
  const parsed = checkinMessageSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid report', parsed.error.flatten())
  return jsonCreated(await createCheckinMessage(session, parsed.data))
})
