import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, routeParam, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { deleteDeduction, updateDeduction } from '@/server/services/payroll-service'
import { deductionUpdateSchema } from '@/server/validators/hr'

export const PATCH = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = routeParam(await ctx.params, 'id')
  rateLimit(`payroll:deduction:update:${session.uid}`, 60, 60_000)
  const parsed = deductionUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid deduction', parsed.error.flatten())
  return jsonOk(await updateDeduction(session, id, parsed.data, ctx.requestId))
})

export const DELETE = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = routeParam(await ctx.params, 'id')
  rateLimit(`payroll:deduction:delete:${session.uid}`, 30, 60_000)
  await deleteDeduction(session, id, ctx.requestId)
  return jsonOk({ ok: true })
})
