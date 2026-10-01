import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { createExpenseCategory, listExpenseCategories } from '@/server/services/ledger-service'
import { expenseCategorySchema } from '@/server/validators/hr'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  return jsonOk(await listExpenseCategories(session))
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`finance:category:create:${session.uid}`, 20, 60_000)
  const parsed = expenseCategorySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid category', parsed.error.flatten())
  return jsonOk(await createExpenseCategory(session, parsed.data.name, requestId), { status: 201 })
})
