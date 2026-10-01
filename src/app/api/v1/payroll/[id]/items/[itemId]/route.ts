import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, routeParam, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { updatePayrollItemAttendance } from '@/server/services/payroll-service'
import { payrollItemUpdateSchema } from '@/server/validators/hr'

/** Hand-entered absent / late counts on a draft payroll line. */
export const PATCH = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const params = await ctx.params
  const id = routeParam(params, 'id')
  const itemId = routeParam(params, 'itemId')
  rateLimit(`payroll:item:${session.uid}`, 60, 60_000)
  const parsed = payrollItemUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid attendance counts', parsed.error.flatten())
  return jsonOk(await updatePayrollItemAttendance(session, id, itemId, parsed.data, ctx.requestId))
})
