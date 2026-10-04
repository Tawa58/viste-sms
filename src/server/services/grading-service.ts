import 'server-only'

import type { SessionContext } from '@/server/auth/session'
import { requirePermission } from '@/server/authorization/permissions'
import { badRequest } from '@/server/errors'
import { getDoc, setDoc } from '@/server/repositories/firestore-repo'
import { gradingTrackForLevel, gradingTrackLabel } from '@/lib/education-levels'
import type { GradeBand, GradingScale, GradingScalesBundle, GradingTrack } from '@/types'

const TRACKS: GradingTrack[] = ['ECD', 'PRIMARY', 'FORM_1_4', 'FORM_5_6']

function defaultScale(track: GradingTrack, bands: GradeBand[]): GradingScale {
  return {
    id: track,
    track,
    label: gradingTrackLabel(track),
    passMark: 50,
    bands,
  }
}

const STANDARD_BANDS: GradeBand[] = [
  { grade: 'A', minPercent: 80, maxPercent: 100 },
  { grade: 'B', minPercent: 70, maxPercent: 79 },
  { grade: 'C', minPercent: 60, maxPercent: 69 },
  { grade: 'D', minPercent: 50, maxPercent: 59 },
  { grade: 'E', minPercent: 40, maxPercent: 49 },
  { grade: 'U', minPercent: 0, maxPercent: 39 },
]

/** Default ECD scale; schools can customize these percentage bands in settings. */
export const DEFAULT_ECD_SCALE = defaultScale('ECD', STANDARD_BANDS)

/** Default Grades 1–7 scale; schools can customize these percentage bands in settings. */
export const DEFAULT_PRIMARY_SCALE = defaultScale('PRIMARY', STANDARD_BANDS)

/** Zimbabwe-style O-Level defaults (Form 1–4). */
export const DEFAULT_FORM_1_4_SCALE: GradingScale = defaultScale('FORM_1_4', STANDARD_BANDS)

/** A-Level defaults (Form 5–6). */
export const DEFAULT_FORM_5_6_SCALE: GradingScale = defaultScale('FORM_5_6', [
    { grade: 'A', minPercent: 75, maxPercent: 100 },
    { grade: 'B', minPercent: 65, maxPercent: 74 },
    { grade: 'C', minPercent: 55, maxPercent: 64 },
    { grade: 'D', minPercent: 45, maxPercent: 54 },
    { grade: 'E', minPercent: 35, maxPercent: 44 },
    { grade: 'U', minPercent: 0, maxPercent: 34 },
  ])

/** @deprecated Prefer track-specific defaults. */
export const DEFAULT_GRADING_SCALE = DEFAULT_FORM_1_4_SCALE

function defaultForTrack(track: GradingTrack): GradingScale {
  const defaults: Record<GradingTrack, GradingScale> = {
    ECD: DEFAULT_ECD_SCALE,
    PRIMARY: DEFAULT_PRIMARY_SCALE,
    FORM_1_4: DEFAULT_FORM_1_4_SCALE,
    FORM_5_6: DEFAULT_FORM_5_6_SCALE,
  }
  const scale = defaults[track]
  return { ...scale, bands: scale.bands.map((b) => ({ ...b })) }
}

function validateBands(bands: GradeBand[]) {
  if (!bands.length) throw badRequest('At least one grade band is required')
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent)
  for (const b of sorted) {
    if (b.minPercent < 0 || b.maxPercent > 100 || b.minPercent > b.maxPercent) {
      throw badRequest(`Invalid band ${b.grade}: min/max must be within 0–100`)
    }
    if (!b.grade.trim()) throw badRequest('Grade label is required')
  }
  const labels = sorted.map((b) => b.grade.trim().toUpperCase())
  if (new Set(labels).size !== labels.length) {
    throw badRequest('Grade labels must be unique')
  }
  return sorted
}

function normalizeScale(
  track: GradingTrack,
  row: Partial<GradingScale> | undefined,
): GradingScale {
  const fallback = defaultForTrack(track)
  if (!row?.bands?.length) return fallback
  return {
    id: track,
    track,
    label: gradingTrackLabel(track),
    passMark: row.passMark ?? fallback.passMark,
    bands: row.bands,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  }
}

