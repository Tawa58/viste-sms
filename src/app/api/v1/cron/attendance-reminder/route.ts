import { jsonOk, withApiHandler } from '@/server/http/handler'
import { assertCronAuthorized } from '@/server/http/cron-auth'
import { schoolHour, schoolToday } from '@/server/lib/school-time'
import { runMissingRegisterReminderService } from '@/server/services/notifications-service'

/**
 * Vercel Cron (and manual) endpoint: after 08:00 school time, create one admin
 * notification listing classes whose daily register is still missing.
 */
async function handle(request: Request) {
  assertCronAuthorized(request)

  const force = new URL(request.url).searchParams.get('force') === '1'
  const hour = schoolHour()
  if (!force && hour < 8) {
    return jsonOk({
      skipped: true,
      reason: 'Before 08:00 school time',
      date: schoolToday(),
      hour,
    })
  }

  const result = await runMissingRegisterReminderService()
  return jsonOk({ skipped: false, ...result })
}

export const GET = withApiHandler(async (request) => handle(request))
export const POST = withApiHandler(async (request) => handle(request))
