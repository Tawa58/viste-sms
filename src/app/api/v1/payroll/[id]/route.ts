import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, routeParam, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import {
  deletePayrollRun,
  getPayrollRunDetail,
  payrollAction,
} from '@/server/services/payroll-service'
import { payrollActionSchema, periodSchema } from '@/server/validators/hr'

async function periodParam(ctx: { params: Promise<Record<string, string | string[] | undefined>> }) {
  const id = routeParam(await ctx.params, 'id')
  if (!periodSchema.safeParse(id).success) throw badRequest('Unknown payroll month')
  return id
}

export const GET = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  return jsonOk(await getPayrollRunDetail(session, await periodParam(ctx)))
})

/** approve · reopen · lock */
export const PATCH = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = await periodParam(ctx)
  rateLimit(`payroll:action:${session.uid}`, 20, 60_000)
  const parsed = payrollActionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Unknown payroll action', parsed.error.flatten())
  return jsonOk(await payrollAction(session, id, parsed.data.action, ctx.requestId))
})

export const DELETE = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = await periodParam(ctx)
  rateLimit(`payroll:delete:${session.uid}`, 10, 60_000)
  await deletePayrollRun(session, id, ctx.requestId)
  return jsonOk({ ok: true })
})
