import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { createHrStaff, listHrStaff } from '@/server/services/hr-service'
import { hrStaffSchema } from '@/server/validators/hr'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  return jsonOk(await listHrStaff(session))
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`hr:staff:create:${session.uid}`, 40, 60_000)
  const parsed = hrStaffSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid employee details', parsed.error.flatten())
  return jsonOk(await createHrStaff(session, parsed.data, requestId), { status: 201 })
})
