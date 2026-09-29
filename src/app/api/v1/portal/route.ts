import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { getStudentPortalBundle } from '@/server/services/student-portal-bundle-service'

/** The signed-in student's portal: profile, results, attendance, fees, and more. */
export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  rateLimit(`portal:bundle:${session.uid}`, 60, 60_000)
  return jsonOk(await getStudentPortalBundle(session))
})
