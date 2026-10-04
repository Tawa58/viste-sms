import type {
  AttendanceRecord,
  Guardian,
  InventoryItem,
  Invoice,
  Mark,
  Payment,
  Staff,
  StaffLoginCredential,
  Student,
} from '@/types'
import type { DashboardService, StudentService } from '@/services/api/contracts'
import { buildLiveDashboard } from '@/services/firestore/live-dashboard'
import { firestoreSchool } from '@/services/firestore/school-repository'

class FirestoreStudentService implements StudentService {
  async list(opts?: { classId?: string }) {
    await firestoreSchool.ensureSchoolCatalog()
    const rows = await firestoreSchool.listStudents()
    return opts?.classId ? rows.filter((s) => s.classId === opts.classId) : rows
  }
  async getById(id: string) {
    await firestoreSchool.ensureSchoolCatalog()
    return firestoreSchool.getStudent(id)
  }
  async create(input: Omit<Student, 'id'>) {
    await firestoreSchool.ensureSchoolCatalog()
    return firestoreSchool.createStudent(input)
  }
  async update(id: string, patch: Partial<Omit<Student, 'id'>>) {
    return firestoreSchool.updateStudent(id, patch)
  }
  async archive(id: string) {
    const { apiStudentService } = await import('@/services/api/server-api-services')
    return apiStudentService.archive!(id)
  }
  async remove(id: string) {
    const { apiStudentService } = await import('@/services/api/server-api-services')
    return apiStudentService.remove!(id)
  }
  async listScholarships(studentId: string) {
    const { apiStudentService } = await import('@/services/api/server-api-services')
    return apiStudentService.listScholarships!(studentId)
  }
  async createScholarship(
    studentId: string,
    input: Omit<
      import('@/types').StudentScholarship,
      'id' | 'studentId' | 'active' | 'createdBy' | 'createdByName' | 'createdAt'
    >,
  ) {
    const { apiStudentService } = await import('@/services/api/server-api-services')
    return apiStudentService.createScholarship!(studentId, input)
  }
  async deactivateScholarship(studentId: string, scholarshipId: string) {
    const { apiStudentService } = await import('@/services/api/server-api-services')
    return apiStudentService.deactivateScholarship!(studentId, scholarshipId)
  }
}

class FirestoreDashboardService implements DashboardService {
  async getStats() {
    return (await buildLiveDashboard()).stats
  }
  async getEnrollmentTrend() {
    return (await buildLiveDashboard()).enrollment
  }
  async getAttendanceOverview() {
    return (await buildLiveDashboard()).attendanceOverview
  }
  async getFeeCollection() {
    return (await buildLiveDashboard()).feeCollection
  }
  async getPerformance() {
    return (await buildLiveDashboard()).performance
  }
  async getRecentPayments() {
    return (await buildLiveDashboard()).recentPayments
  }
  async getRecentActivities() {
    return (await buildLiveDashboard()).recentActivities
  }
}

export const firestoreStudentService: StudentService = new FirestoreStudentService()
export const firestoreDashboardService: DashboardService = new FirestoreDashboardService()

