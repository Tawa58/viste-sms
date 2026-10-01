import { requireSession } from '@/server/auth/session'
import { jsonOk, routeParam, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { deleteExpenseCategory } from '@/server/services/ledger-service'

export const DELETE = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = routeParam(await ctx.params, 'id')
  rateLimit(`finance:category:delete:${session.uid}`, 20, 60_000)
  await deleteExpenseCategory(session, id, ctx.requestId)
  return jsonOk({ ok: true })
})
