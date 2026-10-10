import type { DashboardStats, Payment, Staff, Student } from '@/types'
import { invoiceBalance } from '@/lib/fees'
import { firestoreSchool } from './school-repository'

function monthKey(isoDate: string): string {
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return 'Unknown'
  return d.toLocaleString('en', { month: 'short' })
}

function lastMonths(count: number): string[] {
  const out: string[] = []
  const now = new Date()
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(d.toLocaleString('en', { month: 'short' }))
  }
  return out
}

/**
 * Builds dashboard charts/stats from live Firestore collections.
 * Empty school data ⇒ zeros / empty series (no placeholder fake trends).
 */
export async function buildLiveDashboard() {
  await firestoreSchool.ensureSchoolCatalog()

  const [students, staff, attendance, invoices, payments, marks, assessments, subjects] =
    await Promise.all([
      firestoreSchool.listStudents(),
      firestoreSchool.listStaff(),
      firestoreSchool.listAttendance(),
      firestoreSchool.listInvoices(),
      firestoreSchool.listPayments(),
      firestoreSchool.listMarks(),
      firestoreSchool.listAssessments(),
      firestoreSchool.listSubjects(),
    ])

  const activeStudents = students.filter((s) => s.status === 'ACTIVE')
  const activeTeachers = staff.filter((s) => s.status === 'ACTIVE')

  const outstandingFees = invoices.reduce((sum, invoice) => sum + invoiceBalance(invoice), 0)
  const feesCollected = payments
    .filter((p) => p.status === 'CONFIRMED')
    .reduce((sum, p) => sum + p.amount, 0)

  const today = new Date().toISOString().slice(0, 10)
  const todayRows = attendance.filter((a) => a.date === today)
  const presentToday = todayRows.filter(
    (a) => a.status === 'PRESENT' || a.status === 'LATE',
  ).length
  const todayAttendancePct = todayRows.length
    ? Math.round((presentToday / todayRows.length) * 100)
    : 0

  const stats: DashboardStats = {
    totalStudents: activeStudents.length,
    totalTeachers: activeTeachers.length,
    todayAttendancePct,
    outstandingFees,
    feesCollected,
    pendingResults: assessments.filter((a) =>
      ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED'].includes(a.status),
    ).length,
  }

  const months = lastMonths(6)
  const enrollment = months.map((month) => {
    // Cumulative headcount by admission month (real students only).
    const monthIndex = months.indexOf(month)
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - (months.length - 1 - monthIndex))
    cutoff.setDate(28)
    const count = students.filter((s) => {
      const admitted = new Date(s.admissionDate)
      return !Number.isNaN(admitted.getTime()) && admitted <= cutoff
    }).length
    return { month, students: count }
  })

  const attendanceBucket = {
    Present: 0,
    Late: 0,
    Absent: 0,
    Excused: 0,
  }
  const sourceAttendance = todayRows.length ? todayRows : attendance
  for (const row of sourceAttendance) {
    if (row.status === 'PRESENT') attendanceBucket.Present += 1
    else if (row.status === 'LATE') attendanceBucket.Late += 1
    else if (row.status === 'ABSENT') attendanceBucket.Absent += 1
    else if (row.status === 'EXCUSED' || row.status === 'AUTHORIZED_ABSENCE') {
      attendanceBucket.Excused += 1
    }
  }
  const attendanceOverview = Object.entries(attendanceBucket).map(([name, value]) => ({
    name,
    value,
  }))

  const feeByMonth = new Map<string, { collected: number; outstanding: number }>()
  for (const m of months) feeByMonth.set(m, { collected: 0, outstanding: 0 })
  for (const p of payments.filter((x) => x.status === 'CONFIRMED')) {
    const key = monthKey(p.paidAt)
    const slot = feeByMonth.get(key)
    if (slot) slot.collected += p.amount
  }
  for (const inv of invoices) {
    const key = monthKey(inv.dueDate)
    const slot = feeByMonth.get(key)
    if (slot) slot.outstanding += invoiceBalance(inv)
  }
  const feeCollection = months.map((month) => ({
    month,
    collected: feeByMonth.get(month)?.collected ?? 0,
    outstanding: feeByMonth.get(month)?.outstanding ?? 0,
  }))

  const subjectTotals = new Map<string, { sum: number; n: number }>()
  const assessmentSubject = new Map(assessments.map((a) => [a.id, a.subjectId]))
  for (const mark of marks) {
    const subjectId = assessmentSubject.get(mark.assessmentId)
    if (!subjectId) continue
    const slot = subjectTotals.get(subjectId) ?? { sum: 0, n: 0 }
    slot.sum += mark.score
    slot.n += 1
    subjectTotals.set(subjectId, slot)
  }
  const performance = [...subjectTotals.entries()].map(([subjectId, { sum, n }]) => ({
    subject: subjects.find((s) => s.id === subjectId)?.name ?? subjectId,
    average: n ? Math.round(sum / n) : 0,
  }))

  const recentPayments: Payment[] = [...payments]
    .sort((a, b) => b.paidAt.localeCompare(a.paidAt))
    .slice(0, 5)

  const recentActivities = buildActivities(students, staff, payments, attendance)

  return {
    stats,
    enrollment,
    attendanceOverview,
    feeCollection,
    performance,
    recentPayments,
    recentActivities,
  }
}

function buildActivities(
  students: Student[],
  staff: Staff[],
  payments: Payment[],
  attendance: AttendanceRecordLike[],
) {
  const events: { id: string; title: string; detail: string; at: string }[] = []

  for (const p of [...payments].sort((a, b) => b.paidAt.localeCompare(a.paidAt)).slice(0, 3)) {
    events.push({
      id: `act-pay-${p.id}`,
      title: 'Payment confirmed',
      detail: `${p.receiptNumber} · $${p.amount}`,
      at: p.paidAt,
    })
  }

  for (const a of [...attendance].sort((x, y) => y.date.localeCompare(x.date)).slice(0, 2)) {
    const student = students.find((s) => s.id === a.studentId)
    events.push({
      id: `act-att-${a.id}`,
      title: 'Attendance recorded',
      detail: `${student ? `${student.firstName} ${student.lastName}` : a.studentId} · ${a.status}`,
      at: `${a.date}T08:00:00`,
    })
  }

  if (staff[0]) {
    events.push({
      id: `act-staff-${staff[0].id}`,
      title: 'Staff directory ready',
      detail: `${staff.length} staff record(s) in Firestore`,
      at: new Date().toISOString(),
    })
  }

  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)
}

type AttendanceRecordLike = {
  id: string
  date: string
  studentId: string
  status: string
}
