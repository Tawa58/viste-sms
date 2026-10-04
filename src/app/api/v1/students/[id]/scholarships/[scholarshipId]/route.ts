import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { deactivateStudentScholarshipService } from '@/server/services/students-service'

function paramId(value: string | string[] | undefined) {
  const id = Array.isArray(value) ? value[0] : value
  if (!id) throw badRequest('Missing scholarship id')
  return id
}

export const PATCH = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const { scholarshipId } = await ctx.params
  return jsonOk(
    await deactivateStudentScholarshipService(session, paramId(scholarshipId), ctx.requestId),
  )
})
