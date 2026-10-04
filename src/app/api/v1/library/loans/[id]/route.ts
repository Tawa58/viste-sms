import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { returnLibraryLoan } from '@/server/services/library-service'

function paramId(value: string | string[] | undefined) {
  const id = Array.isArray(value) ? value[0] : value
  if (!id) throw badRequest('Missing loan id')
  return id
}

export const PATCH = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const { id } = await ctx.params
  return jsonOk(await returnLibraryLoan(session, paramId(id), ctx.requestId))
})
