import { requireSession } from '@/server/auth/session'
import { badRequest } from '@/server/errors'
import { jsonOk, withApiHandler } from '@/server/http/handler'
import { rateLimit } from '@/server/http/rate-limit'
import {
  createStudentScholarshipService,
  listStudentScholarshipsService,
} from '@/server/services/students-service'
import { scholarshipCreateSchema } from '@/server/validators/school'

function paramId(id: string | string[] | undefined) {
  const value = Array.isArray(id) ? id[0] : id
  if (!value) throw badRequest('Missing student id')
  return value
}

export const GET = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  const studentId = paramId((await ctx.params).id)
  return jsonOk(await listStudentScholarshipsService(session, studentId))
})

export const POST = withApiHandler(async (request, ctx) => {
  const session = await requireSession(request)
  rateLimit(`scholarships:create:${session.uid}`, 30, 60_000)
  const studentId = paramId((await ctx.params).id)
  const parsed = scholarshipCreateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) throw badRequest('Invalid scholarship payload', parsed.error.flatten())
  return jsonOk(
    await createStudentScholarshipService(session, studentId, parsed.data, ctx.requestId),
    { status: 201 },
  )
})