type StoredScales = {
  id?: string
  ECD?: Partial<GradingScale>
  PRIMARY?: Partial<GradingScale>
  FORM_1_4?: Partial<GradingScale>
  FORM_5_6?: Partial<GradingScale>
  /** Legacy single-scale document fields */
  passMark?: number
  bands?: GradeBand[]
  updatedAt?: string
  updatedBy?: string
}

async function readStored(): Promise<StoredScales | undefined> {
  const modern = await getDoc<StoredScales & { id: string }>('settings', 'gradingScales')
  if (
    modern?.ECD?.bands?.length ||
    modern?.PRIMARY?.bands?.length ||
    modern?.FORM_1_4?.bands?.length ||
    modern?.FORM_5_6?.bands?.length
  ) return modern

  // Migrate legacy single scale into Form 1–4
  const legacy = await getDoc<GradingScale>('settings', 'gradingScale')
  if (legacy?.bands?.length) {
    return {
      id: 'gradingScales',
      FORM_1_4: {
        passMark: legacy.passMark,
        bands: legacy.bands,
        updatedAt: legacy.updatedAt,
        updatedBy: legacy.updatedBy,
      },
    }
  }
  return undefined
}

export async function getGradingScales(): Promise<GradingScalesBundle> {
  const stored = await readStored()
  const legacyForm14 =
    stored?.FORM_1_4 ??
    (stored?.bands
      ? {
          passMark: stored.passMark,
          bands: stored.bands,
          updatedAt: stored.updatedAt,
          updatedBy: stored.updatedBy,
        }
      : undefined)
  return {
    ECD: normalizeScale('ECD', stored?.ECD),
    PRIMARY: normalizeScale('PRIMARY', stored?.PRIMARY),
    FORM_1_4: normalizeScale('FORM_1_4', legacyForm14),
    FORM_5_6: normalizeScale('FORM_5_6', stored?.FORM_5_6),
  }
}

export async function getGradingScale(track: GradingTrack = 'FORM_1_4'): Promise<GradingScale> {
  const all = await getGradingScales()
  return all[track]
}

export async function getGradingScaleForEducationLevel(
  educationLevelId: string | undefined | null,
): Promise<GradingScale> {
  return getGradingScale(gradingTrackForLevel(educationLevelId))
}

export async function getGradingScaleService(
  session: SessionContext,
): Promise<GradingScalesBundle> {
  requirePermission(session, 'results.read')
  return getGradingScales()
}

export async function updateGradingScaleService(
  session: SessionContext,
  input: { track: GradingTrack; passMark: number; bands: GradeBand[] },
): Promise<GradingScalesBundle> {
  requirePermission(session, 'settings.manage')
  if (!TRACKS.includes(input.track)) throw badRequest('Invalid grading track')
  const bands = validateBands(input.bands)
  if (input.passMark < 0 || input.passMark > 100) {
    throw badRequest('Pass mark must be between 0 and 100')
  }

  const current = await getGradingScales()
  const next: GradingScale = {
    id: input.track,
    track: input.track,
    label: gradingTrackLabel(input.track),
    passMark: input.passMark,
    bands,
    updatedAt: new Date().toISOString(),
    updatedBy: session.uid,
  }
  const bundle: GradingScalesBundle = {
    ...current,
    [input.track]: next,
  }
  await setDoc('settings', 'gradingScales', {
    ECD: bundle.ECD,
    PRIMARY: bundle.PRIMARY,
    FORM_1_4: bundle.FORM_1_4,
    FORM_5_6: bundle.FORM_5_6,
    updatedAt: next.updatedAt,
    updatedBy: session.uid,
  })
  return bundle
}

/** Map a raw score to a letter grade using percent of maxScore. */
export function gradeFromScore(
  score: number,
  maxScore: number,
  scale: GradingScale,
): string {
  if (maxScore <= 0) return scale.bands[scale.bands.length - 1]?.grade ?? 'U'
  const pct = Math.max(0, Math.min(100, (score / maxScore) * 100))
  const bands = [...scale.bands].sort((a, b) => b.minPercent - a.minPercent)
  for (const band of bands) {
    if (pct >= band.minPercent && pct <= band.maxPercent) return band.grade
  }
  if (pct >= 99.5 && bands[0]) return bands[0].grade
  return bands[bands.length - 1]?.grade ?? 'U'
}
