import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { listPayslips } from '@/server/services/payroll-service'
import { idSchema } from '@/server/validators/common'
import { periodSchema } from '@/server/validators/hr'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  const params = new URL(request.url).searchParams
  const period = params.get('period')
  const employeeId = params.get('employeeId')
  if (period && !periodSchema.safeParse(period).success) throw badRequest('Use period=YYYY-MM')
  if (employeeId && !idSchema.safeParse(employeeId).success) throw badRequest('Invalid employeeId')
  return jsonOk(
    await listPayslips(session, {
      ...(period ? { period } : {}),
      ...(employeeId ? { employeeId } : {}),
    }),
  )
})
