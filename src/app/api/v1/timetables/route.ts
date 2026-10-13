import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import { idSchema } from '@/server/validators/common'
import {
  getTimetableOptions,
  listTimetablesForSession,
  publishTimetable,
} from '@/server/services/timetable-service'
import { timetableUpsertSchema } from '@/server/validators/timetable'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  const params = new URL(request.url).searchParams
  if (params.get('options') === '1') {
    return jsonOk(await getTimetableOptions(session))
  }
  const requestedClassId = params.get('classId')
  const parsedClassId = requestedClassId ? idSchema.safeParse(requestedClassId) : null
  if (parsedClassId && !parsedClassId.success) throw badRequest('Invalid class id')
  const classId = parsedClassId?.success ? parsedClassId.data : undefined
  return jsonOk(await listTimetablesForSession(session, classId))
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`timetables:publish:${session.uid}`, 20, 60_000)
  const parsed = timetableUpsertSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid timetable', parsed.error.flatten())
  return jsonOk(await publishTimetable(session, parsed.data, requestId), { status: 201 })
})
