export const ECD_RATINGS = ['A', 'D', 'NY', 'NA'] as const
export type EcdRating = (typeof ECD_RATINGS)[number]

export type EcdStage = 'ECD_A' | 'ECD_B'

export type EcdOverallProgress =
  | 'EXCELLENT'
  | 'GOOD'
  | 'SATISFACTORY'
  | 'ADDITIONAL_SUPPORT'
  | 'INDIVIDUALISED'

export const ECD_RATING_LABELS: Record<EcdRating, string> = {
  A: 'Achieved — can perform independently',
  D: 'Developing — can perform with some assistance',
  NY: 'Not yet — has not demonstrated the skill',
  NA: 'Not applicable — not assessed',
}

export const ECD_OVERALL_LABELS: Record<EcdOverallProgress, string> = {
  EXCELLENT: 'Excellent progress',
  GOOD: 'Good progress',
  SATISFACTORY: 'Satisfactory progress',
  ADDITIONAL_SUPPORT: 'Requires additional support',
  INDIVIDUALISED: 'Requires individualised intervention',
}

export type EcdIndicator = {
  id: string
  number: number
  text: string
}

export type EcdSection = {
  id: string
  part: string
  title: string
  indicators: EcdIndicator[]
}

function items(prefix: string, texts: string[]): EcdIndicator[] {
  return texts.map((text, index) => ({
    id: `${prefix}-${index + 1}`,
    number: index + 1,
    text,
  }))
}

