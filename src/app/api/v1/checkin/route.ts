import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { badRequest } from '@/server/errors'
import { rateLimit } from '@/server/http/rate-limit'
import { checkinPunchSchema, monthParamSchema } from '@/server/validators/checkin'
import { getSelfBundle, punch } from '@/server/services/checkin-service'

/** The signed-in staff member's check-in status, month history, and reports. */
export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  const month = monthParamSchema.safeParse(new URL(request.url).searchParams.get('month') ?? undefined)
  if (!month.success) throw badRequest('Invalid month', month.error.flatten())
  return jsonOk(await getSelfBundle(session, month.data))
})

/** Check in or check out at the school premises. */
export const POST = withApiHandler(async (request) => {
  const session = await requireSession(request)
  rateLimit(`checkin:punch:${session.uid}`, 10, 60_000)
  const parsed = checkinPunchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid check-in', parsed.error.flatten())
  return jsonOk(await punch(session, parsed.data))
})
