import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { getFinanceSummary } from '@/server/services/ledger-service'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  const raw = new URL(request.url).searchParams.get('year')
  const year = raw ? Number(raw) : new Date().getFullYear()
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw badRequest('Invalid year')
  return jsonOk(await getFinanceSummary(session, year))
})
