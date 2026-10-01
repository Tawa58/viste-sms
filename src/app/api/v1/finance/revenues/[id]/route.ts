import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, routeParam, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { deleteRevenue, updateRevenue } from '@/server/services/ledger-service'
import { revenueSchema } from '@/server/validators/hr'

export const PATCH = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = routeParam(await ctx.params, 'id')
  rateLimit(`finance:revenue:update:${session.uid}`, 60, 60_000)
  const parsed = revenueSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid revenue entry', parsed.error.flatten())
  return jsonOk(await updateRevenue(session, id, parsed.data, ctx.requestId))
})

export const DELETE = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = routeParam(await ctx.params, 'id')
  rateLimit(`finance:revenue:delete:${session.uid}`, 30, 60_000)
  await deleteRevenue(session, id, ctx.requestId)
  return jsonOk({ ok: true })
})
