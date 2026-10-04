import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { badRequest } from '@/server/errors'
import { rateLimit } from '@/server/http/rate-limit'
import { termBillingSchema } from '@/server/validators/school'
import {
  generateCurrentMonthInvoice,
  generateTermInvoices,
  listInvoicesService,
} from '@/server/services/finance-service'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  return jsonOk(await listInvoicesService(session))
})

/** Bill every active student for a term (current term when termId is omitted). */
export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`invoices:bill:${session.uid}`, 6, 60_000)
  const body = await request.json().catch(() => ({}))
  const parsed = termBillingSchema.safeParse(body ?? {})
  if (!parsed.success) throw badRequest('Invalid billing request', parsed.error.flatten())
  if (parsed.data.currentMonthOnly) {
    if (!parsed.data.studentId) throw badRequest('Choose a student to bill')
    return jsonOk(await generateCurrentMonthInvoice(session, parsed.data.studentId, requestId))
  }
  return jsonOk(await generateTermInvoices(session, parsed.data.termId, requestId))
})
