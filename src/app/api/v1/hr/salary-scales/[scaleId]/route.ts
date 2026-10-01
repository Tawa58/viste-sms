import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, routeParam, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { updateSalaryScale } from '@/server/services/hr-service'
import { salaryScaleUpdateSchema } from '@/server/validators/hr'

export const PATCH = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const scaleId = routeParam(await ctx.params, 'scaleId')
  rateLimit(`hr:scales:update:${session.uid}`, 40, 60_000)
  const parsed = salaryScaleUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid salary scale change', parsed.error.flatten())
  return jsonOk(await updateSalaryScale(session, scaleId, parsed.data, ctx.requestId))
})
