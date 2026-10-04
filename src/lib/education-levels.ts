/**
 * Canonical VISTE education levels (ECD → Form 6).
 * Stored as ids on classes/students/subjects so admins never need code changes
 * to create classes — they pick from this catalog (also seedable in Firestore).
 */

export type EducationBand = 'ECD' | 'PRIMARY' | 'SECONDARY'

export type EducationLevelDefinition = {
  id: string
  name: string
  band: EducationBand
  sequence: number
}

export const EDUCATION_LEVELS: readonly EducationLevelDefinition[] = [
  { id: 'ecd', name: 'ECD', band: 'ECD', sequence: 0 },
  { id: 'grade-1', name: 'Grade 1', band: 'PRIMARY', sequence: 1 },
  { id: 'grade-2', name: 'Grade 2', band: 'PRIMARY', sequence: 2 },
  { id: 'grade-3', name: 'Grade 3', band: 'PRIMARY', sequence: 3 },
  { id: 'grade-4', name: 'Grade 4', band: 'PRIMARY', sequence: 4 },
  { id: 'grade-5', name: 'Grade 5', band: 'PRIMARY', sequence: 5 },
  { id: 'grade-6', name: 'Grade 6', band: 'PRIMARY', sequence: 6 },
  { id: 'grade-7', name: 'Grade 7', band: 'PRIMARY', sequence: 7 },
  { id: 'form-1', name: 'Form 1', band: 'SECONDARY', sequence: 8 },
  { id: 'form-2', name: 'Form 2', band: 'SECONDARY', sequence: 9 },
  { id: 'form-3', name: 'Form 3', band: 'SECONDARY', sequence: 10 },
  { id: 'form-4', name: 'Form 4', band: 'SECONDARY', sequence: 11 },
  { id: 'form-5', name: 'Form 5', band: 'SECONDARY', sequence: 12 },
  { id: 'form-6', name: 'Form 6', band: 'SECONDARY', sequence: 13 },
] as const

export function getEducationLevel(id: string | undefined | null) {
  if (!id) return undefined
  return EDUCATION_LEVELS.find((l) => l.id === id)
}

export function educationLevelName(id: string | undefined | null) {
  return getEducationLevel(id)?.name ?? id ?? '—'
}

export function educationBand(id: string | undefined | null): EducationBand | undefined {
  return getEducationLevel(id)?.band
}

/** Mark scheme track for ECD, primary and secondary education. */
export type GradingTrackId = 'ECD' | 'PRIMARY' | 'FORM_1_4' | 'FORM_5_6'

export function gradingTrackForLevel(
  educationLevelId: string | undefined | null,
): GradingTrackId {
  const id = (
    resolveEducationLevelId(educationLevelId) ?? educationLevelId ?? ''
  ).toLowerCase()
  if (id === 'ecd') return 'ECD'
  if (/^grade-[1-7]$/.test(id)) return 'PRIMARY'
  if (id === 'form-5' || id === 'form-6') return 'FORM_5_6'
  // Form 1–4 and any other secondary default to the Form 1–4 scheme.
  return 'FORM_1_4'
}

export function gradingTrackLabel(track: GradingTrackId) {
  switch (track) {
    case 'ECD':
      return 'ECD'
    case 'PRIMARY':
      return 'Grades 1–7'
    case 'FORM_5_6':
      return 'Form 5–6 (A-Level)'
    default:
      return 'Form 1–4 (O-Level)'
  }
}

/** Resolve level id from legacy free-text `level` field on older class docs. */
export function resolveEducationLevelId(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined
  const normalized = raw.trim().toLowerCase()
  const byId = EDUCATION_LEVELS.find((l) => l.id === normalized)
  if (byId) return byId.id
  const byName = EDUCATION_LEVELS.find((l) => l.name.toLowerCase() === normalized)
  if (byName) return byName.id
  // Loose match: "Form 1A" → form-1, "Grade 4 Blue" → grade-4
  const match = EDUCATION_LEVELS.find(
    (l) =>
      normalized.startsWith(l.name.toLowerCase()) ||
      normalized.includes(l.name.toLowerCase()),
  )
  return match?.id
}