export const ECD_CHECKLIST_SECTIONS: EcdSection[] = [
  {
    id: 'lang-listen',
    part: 'Part 2 · Language and literacy',
    title: 'A. Listening and speaking',
    indicators: items('lang-listen', [
      'Listens attentively when spoken to.',
      'Follows simple instructions.',
      'Responds appropriately to questions.',
      'Expresses personal needs verbally.',
      'Speaks audibly and clearly.',
      'Participates in conversations.',
      'Retells simple stories.',
      'Recites rhymes and poems.',
      'Identifies and names familiar objects.',
      'Uses appropriate vocabulary.',
    ]),
  },
  {
    id: 'lang-read',
    part: 'Part 2 · Language and literacy',
    title: 'B. Early reading skills',
    indicators: items('lang-read', [
      'Recognises letters of the alphabet.',
      'Identifies letter sounds.',
      'Distinguishes between uppercase and lowercase letters.',
      'Recognises familiar written words.',
      'Demonstrates awareness of books and print.',
      'Follows pictures when telling a story.',
      'Reads simple words appropriate to the level.',
      'Reads simple sentences appropriate to the level.',
    ]),
  },
  {
    id: 'lang-write',
    part: 'Part 2 · Language and literacy',
    title: 'C. Pre-writing and writing skills',
    indicators: items('lang-write', [
      'Holds a pencil correctly.',
      'Demonstrates appropriate hand control.',
      'Traces basic lines and patterns.',
      'Copies shapes and symbols.',
      'Writes or traces letters.',
      'Writes own name.',
      'Copies simple words.',
      'Writes simple words independently.',
    ]),
  },
  {
    id: 'maths',
    part: 'Part 3 · Mathematical and numeracy development',
    title: 'Numeracy',
    indicators: items('maths', [
      'Counts objects accurately.',
      'Recognises numbers.',
      'Writes numbers.',
      'Matches numbers to quantities.',
      'Arranges numbers in sequence.',
      'Identifies basic shapes.',
      'Sorts objects according to colour.',
      'Sorts objects according to size.',
      'Compares quantities (more and fewer).',
      'Understands basic addition concepts.',
      'Understands basic subtraction concepts.',
      'Identifies patterns and sequences.',
      'Understands basic measurement concepts.',
      'Identifies basic concepts of time.',
      'Identifies common positions (above, below, inside, outside).',
    ]),
  },
  {
    id: 'science',
    part: 'Part 4 · Environmental and scientific awareness',
    title: 'Environment and science',
    indicators: items('science', [
      'Identifies parts of the human body.',
      'Identifies the five senses.',
      'Identifies common domestic animals.',
      'Identifies wild animals.',
      'Identifies common plants.',
      'Understands basic plant growth.',
      'Identifies common weather conditions.',
      'Recognises different seasons.',
      'Understands the importance of water.',
      'Identifies basic sources of food.',
      'Understands the importance of environmental cleanliness.',
      'Identifies familiar community helpers.',
      'Recognises common means of transport.',
      'Demonstrates basic road safety awareness.',
    ]),
  },
  {
    id: 'social',
    part: 'Part 5 · Social and emotional development',
    title: 'Social and emotional',
    indicators: items('social', [
      'Interacts positively with classmates.',
      'Shares learning materials.',
      'Takes turns during activities.',
      'Demonstrates respect for others.',
      'Follows classroom rules.',
      'Demonstrates confidence when participating.',
      'Expresses emotions appropriately.',
      'Demonstrates independence.',
      'Cooperates during group activities.',
      'Demonstrates kindness and empathy.',
      'Respects teachers and other school personnel.',
      'Resolves simple disagreements appropriately.',
    ]),
  },
  {
    id: 'gross-motor',
    part: 'Part 6 · Physical and motor development',
    title: 'A. Gross motor skills',
    indicators: items('gross-motor', [
      'Walks confidently.',
      'Runs with coordination.',
      'Jumps with both feet.',
      'Hops on one foot.',
      'Balances while standing or moving.',
      'Throws and catches a ball.',
      'Participates in physical exercises.',
      'Coordinates movements during games.',
    ]),
  },
  {
    id: 'fine-motor',
    part: 'Part 6 · Physical and motor development',
    title: 'B. Fine motor skills',
    indicators: items('fine-motor', [
      'Holds crayons and pencils correctly.',
      'Uses scissors safely.',
      'Threads beads or similar objects.',
      'Builds structures using blocks.',
      'Colours within boundaries appropriate to ability.',
      'Manipulates small objects effectively.',
      'Completes simple puzzles.',
    ]),
  },
  {
    id: 'creative',
    part: 'Part 7 · Creative arts and cultural development',
    title: 'Creative arts and culture',
    indicators: items('creative', [
      'Participates in singing activities.',
      'Follows simple rhythms.',
      'Participates in dancing activities.',
      'Draws familiar objects.',
      'Uses different colours appropriately.',
      'Participates in painting activities.',
      'Creates objects using modelling materials.',
      'Participates in imaginative play.',
      'Appreciates cultural songs and activities.',
      'Demonstrates creativity and imagination.',
    ]),
  },
  {
    id: 'hygiene',
    part: 'Part 8 · Personal hygiene, health and life skills',
    title: 'Hygiene, health and life skills',
    indicators: items('hygiene', [
      'Washes hands independently.',
      'Uses the toilet appropriately.',
      'Maintains personal cleanliness.',
      'Uses a handkerchief or tissue appropriately.',
      'Eats independently.',
      'Uses eating utensils appropriately.',
      'Dresses independently or with minimal assistance.',
      'Keeps personal belongings organised.',
      'Understands basic safety rules.',
      'Identifies unsafe situations.',
      'Knows when to seek adult assistance.',
      'Demonstrates healthy eating habits.',
    ]),
  },
  {
    id: 'habits',
    part: 'Part 9 · Classroom behaviour and learning habits',
    title: 'Classroom behaviour and learning habits',
    indicators: items('habits', [
      'Arrives at school regularly and punctually.',
      'Settles into classroom activities.',
      'Pays attention during lessons.',
      'Completes assigned activities.',
      'Takes care of learning materials.',
      'Participates actively in lessons.',
      'Demonstrates curiosity and eagerness to learn.',
      'Attempts tasks before seeking assistance.',
      'Works independently when appropriate.',
      'Follows instructions and classroom routines.',
    ]),
  },
]

