import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { createDeduction, listDeductions } from '@/server/services/payroll-service'
import { deductionSchema, periodSchema } from '@/server/validators/hr'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  const raw = new URL(request.url).searchParams.get('period')
  const period = raw ? periodSchema.safeParse(raw) : null
  if (period && !period.success) throw badRequest('Use period=YYYY-MM')
  return jsonOk(await listDeductions(session, period?.data))
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`payroll:deduction:create:${session.uid}`, 60, 60_000)
  const parsed = deductionSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid deduction', parsed.error.flatten())
  return jsonOk(await createDeduction(session, parsed.data, requestId), { status: 201 })
})
