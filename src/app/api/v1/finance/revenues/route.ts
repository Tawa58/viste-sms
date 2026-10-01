import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { createRevenue, listRevenues } from '@/server/services/ledger-service'
import { ledgerRangeSchema, revenueSchema } from '@/server/validators/hr'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  const params = new URL(request.url).searchParams
  const parsed = ledgerRangeSchema.safeParse({ from: params.get('from'), to: params.get('to') })
  if (!parsed.success) throw badRequest('Choose a valid date range', parsed.error.flatten())
  return jsonOk(await listRevenues(session, parsed.data))
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`finance:revenue:create:${session.uid}`, 60, 60_000)
  const parsed = revenueSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid revenue entry', parsed.error.flatten())
  return jsonOk(await createRevenue(session, parsed.data, requestId), { status: 201 })
})
