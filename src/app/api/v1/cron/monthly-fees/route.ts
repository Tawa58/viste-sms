import { jsonOk, withApiHandler } from '@/server/http/handler'
import { assertCronAuthorized } from '@/server/http/cron-auth'
import { raiseMonthlyInvoices } from '@/server/services/finance-service'

/**
 * Vercel Cron (and manual) endpoint: raise the invoice for each month that has
 * started for students on the monthly payment plan. Safe to run repeatedly.
 */
async function handle(request: Request) {
  assertCronAuthorized(request)
  const result = await raiseMonthlyInvoices()
  return jsonOk(result ?? { skipped: true, reason: 'No fee amounts set' })
}

export const GET = withApiHandler(async (request) => handle(request))
export const POST = withApiHandler(async (request) => handle(request))
