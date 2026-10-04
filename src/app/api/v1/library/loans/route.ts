import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { createLibraryLoan, listLibraryLoans } from '@/server/services/library-service'
import { libraryLoanSchema } from '@/server/validators/school'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  return jsonOk(await listLibraryLoans(session))
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`library:loan:${session.uid}`, 60, 60_000)
  const parsed = libraryLoanSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid book loan details', parsed.error.flatten())
  return jsonOk(await createLibraryLoan(session, parsed.data, requestId), { status: 201 })
})