export const ECD_INDICATOR_IDS = ECD_CHECKLIST_SECTIONS.flatMap((s) =>
  s.indicators.map((i) => i.id),
)

export const ECD_EXPECTATIONS: {
  area: string
  ecdA: string
  ecdB: string
}[] = [
  {
    area: 'Alphabet',
    ecdA: 'Recognises and begins identifying letters and sounds.',
    ecdB: 'Recognises letters and demonstrates stronger letter-sound associations.',
  },
  {
    area: 'Reading',
    ecdA: 'Develops pre-reading skills.',
    ecdB: 'Begins blending sounds and reading simple words.',
  },
  {
    area: 'Writing',
    ecdA: 'Develops pencil control, tracing and letter formation.',
    ecdB: 'Writes letters, own name and simple words.',
  },
  {
    area: 'Numeracy',
    ecdA: 'Counts, recognises numbers and identifies quantities.',
    ecdB: 'Counts confidently, orders numbers and performs simple number operations.',
  },
  {
    area: 'Shapes',
    ecdA: 'Identifies basic shapes.',
    ecdB: 'Identifies, describes and compares shapes.',
  },
  {
    area: 'Communication',
    ecdA: 'Uses simple sentences to communicate.',
    ecdB: 'Expresses ideas in more developed sentences and retells stories.',
  },
  {
    area: 'Independence',
    ecdA: 'Performs simple tasks with guidance.',
    ecdB: 'Performs familiar tasks with greater independence.',
  },
  {
    area: 'Problem-solving',
    ecdA: 'Solves simple problems with assistance.',
    ecdB: 'Attempts age-appropriate problems with increasing independence.',
  },
]

export function isEcdEducationLevel(id: string | undefined | null) {
  const n = (id ?? '').trim().toLowerCase()
  return n === 'ecd' || n.startsWith('ecd-') || n.startsWith('ecd ')
}

export function isEcdClass(cls: {
  name?: string
  level?: string
  educationLevelId?: string
}) {
  return (
    isEcdEducationLevel(cls.educationLevelId) ||
    /\becd\b/i.test(cls.name ?? '') ||
    /\becd\b/i.test(cls.level ?? '')
  )
}

export function resolveEcdStage(
  className: string | undefined,
  educationLevelId: string | undefined | null,
): EcdStage {
  const level = (educationLevelId ?? '').toLowerCase()
  if (level === 'ecd-a' || level.includes('ecd-a')) return 'ECD_A'
  if (level === 'ecd-b' || level.includes('ecd-b')) return 'ECD_B'
  const name = (className ?? '').toLowerCase()
  if (/\becd[\s-]*a\b/.test(name)) return 'ECD_A'
  if (/\becd[\s-]*b\b/.test(name)) return 'ECD_B'
  return 'ECD_A'
}

export function ecdStageLabel(stage: EcdStage) {
  return stage === 'ECD_B' ? 'ECD B' : 'ECD A'
}

export function ageFromDateOfBirth(dob: string | undefined, onDate = new Date()) {
  if (!dob) return ''
  const born = new Date(`${dob.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(born.getTime())) return ''
  let years = onDate.getFullYear() - born.getFullYear()
  const monthDiff = onDate.getMonth() - born.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && onDate.getDate() < born.getDate())) years -= 1
  return years >= 0 ? String(years) : ''
}

export function summariseEcdRatings(ratings: Record<string, EcdRating | ''>) {
  const counts = { A: 0, D: 0, NY: 0, NA: 0, blank: 0 }
  for (const id of ECD_INDICATOR_IDS) {
    const value = ratings[id]
    if (value === 'A' || value === 'D' || value === 'NY' || value === 'NA') counts[value] += 1
    else counts.blank += 1
  }
  const scored = counts.A + counts.D + counts.NY
  return { ...counts, scored, total: ECD_INDICATOR_IDS.length }
}
