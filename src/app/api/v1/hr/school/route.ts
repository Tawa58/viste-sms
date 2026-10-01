import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { getLetterheadSchool } from '@/server/services/payroll-service'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  return jsonOk(await getLetterheadSchool(session))
})
