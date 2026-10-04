/**
 * Server-backed school data via Next.js /api/v1 (Firebase Admin).
 * Preserves existing service interfaces so UI views stay unchanged.
 */
import {
  apiFetch,
  isApiClientError,
  isForbiddenOrUnauthorized,
  seedApiCache,
} from '@/services/api/http-client'
import type { AuthService, DashboardService, StudentService } from '@/services/api/contracts'
import type {
  Announcement,
  Assessment,
  AttendanceRecord,
  AuditLog,
  AuthUser,
  ClassTransfer,
  ClubActivity,
  ClassResultsPeriod,
  ClassResultsSummary,
  ClassTeacherReport,
  DutyRoster,
  DutyRosterEntry,
  Examination,
  FeeStructure,
  Guardian,
  House,
  InventoryItem,
  Invoice,
  LibraryBook,
  LibraryLoan,
  Mark,
  Payment,
  RecordPaymentInput,
  RecordPaymentResult,
  ResultPortalView,
  RolePermission,
  SchoolClass,
  Sport,
  Staff,
  StaffLoginCredential,
  Stream,
  Student,
  StudentClassStats,
  StudentExemption,
  StudentScholarship,
  StudentPortalAccess,
  StudentPortalBatchRow,
  Subject,
  Term,
  AcademicYear,
  TransportPayment,
  TransportRider,
  TransportRoute,
  TransportVehicle,
  AppUser,
} from '@/types'
import { demoCredentials } from '@/mocks/data'
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  updateProfile,
} from 'firebase/auth'
import { getFirebaseAuth } from '@/services/firebase/app'
import { isStudentNumberIdentifier, studentPortalEmail } from '@/lib/student-portal'

export class ApiAuthService implements AuthService {
  async login(email: string, password: string) {
    const isStudent = isStudentNumberIdentifier(email)
    try {
      await signInWithEmailAndPassword(
        getFirebaseAuth(),
        isStudent ? studentPortalEmail(email) : email.trim().toLowerCase(),
        isStudent ? password.trim() : password,
      )
    } catch (err) {
      const code = (err as { code?: string }).code
      if (
        isStudent &&
        (code === 'auth/invalid-credential' ||
          code === 'auth/wrong-password' ||
          code === 'auth/user-not-found' ||
          code === 'auth/invalid-email')
      ) {
        throw new Error('Invalid student number or portal code')
      }
      if (isStudent && code === 'auth/user-disabled') {
        throw new Error('Your portal access has been revoked. Please contact the school office.')
      }
      throw err
    }
    try {
      const me = await this.session()
      void apiFetch('/api/v1/auth/activity', {
        method: 'POST',
        body: JSON.stringify({ event: 'login' }),
      }).catch(() => undefined)
      return me.user
    } catch (err) {
      await signOut(getFirebaseAuth()).catch(() => undefined)
      throw err
    }
  }

  async logout() {
    try {
      await apiFetch('/api/v1/auth/activity', {
        method: 'POST',
        body: JSON.stringify({ event: 'logout' }),
      })
    } catch {
      /* still sign out locally */
    }
    await signOut(getFirebaseAuth())
  }

  getDemoCredentials() {
    return demoCredentials
  }

  async session() {
    return apiFetch<{ user: AuthUser; permissions: string[] }>('/api/v1/auth/me')
  }

  async me() {
    const me = await this.session()
    return me.user
  }

  async updateProfile(userId: string, patch: Partial<AuthUser>) {
    if (getFirebaseAuth().currentUser && patch.name) {
      await updateProfile(getFirebaseAuth().currentUser!, { displayName: patch.name })
    }
    const res = await apiFetch<{ user: AuthUser }>('/api/v1/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    return res.user
  }

  async changePassword(currentPassword: string, nextPassword: string) {
    const auth = getFirebaseAuth()
    const user = auth.currentUser
    if (!user?.email) throw new Error('Not signed in')
    const credential = EmailAuthProvider.credential(user.email, currentPassword)
    await reauthenticateWithCredential(user, credential)
    await updatePassword(user, nextPassword)
    await apiFetch<{ cleared: boolean }>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ acknowledge: true }),
    })
  }

  async requestPasswordReset(email: string) {
    const normalized = email.trim().toLowerCase()
    if (!normalized) throw new Error('Email is required')
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), normalized)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'auth/user-not-found' && code !== 'auth/invalid-email') {
        throw err instanceof Error ? err : new Error('Could not send reset email')
      }
    }
    // Public endpoint — no auth token (user is on the login screen).
    try {
      await fetch('/api/v1/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      })
    } catch {
      /* best-effort sheet clear */
    }
  }
}

