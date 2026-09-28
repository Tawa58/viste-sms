import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { badRequest } from '@/server/errors'
import { monthParamSchema } from '@/server/validators/checkin'
import { getAdminBundle } from '@/server/services/checkin-service'

/** Staff attendance for a month: roster, check-ins, premises exits, and reports. */
export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  const month = monthParamSchema.safeParse(new URL(request.url).searchParams.get('month') ?? undefined)
  if (!month.success) throw badRequest('Invalid month', month.error.flatten())
  return jsonOk(await getAdminBundle(session, month.data))
})
