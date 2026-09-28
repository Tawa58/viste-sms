import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { badRequest } from '@/server/errors'
import { rateLimit } from '@/server/http/rate-limit'
import { idSchema } from '@/server/validators/common'
import { checkinMessageUpdateSchema } from '@/server/validators/checkin'
import { updateCheckinMessage } from '@/server/services/checkin-service'

/** Administrator reply / status change on a staff report. */
export const PATCH = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  rateLimit(`checkin:message-update:${session.uid}`, 60, 60_000)
  const id = idSchema.safeParse((await ctx.params).id)
  if (!id.success) throw badRequest('Invalid message id')
  const parsed = checkinMessageUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid update', parsed.error.flatten())
  return jsonOk(await updateCheckinMessage(session, id.data, parsed.data, ctx.requestId))
})