export const firestoreCatalogService = {
  async getYears() {
    await firestoreSchool.ensureSchoolCatalog()
    return firestoreSchool.listYears()
  },
  async getTerms() {
    await firestoreSchool.ensureSchoolCatalog()
    return []
  },
  async getClasses() {
    await firestoreSchool.ensureSchoolCatalog()
    return firestoreSchool.listClasses()
  },
  async getStreams() {
    await firestoreSchool.ensureSchoolCatalog()
    return firestoreSchool.listStreams()
  },
  async getSubjects() {
    await firestoreSchool.ensureSchoolCatalog()
    return firestoreSchool.listSubjects()
  },
  async getSports() {
    return [] as import('@/types').Sport[]
  },
  async getClubs() {
    return [] as import('@/types').ClubActivity[]
  },
  async getHouses() {
    return [] as import('@/types').House[]
  },
  async getStaff() {
    await firestoreSchool.ensureSchoolCatalog()
    return firestoreSchool.listStaff()
  },
  async getStaffMember(id: string) {
    return firestoreSchool.getStaff(id)
  },
  async createStaff(input: Omit<Staff, 'id'> & { password?: string }) {
    const { password, ...rest } = input
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters')
    }
    const created = await firestoreSchool.createStaff(rest)
    const { createFirebaseAuthUser } = await import('@/services/firebase/auth-service')
    const { setDoc, doc } = await import('firebase/firestore')
    const { getFirestoreDb } = await import('@/services/firebase/app')

    const authUser = await createFirebaseAuthUser({
      email: created.email,
      password,
      displayName: `${created.firstName} ${created.lastName}`,
    })

    await setDoc(doc(getFirestoreDb(), 'users', authUser.uid), {
      id: authUser.uid,
      name: `${created.firstName} ${created.lastName}`,
      email: created.email.toLowerCase(),
      role: 'TEACHER',
      title: created.title,
      department: created.department,
      employeeNumber: created.employeeNumber,
      staffId: created.id,
      phone: created.phone,
      preferredLanguage: 'en',
      timezone: 'Africa/Harare',
      notificationPrefs: { email: true, sms: false, inApp: true },
    })

    await setDoc(doc(getFirestoreDb(), 'staffCredentials', created.id), {
      staffId: created.id,
      email: created.email.toLowerCase(),
      password,
      role: 'TEACHER',
      temporaryPassword: true,
      lastResetAt: new Date().toISOString().slice(0, 10),
      authUid: authUser.uid,
    })

    return created
  },
  async updateStaffPhoto(
    id: string,
    patch: { profilePhotoId?: string | null; photoUrl?: string | null },
  ) {
    const next: Partial<Staff> = {}
    if (patch.profilePhotoId) next.profilePhotoId = patch.profilePhotoId
    if (patch.profilePhotoId === null) {
      next.profilePhotoId = undefined
      next.photoUrl = undefined
    }
    // Never keep ephemeral blob preview URLs on the staff record.
    if (patch.photoUrl && !patch.photoUrl.startsWith('blob:') && !patch.photoUrl.startsWith('data:')) {
      next.photoUrl = patch.photoUrl
    }
    if (patch.photoUrl === null) next.photoUrl = undefined
    return firestoreSchool.updateStaff(id, next)
  },
  async getGuardians() {
    return firestoreSchool.listGuardians()
  },
  async getGuardian(id: string) {
    return firestoreSchool.getGuardian(id)
  },
  async updateGuardian(id: string, patch: Partial<Omit<Guardian, 'id'>>) {
    return firestoreSchool.updateGuardian(id, patch)
  },
  async deleteGuardian(id: string) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.deleteGuardian(id)
  },
  async createGuardian(input: Omit<Guardian, 'id'>) {
    return firestoreSchool.createGuardian(input)
  },
  async getStaffCredentials(): Promise<StaffLoginCredential[]> {
    const { getDocs, collection } = await import('firebase/firestore')
    const { getFirestoreDb } = await import('@/services/firebase/app')
    const snap = await getDocs(collection(getFirestoreDb(), 'staffCredentials'))
    return snap.docs.map((d) => {
      const data = d.data() as StaffLoginCredential
      return { ...data, staffId: data.staffId ?? d.id }
    })
  },
  async getStaffCredential(staffId: string): Promise<StaffLoginCredential | undefined> {
    const { getDoc, doc } = await import('firebase/firestore')
    const { getFirestoreDb } = await import('@/services/firebase/app')
    const snap = await getDoc(doc(getFirestoreDb(), 'staffCredentials', staffId))
    if (!snap.exists()) return undefined
    return { staffId, ...snap.data() } as StaffLoginCredential
  },
  async getStaffAccess(staffId: string) {
    const {
      listPermissions,
      TEACHER_ASSIGNABLE_PERMISSIONS,
      TEACHER_PERMISSION_GROUPS,
      resolveEffectivePermissions,
    } = await import('@/server/authorization/rbac-map')
    const member = await firestoreSchool.getStaff(staffId)
    if (!member) throw new Error('Staff not found')
    const overrides = member.permissionOverrides ?? {}
    const effective = resolveEffectivePermissions('TEACHER', overrides)
    const assignable = [...TEACHER_ASSIGNABLE_PERMISSIONS]
    return {
      staffId,
      roleDefaults: listPermissions('TEACHER'),
      assignable,
      groups: TEACHER_PERMISSION_GROUPS.map((g) => ({
        label: g.label,
        permissions: [...g.permissions],
      })),
      overrides,
      effective,
      selected: assignable.filter((p) => effective.includes(p)),
    }
  },
  async updateStaffAccess(staffId: string, permissions: string[]) {
    const { overridesFromTeacherSelection } = await import('@/server/authorization/rbac-map')
    const { setDoc, doc, getDoc } = await import('firebase/firestore')
    const { getFirestoreDb } = await import('@/services/firebase/app')
    const ref = doc(getFirestoreDb(), 'staff', staffId)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error('Staff not found')
    const overrides = overridesFromTeacherSelection(permissions)
    await setDoc(
      ref,
      {
        ...snap.data(),
        permissionOverrides: {
          grant: overrides.grant ?? [],
          deny: overrides.deny ?? [],
        },
      },
      { merge: true },
    )
    return this.getStaffAccess(staffId)
  },
  async resetStaffPassword(staffId: string, password?: string): Promise<StaffLoginCredential> {
    const member = await firestoreSchool.getStaff(staffId)
    if (!member) throw new Error('Staff member not found')
    const nextPassword =
      password && password.length >= 8
        ? password
        : `Vhs-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`

    const { setDoc, doc, getDoc } = await import('firebase/firestore')
    const { getFirestoreDb } = await import('@/services/firebase/app')
    const existing = await getDoc(doc(getFirestoreDb(), 'staffCredentials', staffId))
    const row: StaffLoginCredential = {
      staffId,
      email: member.email.toLowerCase(),
      password: nextPassword,
      role: 'TEACHER',
      temporaryPassword: true,
      lastResetAt: new Date().toISOString().slice(0, 10),
    }
    await setDoc(doc(getFirestoreDb(), 'staffCredentials', staffId), {
      ...existing.data(),
      ...row,
    })
    // Note: updating Firebase Auth password requires Admin SDK / Cloud Function.
    // Stored credential is what admins retrieve until Admin SDK is added.
    return row
  },
  async getAttendance(opts?: {
    date?: string
    classId?: string
    kind?: 'DAILY' | 'PERIOD'
  }): Promise<AttendanceRecord[]> {
    // Client Firestore path: prefer server API when available
    try {
      const { apiCatalogService } = await import('@/services/api/server-api-services')
      return apiCatalogService.getAttendance(opts)
    } catch {
      return firestoreSchool.listAttendance()
    }
  },
  async getAttendanceSessions(opts?: { date?: string; classId?: string }) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getAttendanceSessions(opts)
  },
  async submitDailyRegister(input: {
    date: string
    classId: string
    entries: {
      studentId: string
      streamId: string
      status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'
    }[]
  }) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.submitDailyRegister(input)
  },
  async getInvoices(): Promise<Invoice[]> {
    return firestoreSchool.listInvoices()
  },
  async getPayments(): Promise<Payment[]> {
    return firestoreSchool.listPayments()
  },
  async getMarks(): Promise<Mark[]> {
    return firestoreSchool.listMarks()
  },
  async getAssessments() {
    return firestoreSchool.listAssessments()
  },
  async getExaminations() {
    return []
  },
  async getFeeStructures() {
    return []
  },
  async getAnnouncements() {
    return []
  },
  async getNotifications() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getNotifications()
  },
  async markNotificationRead(id: string) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.markNotificationRead(id)
  },
  async markAllNotificationsRead() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.markAllNotificationsRead()
  },
  async getBooks() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getBooks()
  },
  async createBook(input: Omit<import('@/types').LibraryBook, 'id' | 'available'>) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.createBook(input)
  },
  async getLoans() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getLoans()
  },
  async createLoan(input: {
    bookId: string
    studentId: string
    dueAt: string
    borrowerPhone?: string
    notes?: string
  }) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.createLoan(input)
  },
  async returnLoan(id: string) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.returnLoan(id)
  },
  async getInventory() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getInventory()
  },
  async createInventoryItem(input: Partial<InventoryItem>) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.createInventoryItem(input)
  },
  async updateInventoryItem(id: string, patch: Partial<InventoryItem>) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.updateInventoryItem(id, patch)
  },
  async deleteInventoryItem(id: string) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.deleteInventoryItem(id)
  },
  async getTransport() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getTransport()
  },
  async getTransportVehicles() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getTransportVehicles()
  },
  async getTransportRiders() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getTransportRiders()
  },
  async getTransportPayments() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getTransportPayments()
  },
  async createTransportRoute(input: Record<string, unknown>) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.createTransportRoute(input)
  },
  async updateTransportRoute(id: string, patch: Record<string, unknown>) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.updateTransportRoute(id, patch)
  },
  async deleteTransportRoute(id: string) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.deleteTransportRoute(id)
  },
  async createTransportVehicle(input: Record<string, unknown>) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.createTransportVehicle(input)
  },
  async updateTransportVehicle(id: string, patch: Record<string, unknown>) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.updateTransportVehicle(id, patch)
  },
  async createTransportRider(input: Record<string, unknown>) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.createTransportRider(input)
  },
  async updateTransportRider(id: string, patch: Record<string, unknown>) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.updateTransportRider(id, patch)
  },
  async createTransportPayment(input: Record<string, unknown>) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.createTransportPayment(input)
  },
  async getUsers() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getUsers()
  },
  async createUser(input: {
    name: string
    email: string
    password: string
    role: string
    title?: string
  }) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.createUser(input)
  },
  async updateUser(
    id: string,
    patch: { name?: string; role?: string; status?: 'ACTIVE' | 'DISABLED'; title?: string },
  ) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.updateUser(id, patch)
  },
  async getRolePermissions() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getRolePermissions()
  },
  async updateRolePermissions(input: { role: string; permissions: string[] }) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.updateRolePermissions(input)
  },
  async getPermissionCatalog() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getPermissionCatalog()
  },
  async getAuditLogs() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getAuditLogs()
  },
  async getResultPortals() {
    return []
  },
  async getResultPortal(studentId: string) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getResultPortal(studentId)
  },
  async submitMonthlyMarks(input: {
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
  }) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.submitMonthlyMarks(input)
  },
  async submitClassSubjectMarks(input: {
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
  }) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.submitClassSubjectMarks(input)
  },
  async transitionAssessment(input: {
    assessmentId: string
    status: 'SUBMITTED' | 'APPROVED' | 'PUBLISHED' | 'LOCKED'
    releaseToPortal?: boolean
  }) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.transitionAssessment(input)
  },
  async getGradingScale() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getGradingScale()
  },
  async updateGradingScale(input: {
    track: import('@/types').GradingTrack
    passMark: number
    bands: { grade: string; minPercent: number; maxPercent: number }[]
  }) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.updateGradingScale(input)
  },
  async getSchoolProfile() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getSchoolProfile()
  },
  async updateSchoolProfile(
    input: Omit<import('@/types').SchoolProfile, 'id' | 'updatedAt' | 'updatedBy'>,
  ) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.updateSchoolProfile(input)
  },
  async getFeePolicy() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getFeePolicy()
  },
  async billTerm(termId?: string) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.billTerm(termId)
  },
  async billCurrentMonth(studentId: string) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.billCurrentMonth(studentId)
  },
  async recordPayment(input: import('@/types').RecordPaymentInput) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.recordPayment(input)
  },
  async reversePayment(id: string) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.reversePayment(id)
  },
  async updateFeePolicy(
    input: Omit<import('@/types').FeePolicy, 'id' | 'updatedAt' | 'updatedBy'>,
  ) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.updateFeePolicy(input)
  },
  async getAcademicSettings() {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.getAcademicSettings()
  },
  async updateAcademicSettings(input: {
    year: import('@/types').AcademicYear
    terms: Pick<import('@/types').Term, 'id' | 'name' | 'sequence' | 'startDate' | 'endDate'>[]
  }) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.updateAcademicSettings(input)
  },
  async updateStaff(id: string, patch: Partial<import('@/types').Staff>) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.updateStaff(id, patch)
  },
  async deleteStaff(id: string) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.deleteStaff(id)
  },
  async suspendStaff(staffId: string, input: { reason: string; endsAt?: string | null }) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.suspendStaff(staffId, input)
  },
  async reactivateStaff(staffId: string) {
    const { apiCatalogService } = await import('@/services/api/server-api-services')
    return apiCatalogService.reactivateStaff(staffId)
  },
}
