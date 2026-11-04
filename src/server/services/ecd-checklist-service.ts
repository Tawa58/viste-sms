import 'server-only'

import { writeAuditLog } from '@/server/audit/logger'
import type { SessionContext } from '@/server/auth/session'
import { requirePermission, sessionHasPermission } from '@/server/authorization/permissions'
import {
  assertCanAccessStudent,
  assertIsClassTeacher,
  assertTeacherOwnsClass,
} from '@/server/authorization/isolation'
import { badRequest, forbidden, notFound } from '@/server/errors'
import {
  getDoc,
  queryAllCollection,
  queryCollection,
  setDoc,
} from '@/server/repositories/firestore-repo'
import type {
  EcdChecklistTransitionInput,
  EcdChecklistUpsertInput,
} from '@/server/validators/school'
import {
  ECD_INDICATOR_IDS,
  isEcdPendingApproval,
  isEcdReleasedToPortal,
  normalizeEcdStatus,
  resolveEcdStage,
  type EcdWorkflowStatus,
} from '@/lib/ecd-checklist'
import type { EcdChecklist, EcdChecklistStatus, EcdRatingMark, SchoolClass, Student, Term } from '@/types'
import { isFeeCleared } from '@/server/services/finance-service'
import { getFeePolicy } from '@/server/services/school-settings-service'

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

function writeStatusFromInput(status: EcdChecklistUpsertInput['status']): EcdChecklistStatus {
  if (status === 'COMPLETED' || status === 'SUBMITTED') return 'SUBMITTED'
  return 'DRAFT'
}

async function assertPortalMayViewChecklist(
  session: SessionContext,
  studentId: string,
  row: EcdChecklist,
): Promise<EcdChecklist | null> {
  if (!isEcdReleasedToPortal(row.status)) return null
  if (session.role !== 'STUDENT' && session.role !== 'PARENT') return row
  const policy = await getFeePolicy()
  if (policy.blockResultsWhenFeesOutstanding) {
    const cleared = await isFeeCleared(studentId)
    if (!cleared) return null
  }
  return row
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
  if (session.role === 'STUDENT' || session.role === 'PARENT') {
    return assertPortalMayViewChecklist(session, studentId, row)
  }
  await assertCanViewClass(session, row.classId)
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
  const existingFlow = existing ? normalizeEcdStatus(existing.status) : 'DRAFT'

  if (
    existingFlow === 'PUBLISHED' ||
    existingFlow === 'APPROVED' ||
    existingFlow === 'UNDER_REVIEW'
  ) {
    if (!sessionHasPermission(session, 'results.approve')) {
      throw forbidden(
        'This ECD checklist is locked for approval. Ask an admin to deny it before editing.',
      )
    }
  }

  const nextStatus = writeStatusFromInput(input.status)
  const now = new Date().toISOString()
  const stage = input.stage || resolveEcdStage(cls.name, cls.educationLevelId)

  const row: EcdChecklist = {
    id,
    studentId: input.studentId,
    classId: input.classId,
    termId: input.termId,
    academicYearId: input.academicYearId || cls.academicYearId,
    stage,
    status: nextStatus,
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
    metadata: { status: nextStatus },
  })
  return row
}

const ECD_TRANSITIONS: Record<EcdWorkflowStatus, EcdWorkflowStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'PUBLISHED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'PUBLISHED'],
  APPROVED: ['PUBLISHED', 'REJECTED'],
  REJECTED: ['SUBMITTED', 'DRAFT'],
  PUBLISHED: [],
}

export async function transitionEcdChecklist(
  session: SessionContext,
  input: EcdChecklistTransitionInput,
  requestId?: string,
): Promise<EcdChecklist> {
  requirePermission(session, 'results.approve')
  const row = await getDoc<EcdChecklist>('ecdChecklists', input.checklistId)
  if (!row) throw notFound('ECD checklist not found')

  const from = normalizeEcdStatus(row.status)
  const release = Boolean(input.releaseToPortal) || input.status === 'PUBLISHED'
  const next: EcdWorkflowStatus = release ? 'PUBLISHED' : input.status

  if (release) {
    if (from !== 'SUBMITTED' && from !== 'UNDER_REVIEW' && from !== 'APPROVED') {
      throw badRequest(
        `Only submitted ECD checklists can be released (current: ${row.status})`,
      )
    }
  } else if (!ECD_TRANSITIONS[from]?.includes(next)) {
    throw badRequest(`Invalid ECD status transition: ${from} → ${next}`)
  }

  const now = new Date().toISOString()
  const updated: EcdChecklist = {
    ...row,
    status: next,
    updatedAt: now,
    updatedBy: session.uid,
  }
  await setDoc('ecdChecklists', row.id, { ...updated })
  await writeAuditLog({
    actorId: session.uid,
    actorRole: session.role,
    action: `ecd_checklist.transition.${next}`,
    entityType: 'ecdChecklists',
    entityId: row.id,
    requestId,
    metadata: { from: row.status, to: next, releaseToPortal: release },
  })
  return updated
}

export async function listPendingEcdChecklists(
  session: SessionContext,
): Promise<EcdChecklist[]> {
  requirePermission(session, 'results.approve')
  const rows = await queryAllCollection<EcdChecklist>('ecdChecklists', { max: 500 })
  return rows
    .filter((r) => isEcdPendingApproval(r.status) || normalizeEcdStatus(r.status) === 'REJECTED')
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

export async function countPendingEcdChecklists(session: SessionContext): Promise<number> {
  requirePermission(session, 'results.approve')
  const rows = await queryAllCollection<EcdChecklist>('ecdChecklists', { max: 500 })
  return rows.filter((r) => isEcdPendingApproval(r.status)).length
}

export const listEcdChecklistsService = listEcdChecklists
export const getEcdChecklistService = getEcdChecklist
export const upsertEcdChecklistService = upsertEcdChecklist
export const transitionEcdChecklistService = transitionEcdChecklist
export const listPendingEcdChecklistsService = listPendingEcdChecklists
export const countPendingEcdChecklistsService = countPendingEcdChecklists
