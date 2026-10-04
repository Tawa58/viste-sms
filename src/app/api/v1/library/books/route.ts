import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { createLibraryBook, listLibraryBooks } from '@/server/services/library-service'
import { libraryBookSchema } from '@/server/validators/school'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  return jsonOk(await listLibraryBooks(session))
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`library:book:${session.uid}`, 60, 60_000)
  const parsed = libraryBookSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid book details', parsed.error.flatten())
  return jsonOk(await createLibraryBook(session, parsed.data, requestId), { status: 201 })
})
