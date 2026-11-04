import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { badRequest } from '@/server/errors'
import { rateLimit } from '@/server/http/rate-limit'
import {
  ecdChecklistTransitionSchema,
  ecdChecklistUpsertSchema,
} from '@/server/validators/school'
import {
  getEcdChecklistService,
  listEcdChecklistsService,
  listPendingEcdChecklistsService,
  transitionEcdChecklistService,
  upsertEcdChecklistService,
} from '@/server/services/ecd-checklist-service'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  const url = new URL(request.url)
  const kind = url.searchParams.get('kind')
  if (kind === 'pending') {
    return jsonOk(await listPendingEcdChecklistsService(session))
  }
  const classId = url.searchParams.get('classId')
  const termId = url.searchParams.get('termId')
  const studentId = url.searchParams.get('studentId')
  if (studentId && termId) {
    return jsonOk(await getEcdChecklistService(session, studentId, termId))
  }
  if (!classId || !termId) throw badRequest('classId and termId are required')
  return jsonOk(await listEcdChecklistsService(session, classId, termId))
})

export const PUT = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`ecd-checklist:${session.uid}`, 40, 60_000)
  const body = await request.json().catch(() => null)
  const parsed = ecdChecklistUpsertSchema.safeParse(body)
  if (!parsed.success) throw badRequest('Invalid ECD checklist', parsed.error.flatten())
  return jsonOk(await upsertEcdChecklistService(session, parsed.data, requestId))
})

export const PATCH = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  rateLimit(`ecd-checklist-transition:${session.uid}`, 40, 60_000)
  const body = await request.json().catch(() => null)
  const parsed = ecdChecklistTransitionSchema.safeParse(body)
  if (!parsed.success) throw badRequest('Invalid ECD transition', parsed.error.flatten())
  return jsonOk(await transitionEcdChecklistService(session, parsed.data, requestId))
})
