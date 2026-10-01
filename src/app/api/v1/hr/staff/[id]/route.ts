import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, routeParam, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { deleteHrStaff, updateHrStaff } from '@/server/services/hr-service'
import { hrStaffSchema } from '@/server/validators/hr'

export const PATCH = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = routeParam(await ctx.params, 'id')
  rateLimit(`hr:staff:update:${session.uid}`, 60, 60_000)
  const parsed = hrStaffSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid employee details', parsed.error.flatten())
  return jsonOk(await updateHrStaff(session, id, parsed.data, ctx.requestId))
})

export const DELETE = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = routeParam(await ctx.params, 'id')
  rateLimit(`hr:staff:delete:${session.uid}`, 20, 60_000)
  await deleteHrStaff(session, id, ctx.requestId)
  return jsonOk({ ok: true })
})
