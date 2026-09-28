import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { badRequest } from '@/server/errors'
import { rateLimit } from '@/server/http/rate-limit'
import { checkinSettingsSchema } from '@/server/validators/checkin'
import { updateCheckinSettings } from '@/server/services/checkin-service'

/** School location (geofence) and check-in rules. */
export const PUT = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  rateLimit(`checkin:settings:${session.uid}`, 20, 60_000)
  const parsed = checkinSettingsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid check-in settings', parsed.error.flatten())
  return jsonOk(await updateCheckinSettings(session, parsed.data, ctx.requestId))
})
