import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import {
  getAttendanceRulesService,
  updateAttendanceRules,
} from '@/server/services/payroll-service'
import { attendanceRulesSchema } from '@/server/validators/hr'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  return jsonOk(await getAttendanceRulesService(session))
})

export const PUT = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`payroll:rules:${session.uid}`, 20, 60_000)
  const parsed = attendanceRulesSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid attendance deduction rules', parsed.error.flatten())
  return jsonOk(await updateAttendanceRules(session, parsed.data, requestId))
})
