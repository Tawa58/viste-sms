import 'server-only'

import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import {
  assertCanAccessStudent,
  assertIsClassTeacher,
  assertTeacherOwnsClass,
} from '@/server/authorization/isolation'
import { notFound } from '@/server/errors'
import { getDoc, queryCollection, setDoc } from '@/server/repositories/firestore-repo'
import type { EcdChecklistUpsertInput } from '@/server/validators/school'
import { ECD_INDICATOR_IDS, resolveEcdStage } from '@/lib/ecd-checklist'
import type { EcdChecklist, EcdRatingMark, SchoolClass, Student, Term } from '@/types'

function checklistId(studentId: string, termId: string) {
  return `ecdchk_${studentId}_${termId}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

async function assertCanViewClass(session: SessionContext, classId: string) {
  if (session.role === 'TEACHER') {
    await assertTeacherOwnsClass(session, classId)
    return
  }
  requirePermission(session, 'results.read')
}

async function assertCanEditClass(session: SessionContext, classId: string) {
  requirePermission(session, 'results.enter')
  if (session.role === 'TEACHER') {
    try {
      await assertIsClassTeacher(session, classId)
    } catch {
      await assertTeacherOwnsClass(session, classId)
    }
  }
}

function cleanRatings(input: Record<string, string>) {
  const allowed = new Set(ECD_INDICATOR_IDS)
  const ratings: Record<string, EcdRatingMark> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) continue
    if (value === 'A' || value === 'D' || value === 'NY' || value === 'NA') {
      ratings[key] = value
    }
  }
  return ratings
}

function signature(row?: { name?: string; date?: string }) {
  const name = row?.name?.trim() ?? ''
  const date = row?.date?.trim() ?? ''
  if (!name && !date) return undefined
  return { name, date }
}

export async function listEcdChecklists(
  session: SessionContext,
  classId: string,
  termId: string,
): Promise<EcdChecklist[]> {
  await assertCanViewClass(session, classId)
  const rows = await queryCollection<EcdChecklist>('ecdChecklists', {
    limit: 100,
    where: [{ field: 'classId', op: '==', value: classId }],
  })
  return rows.filter((r) => r.termId === termId)
}

export async function getEcdChecklist(
  session: SessionContext,
  studentId: string,
  termId: string,
): Promise<EcdChecklist | null> {
  if (session.role === 'STUDENT') {
    if (session.profile.studentId !== studentId) {
      requirePermission(session, 'results.read')
    }
  } else if (session.role === 'PARENT') {
    await assertCanAccessStudent(session, studentId)
  } else {
    requirePermission(session, 'results.read')
  }
  const row = await getDoc<EcdChecklist>('ecdChecklists', checklistId(studentId, termId))
  if (!row) return null
  if (session.role !== 'STUDENT' && session.role !== 'PARENT') {
    await assertCanViewClass(session, row.classId)
  }
  return row
}

export async function upsertEcdChecklist(
  session: SessionContext,
  input: EcdChecklistUpsertInput,
  requestId?: string,
): Promise<EcdChecklist> {
  await assertCanEditClass(session, input.classId)

  const student = await getDoc<Student>('students', input.studentId)
  if (!student) throw notFound('Student not found')
  const cls = await getDoc<SchoolClass>('classes', input.classId)
  if (!cls) throw notFound('Class not found')
  const term = await getDoc<Term>('terms', input.termId)
  if (!term) throw notFound('Term not found')

  const id = checklistId(input.studentId, input.termId)
  const existing = await getDoc<EcdChecklist>('ecdChecklists', id)
  const now = new Date().toISOString()
  const stage = input.stage || resolveEcdStage(cls.name, cls.educationLevelId)

  const row: EcdChecklist = {
    id,
    studentId: input.studentId,
    classId: input.classId,
    termId: input.termId,
    academicYearId: input.academicYearId || cls.academicYearId,
    stage,
    status: input.status,
    assessedAt: input.assessedAt,
    classTeacherName: input.classTeacherName?.trim() || session.profile.name,
    ageYears: input.ageYears?.trim() || undefined,
    attendanceNote: input.attendanceNote?.trim() || undefined,
    ratings: cleanRatings(input.ratings ?? {}),
    strengths: input.strengths?.trim() || undefined,
    improvements: input.improvements?.trim() || undefined,
    interventions: input.interventions?.trim() || undefined,
    comments: input.comments?.trim() || undefined,
    overall: input.overall,
    signatures: {
      classTeacher: signature(input.signatures?.classTeacher),
      ecdCoordinator: signature(input.signatures?.ecdCoordinator),
      principal: signature(input.signatures?.principal),
      parentGuardian: signature(input.signatures?.parentGuardian),
    },
    updatedAt: now,
    updatedBy: session.uid,
  }

  await setDoc('ecdChecklists', id, { ...row })
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: existing ? 'ecd_checklist.update' : 'ecd_checklist.create',
    entityType: 'ecdChecklists',
    entityId: id,
    requestId,
  })
  return row
}

export const listEcdChecklistsService = listEcdChecklists
export const getEcdChecklistService = getEcdChecklist
export const upsertEcdChecklistService = upsertEcdChecklist
