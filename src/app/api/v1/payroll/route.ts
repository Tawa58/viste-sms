import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { generatePayroll, listPayrollRuns } from '@/server/services/payroll-service'
import { payrollGenerateSchema } from '@/server/validators/hr'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  return jsonOk(await listPayrollRuns(session))
})

/** Generates (or regenerates) the draft payroll for a month. */
export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`payroll:generate:${session.uid}`, 10, 60_000)
  const parsed = payrollGenerateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Choose a month and year', parsed.error.flatten())
  return jsonOk(await generatePayroll(session, parsed.data, requestId), { status: 201 })
})
