import { requireSession } from '@/server/auth/session'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { badRequest } from '@/server/errors'
import {
  classSubjectMarksSchema,
  markUpsertSchema,
  monthlyMarksSchema,
  resultTransitionSchema,
} from '@/server/validators/school'
import {
  getResultPortalService,
  listAssessmentsService,
  listMarksService,
  submitClassSubjectMarksService,
  submitMonthlyMarksService,
  transitionAssessmentService,
  upsertMarkService,
} from '@/server/services/results-service'

export const GET = withApiHandler(async (request) => {
  const session = await requireSession(request)
  const url = new URL(request.url)
  const studentId = url.searchParams.get('studentId')
  if (studentId) {
    return jsonOk(await getResultPortalService(session, studentId))
  }
  const kind = url.searchParams.get('kind')
  if (kind === 'assessments') return jsonOk(await listAssessmentsService(session))
  if (kind === 'marks') {
    return jsonOk(
      await listMarksService(session, {
        assessmentId: url.searchParams.get('assessmentId') ?? undefined,
        studentId: url.searchParams.get('forStudentId') ?? undefined,
      }),
    )
  }
  return jsonOk(await listAssessmentsService(session))
})

export const POST = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  const body = await request.json().catch(() => null)

  if (body && typeof body === 'object' && Array.isArray((body as { entries?: unknown }).entries)) {
    if ('periodType' in body || ('month' in body && !('assessmentId' in body))) {
      // Prefer unified schema; fall back to legacy monthly
      const unified = classSubjectMarksSchema.safeParse(
        'periodType' in body
          ? body
          : {
              ...body,
              periodType: 'MONTHLY',
              action:
                (body as { action?: string }).action ??
                ((body as { publish?: boolean }).publish ? 'submit' : 'draft'),
            },
      )
      if (unified.success) {
        return jsonOk(await submitClassSubjectMarksService(session, unified.data, requestId), {
          status: 201,
        })
      }
      const legacy = monthlyMarksSchema.safeParse(body)
      if (legacy.success) {
        return jsonOk(await submitMonthlyMarksService(session, legacy.data, requestId), {
          status: 201,
        })
      }
      throw badRequest('Invalid class/subject marks payload', unified.error?.flatten())
    }
  }

  const parsed = markUpsertSchema.safeParse(body)
  if (!parsed.success) throw badRequest('Invalid mark payload', parsed.error.flatten())
  return jsonOk(await upsertMarkService(session, parsed.data, requestId), { status: 201 })
})

export const PATCH = withApiHandler(async (request, { requestId }) => {
  const session = await requireSession(request)
  const body = await request.json().catch(() => null)
  const parsed = resultTransitionSchema.safeParse(body?.status ? body : null)
  const assessmentId = typeof body?.assessmentId === 'string' ? body.assessmentId : ''
  if (!parsed.success || !assessmentId) {
    throw badRequest('Invalid transition payload')
  }
  return jsonOk(
    await transitionAssessmentService(
      session,
      assessmentId,
      parsed.data.status,
      requestId,
      parsed.data.releaseToPortal,
    ),
  )
})
