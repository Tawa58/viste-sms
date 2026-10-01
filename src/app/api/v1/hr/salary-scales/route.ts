import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { createSalaryScale, listSalaryScales } from '@/server/services/hr-service'
import { salaryScaleSchema } from '@/server/validators/hr'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  return jsonOk(await listSalaryScales(session))
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`hr:scales:create:${session.uid}`, 30, 60_000)
  const parsed = salaryScaleSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid salary scale', parsed.error.flatten())
  return jsonOk(await createSalaryScale(session, parsed.data, requestId), { status: 201 })
})
