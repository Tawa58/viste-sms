import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { badRequest } from '@/server/errors'
import { rateLimit } from '@/server/http/rate-limit'
import { deleteAssessmentService } from '@/server/services/results-service'

function paramId(id: string | string[] | undefined): string {
  const v = Array.isArray(id) ? id[0] : id
  if (!v) throw badRequest('Missing id')
  return v
}

export const DELETE = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const id = paramId((await ctx.params).id)
  rateLimit(`results:delete:${session.uid}`, 30, 60_000)
  return jsonOk(await deleteAssessmentService(session, id, ctx.requestId))
})
