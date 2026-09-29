import { apiFetch } from '@/services/api/http-client'
import { mockRequest, USE_MOCK_API } from '@/services/api/client'
import type {
  AttendanceStatus,
  StudentPortalAttendance,
  StudentPortalBundle,
  StudentPortalExam,
} from '@/types'

export type StudentPortalService = {
  get(): Promise<StudentPortalBundle>
}

const apiStudentPortalService: StudentPortalService = {
  get: () => apiFetch<StudentPortalBundle>('/api/v1/portal', { skipCache: true }),
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

/** Weekday register marks from term start to today, deterministic so the demo is stable. */
function demoAttendance(termStart: string): StudentPortalAttendance {
  const records: StudentPortalAttendance['records'] = []
  const today = isoDate(new Date())
  const cursor = new Date(`${termStart}T12:00:00Z`)
  let n = 0
  while (isoDate(cursor) <= today) {
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) {
      n++
      const status: AttendanceStatus =
        n % 29 === 0 ? 'EXCUSED' : n % 17 === 0 ? 'ABSENT' : n % 11 === 0 ? 'LATE' : 'PRESENT'
      records.push({ date: isoDate(cursor), status })
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  records.reverse()
  const count = (s: AttendanceStatus) => records.filter((r) => r.status === s).length
  const present = count('PRESENT')
  const late = count('LATE')
  const absent = count('ABSENT')
  const excused = count('EXCUSED')
  const total = records.length
  return {
    records,
    present,
    late,
    absent,
    excused,
    rate: total > 0 ? ((present + late) / total) * 100 : null,
  }
}

function demoBundle(): StudentPortalBundle {
  const now = new Date()
  const year = now.getFullYear()
  const termStart = `${year}-09-08`
  const monthKey = (offset: number) => {
    const d = new Date(year, now.getMonth() - offset, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  const monthLabel = (key: string) =>
    new Date(`${key}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  const latest = [
    { subject: 'Mathematics', score: 82, grade: 'A', comment: 'Strong work on calculus — keep practising proofs.' },
    { subject: 'Biology', score: 91, grade: 'A', comment: 'Excellent practical write-ups.' },
    { subject: 'Computer Science', score: 88, grade: 'A', comment: 'Clean, well-structured code.' },
    { subject: 'Chemistry', score: 79, grade: 'B', comment: 'Revise organic reaction mechanisms.' },
    { subject: 'English Language', score: 87, grade: 'A' },
  ]
  const previous = [
    { subject: 'Mathematics', score: 78, grade: 'B' },
    { subject: 'Biology', score: 89, grade: 'A' },
    { subject: 'Computer Science', score: 85, grade: 'A' },
    { subject: 'Chemistry', score: 74, grade: 'B' },
    { subject: 'English Language', score: 83, grade: 'A' },
  ]
  const avg = (rows: { score: number }[]) => rows.reduce((s, r) => s + r.score, 0) / rows.length
  const thisMonth = monthKey(0)
  const lastMonth = monthKey(1)

  const exams: StudentPortalExam[] = [
    ...latest.map((r, i) => ({
      id: `ex-${thisMonth}-${i}`,
      name: `${monthLabel(thisMonth).split(' ')[0]} test`,
      subject: r.subject,
      type: 'MONTHLY',
      termName: 'Term 3',
      month: thisMonth,
      maxScore: 100,
      status: 'RESULTS_OUT' as const,
      score: r.score,
      grade: r.grade,
    })),
    ...['Mathematics', 'Physics', 'Biology'].map((subject, i) => ({
      id: `ex-mock-${i}`,
      name: 'A-Level mock examination',
      subject,
      type: 'MOCK',
      termName: 'Term 3',
      maxScore: 100,
      status: 'MARKING' as const,
    })),
  ]

  return {
    generatedAt: now.toISOString(),
    profile: {
      id: 'demo-student',
      studentNumber: 'VST-2021-0147',
      admissionNumber: 'ADM-0147',
      firstName: 'Tawanda',
      lastName: 'Moyo',
      dateOfBirth: '2008-03-14',
      gender: 'Male',
      email: 'tawanda.moyo@students.viste.school',
      phone: '+263 77 123 4567',
      address: '12 Samora Machel Ave, Harare',
      admissionDate: '2021-01-12',
      status: 'ACTIVE',
      residency: 'BOARDER',
      className: 'Form 6 A',
      levelName: 'Form 6',
      classTeacherName: 'Mrs R. Chikore',
      houseName: 'Kariba',
      guardians: [
        {
          name: 'Grace Moyo',
          relationship: 'Mother',
          phone: '+263 77 987 6543',
          email: 'grace.moyo@example.com',
          emergencyContact: true,
        },
        {
          name: 'Tendai Moyo',
          relationship: 'Father',
          phone: '+263 71 555 0192',
          email: 'tendai.moyo@example.com',
        },
      ],
    },
    term: { id: 'demo-term-3', name: 'Term 3', startDate: termStart, endDate: `${year}-12-04` },
    subjects: [
      { id: 's1', code: 'MATH', name: 'Mathematics', category: 'Sciences', teachers: ['Mr T. Ncube'] },
      { id: 's2', code: 'BIO', name: 'Biology', category: 'Sciences', teachers: ['Dr P. Mutasa'] },
      { id: 's3', code: 'CS', name: 'Computer Science', category: 'Technology', teachers: ['Mr K. Dube'] },
      { id: 's4', code: 'CHEM', name: 'Chemistry', category: 'Sciences', teachers: ['Mrs L. Sibanda'] },
      { id: 's5', code: 'ENG', name: 'English Language', category: 'Languages', teachers: ['Mrs R. Chikore'] },
    ],
    attendance: demoAttendance(termStart),
    results: {
      studentId: 'demo-student',
      studentName: 'Tawanda Moyo',
      className: 'Form 6 A',
      streamName: 'A',
      academicYear: String(year),
      term: 'Term 3',
      accessState: 'RESULTS_AVAILABLE',
      subjects: latest.map(({ subject, ...r }) => ({ ...r, name: subject, type: 'MONTHLY' })),
      monthly: [
        {
          month: thisMonth,
          label: monthLabel(thisMonth),
          rows: latest.map((r) => ({ ...r, maxScore: 100 })),
          average: avg(latest),
        },
        {
          month: lastMonth,
          label: monthLabel(lastMonth),
          rows: previous.map((r) => ({ ...r, maxScore: 100 })),
          average: avg(previous),
        },
      ],
      termly: [
        {
          termId: 'demo-term-2',
          termName: 'Term 2',
          rows: previous.map((r) => ({ ...r, score: r.score - 2, maxScore: 100 })),
          average: avg(previous) - 2,
        },
      ],
      overallAverage: 87.4,
      teacherComment: 'Tawanda is a focused, respectful learner. Keep up the consistency into the final exams.',
    },
    fees: {
      currency: 'USD',
      invoices: [
        {
          id: 'inv-3',
          studentId: 'demo-student',
          number: 'INV-2026-0147-3',
          dueDate: `${year}-10-15`,
          total: 650,
          paid: 450,
          status: 'PARTIAL',
          termName: 'Term 3',
          category: 'BOARDING',
        },
        {
          id: 'inv-2',
          studentId: 'demo-student',
          number: 'INV-2026-0147-2',
          dueDate: `${year}-05-20`,
          total: 650,
          paid: 650,
          status: 'PAID',
          termName: 'Term 2',
          category: 'BOARDING',
        },
      ],
      payments: [
        {
          id: 'pay-3',
          studentId: 'demo-student',
          invoiceId: 'inv-3',
          amount: 450,
          method: 'EcoCash',
          status: 'CONFIRMED',
          paidAt: `${year}-09-10`,
          receiptNumber: 'RCP-00921',
        },
        {
          id: 'pay-2',
          studentId: 'demo-student',
          invoiceId: 'inv-2',
          amount: 650,
          method: 'Bank transfer',
          status: 'CONFIRMED',
          paidAt: `${year}-05-12`,
          receiptNumber: 'RCP-00613',
        },
      ],
      billed: 1300,
      paid: 1100,
      balance: 200,
      cleared: false,
      nextDueDate: `${year}-10-15`,
    },
    exams,
    announcements: [
      {
        id: 'an-1',
        title: 'A-Level mock examinations',
        body: 'Mock examinations begin on Monday 12 October. Collect your timetable from the exams office and bring your student card to every paper.',
        audience: ['Students'],
        status: 'PUBLISHED',
        publishedAt: `${year}-09-25T08:00:00.000Z`,
        author: 'Exams Office',
      },
      {
        id: 'an-2',
        title: 'Inter-house athletics',
        body: 'Inter-house athletics finals take place this Friday from 13:00. All boarders report to the sports field by 12:30.',
        audience: ['Students', 'Teachers'],
        status: 'PUBLISHED',
        publishedAt: `${year}-09-21T09:30:00.000Z`,
        author: 'Sports Department',
      },
      {
        id: 'an-3',
        title: 'Library opening hours',
        body: 'The library now stays open until 19:00 on weekdays for exam revision.',
        audience: ['Students'],
        status: 'PUBLISHED',
        publishedAt: `${year}-09-15T07:00:00.000Z`,
        author: 'Librarian',
      },
    ],
    documents: [
      {
        id: 'doc-demo-1',
        fileName: 'Term 2 report card.pdf',
        mimeType: 'application/pdf',
        fileType: 'report_pdf',
        sizeBytes: 184_320,
        uploadedAt: `${year}-08-02T10:00:00.000Z`,
      },
      {
        id: 'doc-demo-2',
        fileName: 'Science Olympiad certificate.pdf',
        mimeType: 'application/pdf',
        fileType: 'certificate',
        sizeBytes: 96_512,
        uploadedAt: `${year}-06-18T10:00:00.000Z`,
      },
    ],
    activities: {
      sports: [
        { id: 'sp-1', name: 'Basketball', description: 'Senior boys first team', coachName: 'Mr S. Banda' },
        { id: 'sp-2', name: 'Athletics', description: '400 m and relay', coachName: 'Ms N. Zhou' },
      ],
      clubs: [
        { id: 'cl-1', name: 'Coding Club', type: 'CLUB', description: 'Weekly programming challenges' },
        { id: 'cl-2', name: 'Debate Society', type: 'SOCIETY' },
      ],
      house: { name: 'Kariba', color: '#2563eb' },
    },
  }
}

const mockStudentPortalService: StudentPortalService = {
  get: () => mockRequest(demoBundle()),
}

export const studentPortalService: StudentPortalService = USE_MOCK_API
  ? mockStudentPortalService
  : apiStudentPortalService
