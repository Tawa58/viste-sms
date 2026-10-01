import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, routeParam, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { deleteExpense, updateExpense } from '@/server/services/ledger-service'
import { expenseSchema } from '@/server/validators/hr'

export const PATCH = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = routeParam(await ctx.params, 'id')
  rateLimit(`finance:expense:update:${session.uid}`, 60, 60_000)
  const parsed = expenseSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid expense', parsed.error.flatten())
  return jsonOk(await updateExpense(session, id, parsed.data, ctx.requestId))
})

export const DELETE = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = routeParam(await ctx.params, 'id')
  rateLimit(`finance:expense:delete:${session.uid}`, 30, 60_000)
  await deleteExpense(session, id, ctx.requestId)
  return jsonOk({ ok: true })
})