export const apiStudentService: StudentService = {
  list: (opts) => {
    const q = opts?.classId ? `?classId=${encodeURIComponent(opts.classId)}` : ''
    return apiFetch<Student[]>(`/api/v1/students${q}`)
  },
  getById: async (id) => {
    try {
      return await apiFetch<Student>(`/api/v1/students/${id}`)
    } catch (e) {
      if (e instanceof Error && 'status' in e && (e as { status: number }).status === 404) {
        return undefined
      }
      throw e
    }
  },
  create: (input) =>
    apiFetch<Student>('/api/v1/students', { method: 'POST', body: JSON.stringify(input) }),
  update: (id, patch) =>
    apiFetch<Student>(`/api/v1/students/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  archive: (id) =>
    apiFetch<Student>(`/api/v1/students/${id}?mode=archive`, { method: 'DELETE' }),
  remove: (id) =>
    apiFetch<{ deleted: true; id: string }>(`/api/v1/students/${id}`, { method: 'DELETE' }),
  transfer: (input) =>
    apiFetch<{ student: Student; transfer: ClassTransfer }>('/api/v1/students/transfer', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listTransfers: (studentId) =>
    apiFetch<ClassTransfer[]>(`/api/v1/students/${studentId}/transfers`),
  listExemptions: (studentId) =>
    apiFetch<StudentExemption[]>(`/api/v1/students/${studentId}/exemptions`),
  createExemption: (studentId, input) =>
    apiFetch<StudentExemption>(`/api/v1/students/${studentId}/exemptions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deactivateExemption: (studentId, exemptionId) =>
    apiFetch<StudentExemption>(`/api/v1/students/${studentId}/exemptions`, {
      method: 'PATCH',
      body: JSON.stringify({ id: exemptionId }),
    }),
  listScholarships: (studentId) =>
    apiFetch<StudentScholarship[]>(`/api/v1/students/${studentId}/scholarships`),
  createScholarship: (studentId, input) =>
    apiFetch<StudentScholarship>(`/api/v1/students/${studentId}/scholarships`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deactivateScholarship: (studentId, scholarshipId) =>
    apiFetch<StudentScholarship>(
      `/api/v1/students/${studentId}/scholarships/${scholarshipId}`,
      { method: 'PATCH' },
    ),
  getPortalAccess: (studentId) =>
    apiFetch<StudentPortalAccess>(`/api/v1/students/${studentId}/portal-access`, {
      skipCache: true,
    }),
  issuePortalCode: (studentId) =>
    apiFetch<StudentPortalAccess>(`/api/v1/students/${studentId}/portal-access`, {
      method: 'POST',
    }),
  revokePortalAccess: (studentId) =>
    apiFetch<StudentPortalAccess>(`/api/v1/students/${studentId}/portal-access`, {
      method: 'DELETE',
    }),
  issuePortalCodesForClass: (classId) =>
    apiFetch<StudentPortalBatchRow[]>('/api/v1/students/portal-codes', {
      method: 'POST',
      body: JSON.stringify({ classId }),
    }),
}

type CatalogPayload = {
  years: AcademicYear[]
  terms: Term[]
  classes: SchoolClass[]
  streams: Stream[]
  subjects: Subject[]
  sports?: Sport[]
  clubs?: ClubActivity[]
  houses?: House[]
}

async function loadCatalogOnce(): Promise<CatalogPayload> {
  return apiFetch<CatalogPayload>('/api/v1/catalog')
}

export const apiClassService = {
  list: () => apiFetch<SchoolClass[]>('/api/v1/classes'),
  getStats: () => apiFetch<StudentClassStats>('/api/v1/classes?stats=1'),
  getById: (id: string) => apiFetch<SchoolClass>(`/api/v1/classes/${id}`),
  create: (
    input: Omit<SchoolClass, 'id' | 'level' | 'academicYearId'> & {
      educationLevelId: string
      academicYearId?: string
      termSequence?: 1 | 2 | 3
    },
  ) =>
    apiFetch<SchoolClass>('/api/v1/classes', { method: 'POST', body: JSON.stringify(input) }),
  update: (
    id: string,
    patch: Partial<SchoolClass> & { termSequence?: 1 | 2 | 3 },
  ) =>
    apiFetch<SchoolClass>(`/api/v1/classes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  archive: (id: string) =>
    apiFetch<SchoolClass>(`/api/v1/classes/${id}?mode=archive`, { method: 'DELETE' }),
  remove: (id: string) =>
    apiFetch<{ deleted: true; id: string }>(`/api/v1/classes/${id}`, { method: 'DELETE' }),
  getTeacherReports: (classId: string, termId: string) =>
    apiFetch<ClassTeacherReport[]>(
      `/api/v1/classes/${encodeURIComponent(classId)}/teacher-reports?termId=${encodeURIComponent(termId)}`,
    ),
  saveTeacherReports: (
    classId: string,
    input: { termId: string; entries: { studentId: string; comment: string }[] },
  ) =>
    apiFetch<ClassTeacherReport[]>(
      `/api/v1/classes/${encodeURIComponent(classId)}/teacher-reports`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),
  getResultsSummary: (
    classId: string,
    query: { period: ClassResultsPeriod; termId?: string; month?: string },
  ) => {
    const params = new URLSearchParams({ period: query.period })
    if (query.termId) params.set('termId', query.termId)
    if (query.month) params.set('month', query.month)
    return apiFetch<ClassResultsSummary>(
      `/api/v1/classes/${encodeURIComponent(classId)}/results-summary?${params}`,
      { skipCache: true },
    )
  },
  getDutyRoster: (classId: string, weekOf: string) =>
    apiFetch<DutyRoster | null>(
      `/api/v1/classes/${encodeURIComponent(classId)}/duty-roster?weekOf=${encodeURIComponent(weekOf)}`,
    ),
  saveDutyRoster: (
    classId: string,
    input: { weekOf: string; entries: DutyRosterEntry[] },
  ) =>
    apiFetch<DutyRoster>(`/api/v1/classes/${encodeURIComponent(classId)}/duty-roster`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
}

export const apiSubjectAdminService = {
  list: () => apiFetch<Subject[]>('/api/v1/subjects'),
  create: (input: Omit<Subject, 'id'>) =>
    apiFetch<Subject>('/api/v1/subjects', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, patch: Partial<Subject>) =>
    apiFetch<Subject>(`/api/v1/subjects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  remove: (id: string) =>
    apiFetch<{ deleted: true; id: string }>(`/api/v1/subjects/${id}`, { method: 'DELETE' }),
}

export const apiExtracurricularService = {
  listSports: () => apiFetch<Sport[]>('/api/v1/sports'),
  createSport: (input: Omit<Sport, 'id'>) =>
    apiFetch<Sport>('/api/v1/sports', { method: 'POST', body: JSON.stringify(input) }),
  updateSport: (id: string, patch: Partial<Sport>) =>
    apiFetch<Sport>(`/api/v1/sports/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  listClubs: () => apiFetch<ClubActivity[]>('/api/v1/clubs'),
  createClub: (input: Omit<ClubActivity, 'id'>) =>
    apiFetch<ClubActivity>('/api/v1/clubs', { method: 'POST', body: JSON.stringify(input) }),
  updateClub: (id: string, patch: Partial<ClubActivity>) =>
    apiFetch<ClubActivity>(`/api/v1/clubs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  listHouses: () => apiFetch<House[]>('/api/v1/houses'),
  createHouse: (input: Omit<House, 'id'>) =>
    apiFetch<House>('/api/v1/houses', { method: 'POST', body: JSON.stringify(input) }),
  updateHouse: (id: string, patch: Partial<House>) =>
    apiFetch<House>(`/api/v1/houses/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
}

type DashboardPayload = {
  stats: Awaited<ReturnType<DashboardService['getStats']>>
  enrollment: { month: string; students: number }[]
  attendanceOverview: { name: string; value: number }[]
  feeCollection: { month: string; collected: number; outstanding: number }[]
  performance: { subject: string; average: number }[]
  recentPayments: Payment[]
  recentActivities: { id: string; title: string; detail: string; at: string }[]
}

async function loadDashboardOnce(): Promise<DashboardPayload> {
  return apiFetch<DashboardPayload>('/api/v1/dashboard')
}

export const apiDashboardService: DashboardService = {
  async getStats() {
    return (await loadDashboardOnce()).stats
  },
  async getEnrollmentTrend() {
    return (await loadDashboardOnce()).enrollment
  },
  async getAttendanceOverview() {
    return (await loadDashboardOnce()).attendanceOverview
  },
  async getFeeCollection() {
    return (await loadDashboardOnce()).feeCollection
  },
  async getPerformance() {
    return (await loadDashboardOnce()).performance
  },
  async getRecentPayments() {
    return (await loadDashboardOnce()).recentPayments
  },
  async getRecentActivities() {
    return (await loadDashboardOnce()).recentActivities
  },
}

export const apiCatalogService = {
  async getYears(): Promise<AcademicYear[]> {
    return (await loadCatalogOnce()).years
  },
  async getTerms(): Promise<Term[]> {
    return (await loadCatalogOnce()).terms ?? []
  },
  async getClasses(): Promise<SchoolClass[]> {
    return (await loadCatalogOnce()).classes
  },
  async getStreams(): Promise<Stream[]> {
    return (await loadCatalogOnce()).streams
  },
  async getSubjects(): Promise<Subject[]> {
    return (await loadCatalogOnce()).subjects
  },
  async getSports(): Promise<Sport[]> {
    return (await loadCatalogOnce()).sports ?? []
  },
  async getClubs(): Promise<ClubActivity[]> {
    return (await loadCatalogOnce()).clubs ?? []
  },
  async getHouses(): Promise<House[]> {
    return (await loadCatalogOnce()).houses ?? []
  },
  getStaff: () =>
    apiFetch<Staff[]>('/api/v1/teachers').catch((err) => {
      // Teachers never have teachers.read — treat as empty list, never crash UI.
      if (isForbiddenOrUnauthorized(err)) {
        seedApiCache('GET:/api/v1/teachers', [])
      } else {
        console.warn('[catalog] getStaff failed', err)
      }
      return [] as Staff[]
    }),
  getGuardians: () =>
    apiFetch<Guardian[]>('/api/v1/parents').catch((err) => {
      if (isForbiddenOrUnauthorized(err)) {
        seedApiCache('GET:/api/v1/parents', [])
      } else {
        console.warn('[catalog] getGuardians failed', err)
      }
      return [] as Guardian[]
    }),
  getGuardian: async (id: string) => {
    try {
      return await apiFetch<Guardian>(`/api/v1/parents/${id}`)
    } catch (err) {
      if (isForbiddenOrUnauthorized(err)) return undefined as unknown as Guardian
      console.warn('[catalog] getGuardian failed', err)
      return undefined as unknown as Guardian
    }
  },
  getStaffMember: async (id: string) => {
    try {
      return await apiFetch<Staff>(`/api/v1/teachers/${id}`)
    } catch (err) {
      if (
        isForbiddenOrUnauthorized(err) ||
        (isApiClientError(err) && err.status === 404)
      ) {
        return undefined as unknown as Staff
      }
      console.warn('[catalog] getStaffMember failed', err)
      return undefined as unknown as Staff
    }
  },
  updateStaff: (id: string, patch: Partial<Staff>) =>
    apiFetch<Staff>(`/api/v1/teachers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteStaff: (id: string) =>
    apiFetch<{ deleted: true; id: string }>(`/api/v1/teachers/${id}`, { method: 'DELETE' }),
  getStaffCredentials: () =>
    apiFetch<StaffLoginCredential[]>('/api/v1/teachers?credentials=1'),
  getStaffCredential: async (staffId: string) => {
    const all = await apiFetch<StaffLoginCredential[]>('/api/v1/teachers?credentials=1')
    return all.find((c) => c.staffId === staffId)
  },
  getStaffAccess: (staffId: string) =>
    apiFetch<{
      staffId: string
      role: import('@/types').StaffAccountRole
      roleDefaults: string[]
      assignable: string[]
      groups: { label: string; permissions: string[] }[]
      overrides: { grant?: string[]; deny?: string[] }
      effective: string[]
      selected: string[]
    }>(`/api/v1/teachers/${staffId}/access`),
  updateStaffAccess: (staffId: string, permissions: string[]) =>
    apiFetch<{
      staffId: string
      role: import('@/types').StaffAccountRole
      roleDefaults: string[]
      assignable: string[]
      groups: { label: string; permissions: string[] }[]
      overrides: { grant?: string[]; deny?: string[] }
      effective: string[]
      selected: string[]
    }>(`/api/v1/teachers/${staffId}/access`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
  resetStaffPassword: (staffId: string, password?: string) =>
    apiFetch<StaffLoginCredential>(`/api/v1/teachers/${staffId}/reset-password`, {
      method: 'POST',
      body: JSON.stringify(password ? { password } : {}),
    }),
  suspendStaff: (staffId: string, input: { reason: string; endsAt?: string | null }) =>
    apiFetch<Staff>(`/api/v1/teachers/${staffId}/suspension`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reactivateStaff: (staffId: string) =>
    apiFetch<Staff>(`/api/v1/teachers/${staffId}/suspension`, { method: 'DELETE' }),
  updateStaffPhoto: (id: string, patch: { profilePhotoId?: string | null; photoUrl?: string | null }) =>
    apiFetch<Staff>(`/api/v1/teachers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        profilePhotoId: patch.profilePhotoId ?? null,
      }),
    }),
  createStaff: (input: Omit<Staff, 'id'> & { password?: string }) =>
    apiFetch<Staff>('/api/v1/teachers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateGuardian: (id: string, patch: Partial<Omit<Guardian, 'id'>>) =>
    apiFetch<Guardian>(`/api/v1/parents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteGuardian: (id: string) =>
    apiFetch<{ deleted: true; id: string }>(`/api/v1/parents/${id}`, { method: 'DELETE' }),
  createGuardian: (input: Omit<Guardian, 'id'>) =>
    apiFetch<Guardian>('/api/v1/parents', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getAttendance: (opts?: { date?: string; classId?: string; kind?: 'DAILY' | 'PERIOD' }) => {
    const q = new URLSearchParams()
    if (opts?.date) q.set('date', opts.date)
    if (opts?.classId) q.set('classId', opts.classId)
    if (opts?.kind) q.set('kind', opts.kind)
    const suffix = q.toString() ? `?${q}` : ''
    return apiFetch<AttendanceRecord[]>(`/api/v1/attendance${suffix}`)
  },
  getAttendanceSessions: (opts?: { date?: string; classId?: string }) => {
    const q = new URLSearchParams({ sessions: '1' })
    if (opts?.date) q.set('date', opts.date)
    if (opts?.classId) q.set('classId', opts.classId)
    return apiFetch<import('@/types').AttendanceSession[]>(`/api/v1/attendance?${q}`)
  },
  submitDailyRegister: (input: {
    date: string
    classId: string
    entries: {
      studentId: string
      streamId: string
      status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'
    }[]
  }) =>
    apiFetch<{
      session: import('@/types').AttendanceSession
      records: AttendanceRecord[]
    }>('/api/v1/attendance', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  upsertAttendance: (input: {
    date: string
    studentId: string
    classId: string
    streamId: string
    status: AttendanceRecord['status']
    kind?: 'DAILY' | 'PERIOD'
    subjectId?: string
  }) =>
    apiFetch<AttendanceRecord>('/api/v1/attendance', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getExaminations: async (): Promise<Examination[]> => [],
  getAssessments: () => apiFetch<Assessment[]>('/api/v1/results?kind=assessments'),
  getMarks: () => apiFetch<Mark[]>('/api/v1/results?kind=marks'),
  submitClassSubjectMarks: (input: {
    classId: string
    subjectId: string
    periodType: 'DAILY' | 'MONTHLY' | 'WEEKLY' | 'MOCK' | 'TERMLY'
    date?: string
    month?: string
    weekOf?: string
    termId?: string
    maxScore?: number
    action: 'draft' | 'submit'
    entries: {
      studentId: string
      score: number
      commentMode?: 'NONE' | 'AUTO' | 'CUSTOM'
      comment?: string
    }[]
  }) =>
    apiFetch<{
      assessment: Assessment
      marks: Mark[]
    }>('/api/v1/results', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** @deprecated Prefer submitClassSubjectMarks */
  submitMonthlyMarks: (input: {
    classId: string
    subjectId: string
    month: string
    maxScore?: number
    publish?: boolean
    action?: 'draft' | 'submit'
    entries: {
      studentId: string
      score: number
      commentMode?: 'NONE' | 'AUTO' | 'CUSTOM'
      comment?: string
    }[]
  }) =>
    apiFetch<{
      assessment: Assessment
      marks: Mark[]
    }>('/api/v1/results', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  transitionAssessment: (input: {
    assessmentId: string
    status: 'SUBMITTED' | 'APPROVED' | 'PUBLISHED' | 'LOCKED'
    releaseToPortal?: boolean
  }) =>
    apiFetch<Assessment>('/api/v1/results', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  upsertMark: (input: {
    assessmentId: string
    studentId: string
    score: number
    grade?: string
    commentMode?: 'NONE' | 'AUTO' | 'CUSTOM'
    comment?: string
  }) =>
    apiFetch<Mark>('/api/v1/results', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getGradingScale: () =>
    apiFetch<import('@/types').GradingScalesBundle>('/api/v1/grading'),
  updateGradingScale: (input: {
    track: import('@/types').GradingTrack
    passMark: number
    bands: import('@/types').GradeBand[]
  }) =>
    apiFetch<import('@/types').GradingScalesBundle>('/api/v1/grading', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  getSchoolProfile: () =>
    apiFetch<import('@/types').SchoolProfile>('/api/v1/settings/school'),
  updateSchoolProfile: (input: Omit<import('@/types').SchoolProfile, 'id' | 'updatedAt' | 'updatedBy'>) =>
    apiFetch<import('@/types').SchoolProfile>('/api/v1/settings/school', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  getFeePolicy: () => apiFetch<import('@/types').FeePolicy>('/api/v1/settings/fees'),
  updateFeePolicy: (input: Omit<import('@/types').FeePolicy, 'id' | 'updatedAt' | 'updatedBy'>) =>
    apiFetch<import('@/types').FeePolicy>('/api/v1/settings/fees', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  getAcademicSettings: () =>
    apiFetch<{
      year: import('@/types').AcademicYear
      terms: import('@/types').Term[]
      years: import('@/types').AcademicYear[]
    }>('/api/v1/settings/academic'),
  updateAcademicSettings: (input: {
    year: import('@/types').AcademicYear
    terms: Pick<import('@/types').Term, 'id' | 'name' | 'sequence' | 'startDate' | 'endDate'>[]
  }) =>
    apiFetch<{
      year: import('@/types').AcademicYear
      terms: import('@/types').Term[]
      years: import('@/types').AcademicYear[]
    }>('/api/v1/settings/academic', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  acknowledgePasswordChanged: () =>
    apiFetch<{ cleared: boolean }>('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ acknowledge: true }),
    }),
  getFeeStructures: async (): Promise<FeeStructure[]> => [],
  getInvoices: () => apiFetch<Invoice[]>('/api/v1/invoices'),
  getPayments: () => apiFetch<Payment[]>('/api/v1/payments'),
  billTerm: (termId?: string) =>
    apiFetch<import('@/types').TermBillingResult>('/api/v1/invoices', {
      method: 'POST',
      body: JSON.stringify(termId ? { termId } : {}),
    }),
  billCurrentMonth: (studentId: string) =>
    apiFetch<import('@/types').TermBillingResult>('/api/v1/invoices', {
      method: 'POST',
      body: JSON.stringify({ studentId, currentMonthOnly: true }),
    }),
  recordPayment: (input: RecordPaymentInput) =>
    apiFetch<RecordPaymentResult>('/api/v1/payments', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reversePayment: (id: string) =>
    apiFetch<Payment>(`/api/v1/payments/${id}/reverse`, { method: 'POST' }),
  getAnnouncements: () => apiFetch<Announcement[]>('/api/v1/announcements'),
  getNotifications: () =>
    apiFetch<import('@/types').AppNotification[]>('/api/v1/notifications', {
      cacheTtlMs: 15_000,
    }),
  markNotificationRead: (id: string) =>
    apiFetch<import('@/types').AppNotification | null>('/api/v1/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ id }),
    }),
  markAllNotificationsRead: () =>
    apiFetch<{ marked: number }>('/api/v1/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ markAllRead: true }),
    }),
  getBooks: () => apiFetch<LibraryBook[]>('/api/v1/library/books'),
  createBook: (input: Omit<LibraryBook, 'id' | 'available'>) =>
    apiFetch<LibraryBook>('/api/v1/library/books', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getLoans: () => apiFetch<LibraryLoan[]>('/api/v1/library/loans'),
  createLoan: (input: { bookId: string; studentId: string; dueAt: string; borrowerPhone?: string; notes?: string }) =>
    apiFetch<LibraryLoan>('/api/v1/library/loans', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  returnLoan: (id: string) =>
    apiFetch<LibraryLoan>(`/api/v1/library/loans/${encodeURIComponent(id)}`, {
      method: 'PATCH',
    }),
  getInventory: () => apiFetch<InventoryItem[]>('/api/v1/inventory'),
  createInventoryItem: (input: Partial<InventoryItem>) =>
    apiFetch<InventoryItem>('/api/v1/inventory', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateInventoryItem: (id: string, patch: Partial<InventoryItem>) =>
    apiFetch<InventoryItem>(`/api/v1/inventory/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteInventoryItem: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/inventory/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getTransport: () => apiFetch<TransportRoute[]>('/api/v1/transport?kind=routes'),
  getTransportVehicles: () =>
    apiFetch<TransportVehicle[]>('/api/v1/transport?kind=vehicles'),
  getTransportRiders: () => apiFetch<TransportRider[]>('/api/v1/transport?kind=riders'),
  getTransportPayments: () =>
    apiFetch<TransportPayment[]>('/api/v1/transport?kind=payments'),
  createTransportRoute: (input: Record<string, unknown>) =>
    apiFetch<TransportRoute>('/api/v1/transport', {
      method: 'POST',
      body: JSON.stringify({ kind: 'route', ...input }),
    }),
  updateTransportRoute: (id: string, patch: Record<string, unknown>) =>
    apiFetch<TransportRoute>(`/api/v1/transport/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'route', ...patch }),
    }),
  deleteTransportRoute: (id: string) =>
    apiFetch<{ ok: boolean }>(`/api/v1/transport/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  createTransportVehicle: (input: Record<string, unknown>) =>
    apiFetch<TransportVehicle>('/api/v1/transport', {
      method: 'POST',
      body: JSON.stringify({ kind: 'vehicle', ...input }),
    }),
  updateTransportVehicle: (id: string, patch: Record<string, unknown>) =>
    apiFetch<TransportVehicle>(`/api/v1/transport/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'vehicle', ...patch }),
    }),
  createTransportRider: (input: Record<string, unknown>) =>
    apiFetch<TransportRider>('/api/v1/transport', {
      method: 'POST',
      body: JSON.stringify({ kind: 'rider', ...input }),
    }),
  updateTransportRider: (id: string, patch: Record<string, unknown>) =>
    apiFetch<TransportRider>(`/api/v1/transport/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'rider', ...patch }),
    }),
  createTransportPayment: (input: Record<string, unknown>) =>
    apiFetch<TransportPayment>('/api/v1/transport', {
      method: 'POST',
      body: JSON.stringify({ kind: 'payment', ...input }),
    }),
  getUsers: () => apiFetch<AppUser[]>('/api/v1/users'),
  createUser: (input: {
    name: string
    email: string
    password: string
    role: string
    title?: string
  }) =>
    apiFetch<AppUser>('/api/v1/users', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateUser: (
    id: string,
    patch: { name?: string; role?: string; status?: 'ACTIVE' | 'DISABLED'; title?: string },
  ) =>
    apiFetch<AppUser>(`/api/v1/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  getRolePermissions: () => apiFetch<RolePermission[]>('/api/v1/roles'),
  updateRolePermissions: (input: { role: string; permissions: string[] }) =>
    apiFetch<RolePermission>('/api/v1/roles', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  getPermissionCatalog: async () =>
    apiFetch<RolePermission[]>('/api/v1/roles').then((roles) => {
      const set = new Set<string>()
      for (const r of roles) for (const p of r.permissions) set.add(p)
      return [...set].sort()
    }),
  getAuditLogs: () => apiFetch<AuditLog[]>('/api/v1/audit-logs'),
  getResultPortals: async (): Promise<ResultPortalView[]> => [],
  getResultPortal: (studentId: string) =>
    apiFetch<ResultPortalView>(`/api/v1/results?studentId=${encodeURIComponent(studentId)}`),
}
