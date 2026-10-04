import {
  announcements,
  appUsers,
  assessments,
  attendanceOverview,
  attendanceRecords,
  auditLogs,
  classes,
  dashboardStats,
  demoCredentials,
  enrollmentTrend,
  examinations,
  feeCollectionSeries,
  feeStructures,
  guardians,
  inventoryItems,
  invoices,
  libraryBooks,
  libraryLoans,
  marks,
  mockUsers,
  payments,
  performanceSeries,
  permissionCatalog,
  recentActivities,
  resultPortals,
  rolePermissions,
  staff,
  staffCredentials,
  streams,
  students,
  subjects,
  terms,
  academicYears,
  transportRoutes,
  transportVehicles,
  transportRiders,
  transportPayments,
} from '@/mocks/data'
import type {
  Announcement,
  AppUser,
  Assessment,
  AttendanceRecord,
  AuditLog,
  AuthUser,
  Examination,
  FeeStructure,
  Guardian,
  InventoryItem,
  Invoice,
  LibraryBook,
  LibraryLoan,
  Mark,
  Payment,
  ResultPortalView,
  RolePermission,
  SchoolClass,
  Staff,
  StaffLoginCredential,
  Stream,
  Student,
  StudentScholarship,
  Subject,
  Term,
  AcademicYear,
  TransportRoute,
  TransportRider,
  TransportPayment,
  TransportVehicle,
} from '@/types'
import { mockRequest, USE_MOCK_API } from './client'
import type { AuthService, DashboardService, StudentService } from './contracts'
import {
  firestoreCatalogService,
  firestoreDashboardService,
  firestoreStudentService,
} from '@/services/firestore/firestore-services'
import { FirebaseAuthService } from '@/services/firebase/auth-service'
import {
  ApiAuthService,
  apiCatalogService,
  apiClassService,
  apiDashboardService,
  apiExtracurricularService,
  apiStudentService,
  apiSubjectAdminService,
} from '@/services/api/server-api-services'

import { readPublicEnv } from '@/lib/env'
import {
  DEFAULT_MONTHS_PER_TERM,
  feeAmountFor,
  feeCategoryFor,
  monthlyInstalments,
  monthlyInvoiceId,
  normalizeFeeSchedule,
  scholarshipAdjustedFeeAmount,
} from '@/lib/fees'
import { defaultAccountRoleForCategory } from '@/lib/staff-categories'

const mockScholarships: StudentScholarship[] = []

let mockFeePolicy: import('@/types').FeePolicy = {
  id: 'feePolicy',
  currency: 'USD',
  receiptPrefix: 'VHS',
  nextReceiptNumber: 1001,
  blockResultsWhenFeesOutstanding: true,
  overdueGraceDays: 14,
  fees: normalizeFeeSchedule(null),
  monthsPerTerm: DEFAULT_MONTHS_PER_TERM,
}

/**
 * Live mode uses Next.js /api/v1 (Firebase Admin) — server is authority.
 * Set NEXT_PUBLIC_USE_CLIENT_FIRESTORE=true only for emergency/dev bypass.
 */
export const USE_SERVER_API =
  !USE_MOCK_API && readPublicEnv('USE_CLIENT_FIRESTORE', 'false') !== 'true'

/** @deprecated Prefer USE_SERVER_API. Kept for compatibility. */
export const USE_FIRESTORE_SCHOOL_DATA =
  USE_SERVER_API ||
  readPublicEnv('SCHOOL_DATA_SOURCE', 'firestore') === 'firestore' ||
  readPublicEnv('USE_FIRESTORE_DATA', 'true') === 'true' ||
  !USE_MOCK_API

export type { AuthService, DashboardService, StudentService } from './contracts'

class MockAuthService implements AuthService {
  async login(email: string, password: string, _remember = true) {
    await mockRequest(null, 500)
    const normalized = email.toLowerCase()
    const demoMatch = demoCredentials.find(
      (c) => c.email.toLowerCase() === normalized && c.password === password,
    )
    const staffMatch = staffCredentials.find(
      (c) => c.email.toLowerCase() === normalized && c.password === password,
    )
    if (!demoMatch && !staffMatch) {
      throw new Error('Invalid email or password')
    }

    if (staffMatch) {
      const member = staff.find((s) => s.id === staffMatch.staffId)
      if (member?.status === 'INACTIVE' || member?.suspension) {
        const until = member.suspension?.endsAt
          ? ` until ${member.suspension.endsAt}`
          : ' until an administrator reactivates your account'
        const reason = member.suspension?.reason
        throw Object.assign(
          new Error(
            reason
              ? `Your account is currently suspended${until}. Reason: ${reason}`
              : `Your account is currently suspended${until}.`,
          ),
          { code: 'ACCOUNT_SUSPENDED' },
        )
      }
    }

    let user = mockUsers.find((u) => u.email.toLowerCase() === normalized)
    if (!user && staffMatch) {
      const member = staff.find((s) => s.id === staffMatch.staffId)
      if (!member) throw new Error('User not found')
      user = {
        id: `u-${member.id}`,
        name: `${member.firstName} ${member.lastName}`,
        email: member.email,
        role: staffMatch.role,
        phone: member.phone,
        title: member.title,
        department: member.department,
        employeeNumber: member.employeeNumber,
        staffId: member.id,
        preferredLanguage: 'en',
        timezone: 'Africa/Harare',
        notificationPrefs: { email: true, sms: false, inApp: true },
      }
      mockUsers.push(user)
    }
    if (user && staffMatch) {
      const member = staff.find((s) => s.id === staffMatch.staffId)
      if (member) {
        user.role =
          member.accountRole ??
          (staffMatch.role === 'TEACHER'
            ? defaultAccountRoleForCategory(member.category)
            : staffMatch.role)
      }
    }
    if (!user) throw new Error('User not found')
    const now = new Date().toISOString()
    auditLogs.unshift({
      id: `aud-${Date.now()}`,
      user: user.name,
      actorId: user.id,
      actorName: user.name,
      actorEmail: user.email,
      actorRole: user.role,
      action: 'auth.login',
      module: 'auth',
      record: `auth:${user.id}`,
      status: 'SUCCESS',
      at: now,
      summary: `${user.name} signed in (${user.role.replaceAll('_', ' ')})`,
    })
    const appUser = appUsers.find((u) => u.email.toLowerCase() === normalized)
    if (appUser) appUser.lastLogin = now
    return { ...user }
  }

  async logout() {
    try {
      const raw = localStorage.getItem('viste.auth.user') ?? sessionStorage.getItem('viste.auth.user')
      if (raw) {
        const user = JSON.parse(raw) as AuthUser
        auditLogs.unshift({
          id: `aud-${Date.now()}`,
          user: user.name,
          actorId: user.id,
          actorName: user.name,
          actorEmail: user.email,
          actorRole: user.role,
          action: 'auth.logout',
          module: 'auth',
          record: `auth:${user.id}`,
          status: 'SUCCESS',
          at: new Date().toISOString(),
          summary: `${user.name} signed out`,
        })
      }
    } catch {
      /* ignore */
    }
    await mockRequest(undefined, 150)
  }

  getDemoCredentials() {
    return demoCredentials
  }

  async me() {
    const raw = localStorage.getItem('viste.auth.user') ?? sessionStorage.getItem('viste.auth.user')
    if (!raw) throw new Error('Not signed in')
    return JSON.parse(raw) as AuthUser
  }

  async session() {
    const user = await this.me()
    const { resolveEffectivePermissions } = await import('@/server/authorization/rbac-map')
    let overrides = null as { grant?: string[]; deny?: string[] } | null
    if (user.staffId) {
      const member = staff.find((s) => s.id === user.staffId)
      overrides = member?.permissionOverrides ?? null
    }
    return {
      user,
      permissions: resolveEffectivePermissions(user.role, overrides),
    }
  }

  async updateProfile(userId: string, patch: Partial<AuthUser>) {
    const index = mockUsers.findIndex((u) => u.id === userId)
    if (index < 0) throw new Error('User not found')

    const current = mockUsers[index]
    const patchSafe =
      current.role === 'TEACHER'
        ? (() => {
            const { title: _t, department: _d, employeeNumber: _e, ...rest } = patch
            return rest
          })()
        : patch
    const next: AuthUser = {
      ...current,
      ...patchSafe,
      id: current.id,
      role: current.role,
      email: patchSafe.email?.trim() || current.email,
      notificationPrefs: {
        email: patchSafe.notificationPrefs?.email ?? current.notificationPrefs?.email ?? true,
        sms: patchSafe.notificationPrefs?.sms ?? current.notificationPrefs?.sms ?? false,
        inApp: patchSafe.notificationPrefs?.inApp ?? current.notificationPrefs?.inApp ?? true,
      },
    }

    if (Object.prototype.hasOwnProperty.call(patchSafe, 'avatarUrl') && !patchSafe.avatarUrl) {
      delete next.avatarUrl
    }

    mockUsers[index] = next

    if (next.staffId) {
      const member = staff.find((s) => s.id === next.staffId)
      if (member) {
        const [firstName, ...rest] = next.name.trim().split(/\s+/)
        member.firstName = firstName || member.firstName
        member.lastName = rest.join(' ') || member.lastName
        member.email = next.email
        if (next.phone) member.phone = next.phone
        // HR fields stay admin-managed for teachers.
        if (current.role !== 'TEACHER') {
          if (next.title) member.title = next.title
          if (next.department) member.department = next.department
          if (next.employeeNumber) member.employeeNumber = next.employeeNumber
        }
        if (next.avatarFileId) member.profilePhotoId = next.avatarFileId
        else if (Object.prototype.hasOwnProperty.call(patch, 'avatarFileId')) {
          delete member.profilePhotoId
          delete member.photoUrl
        }
        if (next.avatarUrl && !next.avatarUrl.startsWith('blob:') && !next.avatarUrl.startsWith('data:')) {
          member.photoUrl = next.avatarUrl
        } else if (Object.prototype.hasOwnProperty.call(patch, 'avatarUrl')) {
          delete member.photoUrl
        }
      }
    }

    return mockRequest({ ...next }, 250)
  }

  async changePassword(_currentPassword: string, _nextPassword: string) {
    await mockRequest(null, 200)
  }

  async requestPasswordReset(_email: string) {
    await mockRequest(null, 200)
  }
}

class MockStudentService implements StudentService {
  list(opts?: { classId?: string }) {
    const rows = opts?.classId
      ? students.filter((s) => s.classId === opts.classId)
      : [...students]
    return mockRequest(rows)
  }
  getById(id: string) {
    return mockRequest(students.find((s) => s.id === id))
  }
  async create(input: Omit<Student, 'id'>) {
    const { previewNextVhsNumber } = await import('@/lib/student-numbers')
    const allocated = previewNextVhsNumber(students, input.admissionDate)
    const created: Student = {
      ...input,
      id: `stu-${Date.now()}`,
      studentNumber: input.studentNumber?.trim() || allocated,
      admissionNumber: input.admissionNumber?.trim() || allocated,
      subjectIds: [...input.subjectIds],
      guardianIds: [...input.guardianIds],
      sportIds: [...(input.sportIds ?? [])],
      clubIds: [...(input.clubIds ?? [])],
    }
    students.unshift(created)
    for (const gid of created.guardianIds) {
      const guardian = guardians.find((g) => g.id === gid)
      if (guardian && !guardian.studentIds.includes(created.id)) {
        guardian.studentIds.push(created.id)
      }
    }
    return mockRequest(created, 280)
  }
  async update(id: string, patch: Partial<Omit<Student, 'id'>>) {
    const index = students.findIndex((s) => s.id === id)
    if (index < 0) throw new Error('Student not found')
    const current = students[index]
    const next: Student = {
      ...current,
      ...patch,
      subjectIds: patch.subjectIds ? [...patch.subjectIds] : current.subjectIds,
      guardianIds: patch.guardianIds ? [...patch.guardianIds] : current.guardianIds,
    }
    students[index] = next
    if (patch.guardianIds) {
      for (const guardian of guardians) {
        const linked = next.guardianIds.includes(guardian.id)
        const has = guardian.studentIds.includes(id)
        if (linked && !has) guardian.studentIds.push(id)
        if (!linked && has) {
          guardian.studentIds = guardian.studentIds.filter((sid) => sid !== id)
        }
      }
    }
    return mockRequest({ ...next }, 250)
  }
  async archive(id: string) {
    return this.update(id, { status: 'ARCHIVED' })
  }
  async remove(id: string) {
    const index = students.findIndex((s) => s.id === id)
    if (index < 0) throw new Error('Student not found')
    students.splice(index, 1)
    for (const guardian of guardians) {
      guardian.studentIds = guardian.studentIds.filter((sid) => sid !== id)
    }
    return mockRequest({ deleted: true as const, id }, 200)
  }
  listScholarships(studentId: string) {
    return mockRequest(
      mockScholarships
        .filter((grant) => grant.studentId === studentId)
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    )
  }
  async createScholarship(
    studentId: string,
    input: Omit<
      StudentScholarship,
      'id' | 'studentId' | 'active' | 'createdBy' | 'createdByName' | 'createdAt'
    >,
  ) {
    const row: StudentScholarship = {
      ...input,
      id: `sch-${Date.now()}`,
      studentId,
      active: true,
      createdBy: 'demo-user',
      createdByName: 'Demo user',
      createdAt: new Date().toISOString(),
    }
    mockScholarships.unshift(row)
    return mockRequest(row)
  }
  async deactivateScholarship(studentId: string, scholarshipId: string) {
    const row = mockScholarships.find(
      (grant) => grant.id === scholarshipId && grant.studentId === studentId,
    )
    if (!row) throw new Error('Scholarship not found')
    row.active = false
    return mockRequest(row)
  }
}

class MockDashboardService implements DashboardService {
  getStats() {
    return mockRequest(dashboardStats)
  }
  getEnrollmentTrend() {
    return mockRequest(enrollmentTrend)
  }
  getAttendanceOverview() {
    return mockRequest(attendanceOverview)
  }
  getFeeCollection() {
    return mockRequest(feeCollectionSeries)
  }
  getPerformance() {
    return mockRequest(performanceSeries)
  }
  getRecentPayments() {
    return mockRequest([...payments].sort((a, b) => b.paidAt.localeCompare(a.paidAt)).slice(0, 5))
  }
  getRecentActivities() {
    return mockRequest(recentActivities)
  }
}

export const authService: AuthService = USE_MOCK_API
  ? new MockAuthService()
  : USE_SERVER_API
    ? new ApiAuthService()
    : new FirebaseAuthService()

export const studentService: StudentService = USE_MOCK_API
  ? new MockStudentService()
  : USE_SERVER_API
    ? apiStudentService
    : firestoreStudentService

export const dashboardService: DashboardService = USE_MOCK_API
  ? new MockDashboardService()
  : USE_SERVER_API
    ? apiDashboardService
    : firestoreDashboardService

const mockCatalogService = {
  getYears: (): Promise<AcademicYear[]> => mockRequest(academicYears),
  getTerms: (): Promise<Term[]> => mockRequest(terms),
  getClasses: (): Promise<SchoolClass[]> => mockRequest(classes),
  getStreams: (): Promise<Stream[]> => mockRequest(streams),
  getSubjects: (): Promise<Subject[]> => mockRequest(subjects),
  getSports: (): Promise<import('@/types').Sport[]> => mockRequest([]),
  getClubs: (): Promise<import('@/types').ClubActivity[]> => mockRequest([]),
  getHouses: (): Promise<import('@/types').House[]> => mockRequest([]),
  getStaff: (): Promise<Staff[]> => mockRequest([...staff]),
  getGuardians: (): Promise<Guardian[]> => mockRequest([...guardians]),
  getGuardian: (id: string) => mockRequest(guardians.find((g) => g.id === id)),
  getStaffMember: (id: string) => mockRequest(staff.find((s) => s.id === id)),
  updateStaff: async (id: string, patch: Partial<Staff>) => {
    const idx = staff.findIndex((s) => s.id === id)
    if (idx < 0) throw new Error('Staff not found')
    const current = staff[idx]!
    const oldRole = current.accountRole ?? defaultAccountRoleForCategory(current.category)
    const accountRole =
      patch.accountRole ??
      (patch.category && patch.category !== current.category
        ? defaultAccountRoleForCategory(patch.category)
        : oldRole)
    staff[idx] = { ...current, ...patch, accountRole, id }
    if (accountRole !== oldRole) {
      const credential = staffCredentials.find((row) => row.staffId === id)
      if (credential) credential.role = accountRole
      const account = mockUsers.find((row) => row.staffId === id)
      if (account) account.role = accountRole
    }
    return mockRequest(staff[idx]!)
  },
  deleteStaff: async (id: string) => {
    const idx = staff.findIndex((s) => s.id === id)
    if (idx >= 0) staff.splice(idx, 1)
    const cIdx = staffCredentials.findIndex((c) => c.staffId === id)
    if (cIdx >= 0) staffCredentials.splice(cIdx, 1)
    return mockRequest({ deleted: true as const, id })
  },
  suspendStaff: async (staffId: string, input: { reason: string; endsAt?: string | null }) => {
    const idx = staff.findIndex((s) => s.id === staffId)
    if (idx < 0) throw new Error('Staff not found')
    const today = new Date().toISOString().slice(0, 10)
    staff[idx] = {
      ...staff[idx]!,
      status: 'INACTIVE',
      suspension: {
        reason: input.reason,
        startsAt: today,
        endsAt: input.endsAt ?? null,
        suspendedAt: new Date().toISOString(),
        suspendedBy: 'mock-admin',
        suspendedByName: 'Admin',
      },
    }
    return mockRequest(staff[idx]!)
  },
  reactivateStaff: async (staffId: string) => {
    const idx = staff.findIndex((s) => s.id === staffId)
    if (idx < 0) throw new Error('Staff not found')
    staff[idx] = { ...staff[idx]!, status: 'ACTIVE', suspension: null }
    return mockRequest(staff[idx]!)
  },
  getStaffCredentials: (): Promise<StaffLoginCredential[]> => mockRequest([...staffCredentials]),
  getStaffCredential: (staffId: string) =>
    mockRequest(staffCredentials.find((c) => c.staffId === staffId)),
  async getStaffAccess(staffId: string) {
    const {
      listPermissions,
      STAFF_ASSIGNABLE_PERMISSIONS,
      STAFF_PERMISSION_GROUPS,
      resolveEffectivePermissions,
    } =
      await import('@/server/authorization/rbac-map')
    const member = staff.find((s) => s.id === staffId)
    if (!member) throw new Error('Staff not found')
    const role = member.accountRole ?? defaultAccountRoleForCategory(member.category)
    const overrides = member.permissionOverrides ?? {}
    const effective = resolveEffectivePermissions(role, overrides)
    const assignable = [...STAFF_ASSIGNABLE_PERMISSIONS]
    return mockRequest({
      staffId,
      role,
      roleDefaults: listPermissions(role),
      assignable,
      groups: STAFF_PERMISSION_GROUPS.map((g) => ({
        label: g.label,
        permissions: [...g.permissions],
      })),
      overrides,
      effective,
      selected: assignable.filter((p) => effective.includes(p)),
    })
  },
  async updateStaffAccess(staffId: string, permissions: string[]) {
    const { overridesFromStaffSelection } = await import('@/server/authorization/rbac-map')
    const member = staff.find((s) => s.id === staffId)
    if (!member) throw new Error('Staff not found')
    member.permissionOverrides = overridesFromStaffSelection(
      member.accountRole ?? defaultAccountRoleForCategory(member.category),
      permissions,
    )
    return this.getStaffAccess(staffId)
  },
  async resetStaffPassword(staffId: string, password?: string): Promise<StaffLoginCredential> {
    const existing = staffCredentials.find((c) => c.staffId === staffId)
    const member = staff.find((s) => s.id === staffId)
    if (!member) throw new Error('Staff member not found')
    const nextPassword = password && password.length >= 8 ? password : `Tmp${Date.now().toString(36)}!`
    const next: StaffLoginCredential = {
      staffId,
      email: member.email,
      password: nextPassword,
      role: 'TEACHER',
      temporaryPassword: true,
      lastResetAt: new Date().toISOString().slice(0, 10),
    }
    if (existing) {
      Object.assign(existing, next)
      return mockRequest({ ...existing }, 250)
    }
    staffCredentials.push(next)
    return mockRequest({ ...next }, 250)
  },
  async updateStaffPhoto(
    id: string,
    patch: { profilePhotoId?: string | null; photoUrl?: string | null },
  ): Promise<Staff | undefined> {
    const member = staff.find((s) => s.id === id)
    if (!member) return mockRequest(undefined)
    if (patch.profilePhotoId) member.profilePhotoId = patch.profilePhotoId
    else if (patch.profilePhotoId === null) delete member.profilePhotoId
    if (patch.photoUrl) member.photoUrl = patch.photoUrl
    else if (patch.photoUrl === null) delete member.photoUrl
    return mockRequest({ ...member }, 200)
  },
  async createStaff(input: Omit<Staff, 'id'> & { password?: string }): Promise<Staff> {
    const { password = 'demo1234', ...staffInput } = input
    const accountRole =
      staffInput.accountRole ?? defaultAccountRoleForCategory(staffInput.category)
    const created: Staff = {
      ...staffInput,
      accountRole,
      id: `st-${Date.now()}`,
    }
    staff.unshift(created)
    staffCredentials.unshift({
      staffId: created.id,
      email: created.email,
      password,
      role: accountRole,
      temporaryPassword: true,
      lastResetAt: new Date().toISOString().slice(0, 10),
    })
    return mockRequest(created, 250)
  },
  async updateGuardian(id: string, patch: Partial<Omit<Guardian, 'id'>>): Promise<Guardian> {
    const index = guardians.findIndex((g) => g.id === id)
    if (index < 0) throw new Error('Guardian not found')
    const next: Guardian = {
      ...guardians[index],
      ...patch,
      studentIds: patch.studentIds ? [...patch.studentIds] : guardians[index].studentIds,
    }
    guardians[index] = next
    return mockRequest({ ...next }, 250)
  },
  async deleteGuardian(id: string) {
    const index = guardians.findIndex((g) => g.id === id)
    if (index < 0) throw new Error('Guardian not found')
    guardians.splice(index, 1)
    for (const s of students) {
      s.guardianIds = (s.guardianIds ?? []).filter((gid) => gid !== id)
    }
    return mockRequest({ deleted: true as const, id }, 200)
  },
  async createGuardian(input: Omit<Guardian, 'id'>): Promise<Guardian> {
    const created: Guardian = {
      ...input,
      id: `g-${Date.now()}`,
      studentIds: [...input.studentIds],
    }
    guardians.unshift(created)
    return mockRequest(created, 250)
  },
  getAttendance: (opts?: { date?: string; classId?: string; kind?: 'DAILY' | 'PERIOD' }) => {
    let rows = [...attendanceRecords]
    if (opts?.date) rows = rows.filter((r) => r.date === opts.date)
    if (opts?.classId) rows = rows.filter((r) => r.classId === opts.classId)
    if (opts?.kind) {
      rows = rows.filter((r) => (r.kind ?? (r.subjectId ? 'PERIOD' : 'DAILY')) === opts.kind)
    }
    return mockRequest(rows)
  },
  getAttendanceSessions: async (_opts?: { date?: string; classId?: string }) =>
    mockRequest([] as import('@/types').AttendanceSession[]),
  async submitDailyRegister(input: {
    date: string
    classId: string
    entries: {
      studentId: string
      streamId: string
      status: 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'
    }[]
  }) {
    const cls = classes.find((c) => c.id === input.classId)
    for (const entry of input.entries) {
      const id = `att_${input.date}_${input.classId}_${entry.studentId}_daily`
      const idx = attendanceRecords.findIndex((r) => r.id === id)
      const row: AttendanceRecord = {
        id,
        date: input.date,
        classId: input.classId,
        studentId: entry.studentId,
        streamId: entry.streamId,
        status: entry.status,
        recordedBy: 'mock',
        kind: 'DAILY',
        recordedAt: new Date().toISOString(),
      }
      if (idx >= 0) attendanceRecords[idx] = row
      else attendanceRecords.unshift(row)
    }
    const presentCount = input.entries.filter((e) => e.status === 'PRESENT' || e.status === 'LATE')
      .length
    const absentCount = input.entries.filter((e) => e.status === 'ABSENT').length
    const session: import('@/types').AttendanceSession = {
      id: `attsess_${input.date}_${input.classId}`,
      date: input.date,
      classId: input.classId,
      className: cls?.name,
      submittedAt: new Date().toISOString(),
      submittedBy: 'mock',
      submittedByName: 'Mock Teacher',
      presentCount,
      absentCount,
      totalCount: input.entries.length,
    }
    return mockRequest({
      session,
      records: attendanceRecords.filter(
        (r) => r.date === input.date && r.classId === input.classId && r.kind === 'DAILY',
      ),
    })
  },
  upsertAttendance: async (input: {
    date: string
    studentId: string
    classId: string
    streamId: string
    status: AttendanceRecord['status']
    kind?: 'DAILY' | 'PERIOD'
    subjectId?: string
  }) => {
    const kind = input.kind ?? (input.subjectId ? 'PERIOD' : 'DAILY')
    const id =
      kind === 'DAILY'
        ? `att_${input.date}_${input.classId}_${input.studentId}_daily`
        : `att-${Date.now()}`
    const row: AttendanceRecord = {
      id,
      ...input,
      kind,
      recordedBy: 'mock',
      recordedAt: new Date().toISOString(),
    }
    attendanceRecords.unshift(row)
    return mockRequest(row)
  },
  getExaminations: (): Promise<Examination[]> => mockRequest(examinations),
  getAssessments: (): Promise<Assessment[]> => mockRequest(assessments),
  getMarks: (): Promise<Mark[]> => mockRequest(marks),
  submitMonthlyMarks: async (input: {
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
  }) => {
    const action = input.action ?? (input.publish ? 'submit' : 'draft')
    return mockCatalogService.submitClassSubjectMarks({
      classId: input.classId,
      subjectId: input.subjectId,
      periodType: 'MONTHLY',
      month: input.month,
      maxScore: input.maxScore,
      action,
      entries: input.entries,
    })
  },
  submitClassSubjectMarks: async (input: {
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
  }) => {
    const maxScore = input.maxScore ?? 100
    const status =
      input.action === 'submit' ? ('SUBMITTED' as const) : ('DRAFT' as const)
    const assessmentId =
      input.periodType === 'MONTHLY'
        ? `as_monthly_${input.classId}_${input.subjectId}_${input.month}`
        : input.periodType === 'DAILY'
          ? `as_daily_${input.classId}_${input.subjectId}_${input.date}`
          : input.periodType === 'WEEKLY'
          ? `as_weekly_${input.classId}_${input.subjectId}_${input.weekOf}`
          : input.periodType === 'MOCK'
            ? `as_mock_${input.classId}_${input.subjectId}_${input.month ?? input.termId ?? 'mock'}`
            : `as_termly_${input.classId}_${input.subjectId}_${input.termId}`
    const assessmentName =
      input.periodType === 'MONTHLY'
        ? `Monthly ${input.month}`
        : input.periodType === 'DAILY'
          ? `Daily ${input.date}`
          : input.periodType === 'WEEKLY'
          ? `Weekly ${input.weekOf}`
          : input.periodType === 'MOCK'
            ? `Mock ${input.month ?? input.termId ?? ''}`.trim()
            : `Term ${input.termId}`
    const assessment: Assessment = {
      id: assessmentId,
      name: assessmentName,
      type: input.periodType,
      subjectId: input.subjectId,
      streamId: 'stream-1',
      termId: input.termId ?? 'term-1',
      maxScore,
      status,
      classId: input.classId,
      month: input.month,
      ...(input.periodType === 'DAILY'
        ? { date: input.date, month: input.date?.slice(0, 7) }
        : {}),
      weekOf: input.weekOf,
    }
    assessments.unshift(assessment)
    const nextMarks = input.entries.map((e) => {
      const pct = (e.score / maxScore) * 100
      const grade = pct >= 85 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : 'U'
      const row: Mark = {
        id: `mk_${assessment.id}_${e.studentId}`,
        assessmentId: assessment.id,
        studentId: e.studentId,
        score: e.score,
        grade,
        status: assessment.status,
        commentMode: e.commentMode,
        comment: e.comment,
      }
      marks.unshift(row)
      return row
    })
    return mockRequest({ assessment, marks: nextMarks })
  },
  transitionAssessment: async (input: {
    assessmentId: string
    status: 'SUBMITTED' | 'APPROVED' | 'PUBLISHED' | 'LOCKED'
    releaseToPortal?: boolean
  }) => {
    const idx = assessments.findIndex((a) => a.id === input.assessmentId)
    if (idx < 0) throw new Error('Assessment not found')
    const next =
      input.releaseToPortal && input.status === 'APPROVED'
        ? ('PUBLISHED' as const)
        : input.status
    assessments[idx] = { ...assessments[idx], status: next }
    for (const m of marks.filter((x) => x.assessmentId === input.assessmentId)) {
      m.status = next
    }
    return mockRequest(assessments[idx])
  },
  getGradingScale: async () =>
    mockRequest({
      ECD: {
        id: 'ECD' as const,
        track: 'ECD' as const,
        label: 'ECD',
        passMark: 50,
        bands: [
          { grade: 'A', minPercent: 80, maxPercent: 100 },
          { grade: 'B', minPercent: 70, maxPercent: 79 },
          { grade: 'C', minPercent: 60, maxPercent: 69 },
          { grade: 'D', minPercent: 50, maxPercent: 59 },
          { grade: 'E', minPercent: 40, maxPercent: 49 },
          { grade: 'U', minPercent: 0, maxPercent: 39 },
        ],
      },
      PRIMARY: {
        id: 'PRIMARY' as const,
        track: 'PRIMARY' as const,
        label: 'Grades 1–7',
        passMark: 50,
        bands: [
          { grade: 'A', minPercent: 80, maxPercent: 100 },
          { grade: 'B', minPercent: 70, maxPercent: 79 },
          { grade: 'C', minPercent: 60, maxPercent: 69 },
          { grade: 'D', minPercent: 50, maxPercent: 59 },
          { grade: 'E', minPercent: 40, maxPercent: 49 },
          { grade: 'U', minPercent: 0, maxPercent: 39 },
        ],
      },
      FORM_1_4: {
        id: 'FORM_1_4' as const,
        track: 'FORM_1_4' as const,
        label: 'Form 1–4 (O-Level)',
        passMark: 50,
        bands: [
          { grade: 'A', minPercent: 80, maxPercent: 100 },
          { grade: 'B', minPercent: 70, maxPercent: 79 },
          { grade: 'C', minPercent: 60, maxPercent: 69 },
          { grade: 'D', minPercent: 50, maxPercent: 59 },
          { grade: 'E', minPercent: 40, maxPercent: 49 },
          { grade: 'U', minPercent: 0, maxPercent: 39 },
        ],
      },
      FORM_5_6: {
        id: 'FORM_5_6' as const,
        track: 'FORM_5_6' as const,
        label: 'Form 5–6 (A-Level)',
        passMark: 50,
        bands: [
          { grade: 'A', minPercent: 75, maxPercent: 100 },
          { grade: 'B', minPercent: 65, maxPercent: 74 },
          { grade: 'C', minPercent: 55, maxPercent: 64 },
          { grade: 'D', minPercent: 45, maxPercent: 54 },
          { grade: 'E', minPercent: 35, maxPercent: 44 },
          { grade: 'U', minPercent: 0, maxPercent: 34 },
        ],
      },
    }),
  updateGradingScale: async (input: {
    track: import('@/types').GradingTrack
    passMark: number
    bands: { grade: string; minPercent: number; maxPercent: number }[]
  }) => {
    const base = {
      ECD: {
        id: 'ECD' as const,
        track: 'ECD' as const,
        label: 'ECD',
        passMark: 50,
        bands: [
          { grade: 'A', minPercent: 80, maxPercent: 100 },
          { grade: 'B', minPercent: 70, maxPercent: 79 },
          { grade: 'C', minPercent: 60, maxPercent: 69 },
          { grade: 'D', minPercent: 50, maxPercent: 59 },
          { grade: 'E', minPercent: 40, maxPercent: 49 },
          { grade: 'U', minPercent: 0, maxPercent: 39 },
        ],
      },
      PRIMARY: {
        id: 'PRIMARY' as const,
        track: 'PRIMARY' as const,
        label: 'Grades 1–7',
        passMark: 50,
        bands: [
          { grade: 'A', minPercent: 80, maxPercent: 100 },
          { grade: 'B', minPercent: 70, maxPercent: 79 },
          { grade: 'C', minPercent: 60, maxPercent: 69 },
          { grade: 'D', minPercent: 50, maxPercent: 59 },
          { grade: 'E', minPercent: 40, maxPercent: 49 },
          { grade: 'U', minPercent: 0, maxPercent: 39 },
        ],
      },
      FORM_1_4: {
        id: 'FORM_1_4' as const,
        track: 'FORM_1_4' as const,
        label: 'Form 1–4 (O-Level)',
        passMark: 50,
        bands: [
          { grade: 'A', minPercent: 80, maxPercent: 100 },
          { grade: 'B', minPercent: 70, maxPercent: 79 },
          { grade: 'C', minPercent: 60, maxPercent: 69 },
          { grade: 'D', minPercent: 50, maxPercent: 59 },
          { grade: 'E', minPercent: 40, maxPercent: 49 },
          { grade: 'U', minPercent: 0, maxPercent: 39 },
        ],
      },
      FORM_5_6: {
        id: 'FORM_5_6' as const,
        track: 'FORM_5_6' as const,
        label: 'Form 5–6 (A-Level)',
        passMark: 50,
        bands: [
          { grade: 'A', minPercent: 75, maxPercent: 100 },
          { grade: 'B', minPercent: 65, maxPercent: 74 },
          { grade: 'C', minPercent: 55, maxPercent: 64 },
          { grade: 'D', minPercent: 45, maxPercent: 54 },
          { grade: 'E', minPercent: 35, maxPercent: 44 },
          { grade: 'U', minPercent: 0, maxPercent: 34 },
        ],
      },
    }
    return mockRequest({
      ...base,
      [input.track]: {
        id: input.track,
        track: input.track,
        label: {
          ECD: 'ECD',
          PRIMARY: 'Grades 1–7',
          FORM_1_4: 'Form 1–4 (O-Level)',
          FORM_5_6: 'Form 5–6 (A-Level)',
        }[input.track],
        passMark: input.passMark,
        bands: input.bands,
      },
    })
  },
  getSchoolProfile: async () =>
    mockRequest({
      id: 'schoolProfile' as const,
      name: 'Viste High School',
      motto: 'Excellence in learning',
      address: 'Harare, Zimbabwe',
      phone: '+263 000 000 000',
      email: 'info@viste.school',
      website: '',
      registrationNumber: '',
    }),
  updateSchoolProfile: async (
    input: Omit<import('@/types').SchoolProfile, 'id' | 'updatedAt' | 'updatedBy'>,
  ) => mockRequest({ id: 'schoolProfile' as const, ...input }),
  getFeePolicy: async () => mockRequest({ ...mockFeePolicy }),
  updateFeePolicy: async (
    input: Omit<import('@/types').FeePolicy, 'id' | 'updatedAt' | 'updatedBy'>,
  ) => {
    mockFeePolicy = { id: 'feePolicy', ...input }
    return mockRequest({ ...mockFeePolicy })
  },
  getAcademicSettings: async () => {
    const year = academicYears.find((y) => y.isCurrent) ?? academicYears[0]
    const yearTerms = terms.filter((t) => t.academicYearId === year?.id)
    return mockRequest({
      year: year ?? {
        id: 'ay-2025',
        name: '2025/2026',
        startDate: '2025-09-01',
        endDate: '2026-07-31',
        isCurrent: true,
      },
      terms: yearTerms,
      years: academicYears,
    })
  },
  updateAcademicSettings: async (input: {
    year: import('@/types').AcademicYear
    terms: Pick<import('@/types').Term, 'id' | 'name' | 'sequence' | 'startDate' | 'endDate'>[]
  }) =>
    mockRequest({
      year: input.year,
      terms: input.terms.map((t) => ({ ...t, academicYearId: input.year.id })),
      years: academicYears,
    }),
  acknowledgePasswordChanged: async () => mockRequest({ cleared: true }),
  getFeeStructures: (): Promise<FeeStructure[]> => mockRequest(feeStructures),
  getInvoices: (): Promise<Invoice[]> => mockRequest(invoices),
  getPayments: (): Promise<Payment[]> => mockRequest(payments),
  billTerm: async (_termId?: string) =>
    mockRequest<import('@/types').TermBillingResult>({
      termId: 'term-mock',
      termName: 'Current term',
      created: 0,
      updated: 0,
      unchanged: invoices.length,
      skipped: 0,
    }),
  billCurrentMonth: async (studentId: string) => {
    const student = students.find((row) => row.id === studentId)
    if (!student) throw new Error('Student not found')
    if (student.status !== 'ACTIVE') throw new Error('Only active students can be billed')
    if (student.paymentPlan !== 'MONTHLY') {
      throw new Error('Current-month billing is only available for students on the monthly plan')
    }
    const today = new Date().toISOString().slice(0, 10)
    const term =
      terms.find((row) => row.startDate <= today && today <= row.endDate) ??
      terms.find((row) => row.startDate > today)
    if (!term) throw new Error('No current or upcoming term is configured')
    const installment = monthlyInstalments(
      term.startDate,
      mockFeePolicy.monthsPerTerm,
      mockFeePolicy.overdueGraceDays,
    ).find((row) => row.issueDate.slice(0, 7) === today.slice(0, 7) && row.issueDate <= today)
    if (!installment) {
      return mockRequest<import('@/types').TermBillingResult>({
        termId: term.id,
        termName: term.name,
        created: 0,
        updated: 0,
        unchanged: 0,
        skipped: 1,
      })
    }
    const klass = classes.find((row) => row.id === student.classId)
    const level = student.educationLevelId || klass?.educationLevelId || klass?.level
    const category = feeCategoryFor(student.residency, level)
    const baseAmount = feeAmountFor(mockFeePolicy.fees!, category, 'MONTHLY')
    if (baseAmount <= 0) throw new Error('Set the monthly fee amount in Settings before billing')
    const [periodYear, periodMonth] = installment.issueDate.slice(0, 7).split('-').map(Number)
    const periodStart = `${installment.issueDate.slice(0, 7)}-01`
    const periodEnd = new Date(Date.UTC(periodYear!, periodMonth!, 0)).toISOString().slice(0, 10)
    const amount = scholarshipAdjustedFeeAmount(
      baseAmount,
      periodStart,
      periodEnd,
      mockScholarships.filter(
        (grant) =>
          grant.studentId === student.id &&
          grant.active &&
          grant.startDate <= periodEnd &&
          (!grant.endDate || grant.endDate >= periodStart),
      ),
    )
    const id = monthlyInvoiceId(term.id, student.id, installment.instalment)
    const existing = invoices.find((row) => row.id === id)
    if (existing) {
      existing.total = amount
      existing.category = category
      existing.plan = 'MONTHLY'
      existing.termId = term.id
      existing.termName = term.name
      existing.period = installment.period
      existing.status =
        existing.paid >= amount ? 'PAID' : existing.paid > 0 ? 'PARTIAL' : 'OPEN'
      return mockRequest<import('@/types').TermBillingResult>({
        termId: term.id,
        termName: term.name,
        created: 0,
        updated: 1,
        unchanged: 0,
        skipped: 0,
      })
    }
    invoices.push({
      id,
      studentId: student.id,
      number: `INV-${term.id.replace(/^term-/, '')}-${student.studentNumber}-M${installment.instalment}`,
      dueDate: installment.dueDate,
      total: amount,
      paid: 0,
      status: amount === 0 ? 'PAID' : 'OPEN',
      termId: term.id,
      termName: term.name,
      category,
      plan: 'MONTHLY',
      period: installment.period,
      createdAt: new Date().toISOString(),
    })
    return mockRequest<import('@/types').TermBillingResult>({
      termId: term.id,
      termName: term.name,
      created: 1,
      updated: 0,
      unchanged: 0,
      skipped: 0,
    })
  },
  recordPayment: async (
    input: import('@/types').RecordPaymentInput,
  ): Promise<import('@/types').RecordPaymentResult> => {
    const invoice = invoices.find((i) => i.id === input.invoiceId)
    if (!invoice) throw new Error('Invoice not found')
    invoice.paid = Math.min(invoice.total, invoice.paid + input.amount)
    invoice.status = invoice.paid >= invoice.total ? 'PAID' : 'PARTIAL'
    const payment: Payment = {
      id: `pay-${Date.now()}`,
      studentId: input.studentId,
      invoiceId: input.invoiceId,
      amount: input.amount,
      method: input.method,
      status: 'CONFIRMED',
      paidAt: input.paidAt ?? new Date().toISOString(),
      receiptNumber: input.receiptNumber || `VHS-${1000 + payments.length + 1}`,
    }
    payments.unshift(payment)
    const today = new Date().toISOString().slice(0, 10)
    const currentMonthLabel = new Date().toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
    })
    const feesCleared = invoices
      .filter(
        (i) =>
          i.studentId === input.studentId &&
          (i.dueDate <= today || (i.plan === 'MONTHLY' && i.period === currentMonthLabel)),
      )
      .every((i) => i.paid >= i.total)
    return mockRequest({ payment, invoice: { ...invoice }, feesCleared })
  },
  reversePayment: async (id: string): Promise<Payment> => {
    const payment = payments.find((p) => p.id === id)
    if (!payment) throw new Error('Payment not found')
    payment.status = 'REVERSED'
    const invoice = invoices.find((i) => i.id === payment.invoiceId)
    if (invoice) {
      invoice.paid = Math.max(0, invoice.paid - payment.amount)
      invoice.status = invoice.paid <= 0 ? 'OPEN' : 'PARTIAL'
    }
    return mockRequest({ ...payment })
  },
  getAnnouncements: (): Promise<Announcement[]> => mockRequest(announcements),
  getNotifications: async () => mockRequest([] as import('@/types').AppNotification[]),
  markNotificationRead: async (id: string) =>
    mockRequest({
      id,
      audience: 'ADMIN' as const,
      type: 'REGISTER_SUBMITTED' as const,
      title: 'Marked read',
      body: '',
      createdAt: new Date().toISOString(),
      read: true,
    }),
  markAllNotificationsRead: async () => mockRequest({ marked: 0 }),
  getBooks: (): Promise<LibraryBook[]> => mockRequest(libraryBooks),
  createBook: async (input: Omit<LibraryBook, 'id' | 'available'>): Promise<LibraryBook> => {
    const row: LibraryBook = {
      ...input,
      id: `bk-${Date.now()}`,
      available: input.copies,
    }
    libraryBooks.unshift(row)
    return mockRequest(row)
  },
  getLoans: (): Promise<LibraryLoan[]> => mockRequest(libraryLoans),
  createLoan: async (input: {
    bookId: string
    studentId: string
    dueAt: string
    borrowerPhone?: string
    notes?: string
  }): Promise<LibraryLoan> => {
    const book = libraryBooks.find((row) => row.id === input.bookId)
    const student = students.find((row) => row.id === input.studentId)
    if (!book) throw new Error('Book not found')
    if (!student) throw new Error('Student not found')
    if (student.status !== 'ACTIVE') throw new Error('Only active students can borrow books')
    if (book.available < 1) throw new Error('No copies of this book are available')
    book.available -= 1
    const row: LibraryLoan = {
      id: `loan-${Date.now()}`,
      bookId: book.id,
      studentId: student.id,
      studentName: `${student.firstName} ${student.lastName}`.trim(),
      studentNumber: student.studentNumber,
      className: classes.find((cls) => cls.id === student.classId)?.name ?? student.classId,
      borrowerPhone: input.borrowerPhone || student.phone,
      borrowedAt: new Date().toISOString(),
      dueAt: input.dueAt,
      fine: 0,
      notes: input.notes,
    }
    libraryLoans.unshift(row)
    return mockRequest(row)
  },
  returnLoan: async (id: string): Promise<LibraryLoan> => {
    const loan = libraryLoans.find((row) => row.id === id)
    if (!loan) throw new Error('Loan not found')
    if (loan.returnedAt) throw new Error('Book has already been returned')
    loan.returnedAt = new Date().toISOString()
    const book = libraryBooks.find((row) => row.id === loan.bookId)
    if (book) book.available = Math.min(book.copies, book.available + 1)
    return mockRequest(loan)
  },
  getInventory: (): Promise<InventoryItem[]> => mockRequest([...inventoryItems]),
  createInventoryItem: async (input: Partial<InventoryItem>) => {
    const row: InventoryItem = {
      id: `invt-${Date.now()}`,
      name: input.name || 'Asset',
      category: input.category || 'General',
      sku: input.sku || `SKU-${Date.now()}`,
      registrationNumber: input.registrationNumber,
      quantity: input.quantity ?? 1,
      location: input.location || '',
      supplier: input.supplier || '',
      purchaseValue: input.purchaseValue ?? 0,
      purchaseDate: input.purchaseDate || new Date().toISOString().slice(0, 10),
      receiptFileId: input.receiptFileId,
      status: input.status || 'IN_STOCK',
      dispatchedTo: input.dispatchedTo,
      dispatchedAt: input.dispatchedAt,
      soldAmount: input.soldAmount,
      soldAt: input.soldAt,
      notes: input.notes,
    }
    inventoryItems.push(row)
    return mockRequest(row)
  },
  updateInventoryItem: async (id: string, patch: Partial<InventoryItem>) => {
    const i = inventoryItems.findIndex((x) => x.id === id)
    if (i < 0) throw new Error('Asset not found')
    inventoryItems[i] = { ...inventoryItems[i]!, ...patch, id }
    return mockRequest(inventoryItems[i]!)
  },
  deleteInventoryItem: async (id: string) => {
    const i = inventoryItems.findIndex((x) => x.id === id)
    if (i >= 0) inventoryItems.splice(i, 1)
    return mockRequest({ ok: true })
  },
  getTransport: (): Promise<TransportRoute[]> => mockRequest([...transportRoutes]),
  getTransportVehicles: () => mockRequest([...transportVehicles]),
  getTransportRiders: () => mockRequest([...transportRiders]),
  getTransportPayments: () => mockRequest([...transportPayments]),
  createTransportRoute: async (input: Record<string, unknown>) => {
    const row: TransportRoute = {
      id: `tr-${Date.now()}`,
      name: String(input.name || 'Route'),
      vehicleId: input.vehicleId ? String(input.vehicleId) : undefined,
      vehicle: String(input.vehicle || ''),
      driver: String(input.driver || ''),
      driverPhone: input.driverPhone ? String(input.driverPhone) : undefined,
      fee: Number(input.fee) || 0,
      stops: Array.isArray(input.stops) ? (input.stops as TransportRoute['stops']) : [],
      studentIds: [],
      active: input.active !== false,
    }
    transportRoutes.push(row)
    return mockRequest(row)
  },
  updateTransportRoute: async (id: string, patch: Record<string, unknown>) => {
    const i = transportRoutes.findIndex((x) => x.id === id)
    if (i < 0) throw new Error('Route not found')
    transportRoutes[i] = { ...transportRoutes[i]!, ...patch, id } as TransportRoute
    return mockRequest(transportRoutes[i]!)
  },
  deleteTransportRoute: async (id: string) => {
    const i = transportRoutes.findIndex((x) => x.id === id)
    if (i >= 0) transportRoutes.splice(i, 1)
    return mockRequest({ ok: true })
  },
  createTransportVehicle: async (input: Record<string, unknown>) => {
    const row = {
      id: `bus-${Date.now()}`,
      name: String(input.name || 'Bus'),
      registrationNumber: String(input.registrationNumber || '').toUpperCase(),
      capacity: Number(input.capacity) || 30,
      type: (input.type as 'BUS') || 'BUS',
      status: (input.status as 'ACTIVE') || 'ACTIVE',
      notes: input.notes ? String(input.notes) : undefined,
    }
    transportVehicles.push(row)
    return mockRequest(row)
  },
  updateTransportVehicle: async (id: string, patch: Record<string, unknown>) => {
    const i = transportVehicles.findIndex((x) => x.id === id)
    if (i < 0) throw new Error('Vehicle not found')
    transportVehicles[i] = { ...transportVehicles[i]!, ...patch, id } as (typeof transportVehicles)[0]
    return mockRequest(transportVehicles[i]!)
  },
  createTransportRider: async (input: Record<string, unknown>) => {
    const route = transportRoutes.find((r) => r.id === input.routeId)
    const row = {
      id: `trd-${Date.now()}`,
      studentId: String(input.studentId),
      routeId: String(input.routeId),
      monthlyFee: Number(input.monthlyFee ?? route?.fee ?? 0),
      status: (input.status as 'ACTIVE') || 'ACTIVE',
      startedAt: String(input.startedAt || new Date().toISOString().slice(0, 10)),
      notes: input.notes ? String(input.notes) : undefined,
    }
    transportRiders.push(row)
    if (route && !route.studentIds.includes(row.studentId)) route.studentIds.push(row.studentId)
    return mockRequest(row)
  },
  updateTransportRider: async (id: string, patch: Record<string, unknown>) => {
    const i = transportRiders.findIndex((x) => x.id === id)
    if (i < 0) throw new Error('Rider not found')
    transportRiders[i] = { ...transportRiders[i]!, ...patch, id } as (typeof transportRiders)[0]
    return mockRequest(transportRiders[i]!)
  },
  createTransportPayment: async (input: Record<string, unknown>) => {
    const rider = transportRiders.find((r) => r.id === input.riderId)
    if (!rider) throw new Error('Rider not found')
    const row = {
      id: `tpay-${Date.now()}`,
      riderId: rider.id,
      studentId: rider.studentId,
      routeId: rider.routeId,
      amount: Number(input.amount),
      month: String(input.month),
      paidAt: String(input.paidAt || new Date().toISOString().slice(0, 10)),
      method: String(input.method || 'Cash'),
      receiptNumber: input.receiptNumber ? String(input.receiptNumber) : undefined,
      notes: input.notes ? String(input.notes) : undefined,
    }
    transportPayments.push(row)
    return mockRequest(row)
  },
  getUsers: (): Promise<AppUser[]> => mockRequest([...appUsers]),
  createUser: async (input: {
    name: string
    email: string
    password: string
    role: string
    title?: string
  }) => {
    const row: AppUser = {
      id: `u-${Date.now()}`,
      name: input.name,
      email: input.email.toLowerCase(),
      role: input.role as AppUser['role'],
      status: 'ACTIVE',
      title: input.title,
      lastLogin: undefined,
    }
    appUsers.push(row)
    return mockRequest(row)
  },
  updateUser: async (
    id: string,
    patch: { name?: string; role?: string; status?: 'ACTIVE' | 'DISABLED'; title?: string },
  ) => {
    const i = appUsers.findIndex((u) => u.id === id)
    if (i < 0) throw new Error('User not found')
    appUsers[i] = {
      ...appUsers[i]!,
      ...patch,
      role: (patch.role as AppUser['role']) ?? appUsers[i]!.role,
      id,
    }
    return mockRequest(appUsers[i]!)
  },
  getRolePermissions: (): Promise<RolePermission[]> => mockRequest([...rolePermissions]),
  updateRolePermissions: async (input: { role: string; permissions: string[] }) => {
    const next: RolePermission = {
      role: input.role as RolePermission['role'],
      permissions: [...input.permissions],
      grant: [],
      deny: [],
    }
    const i = rolePermissions.findIndex((r) => r.role === input.role)
    if (i >= 0) rolePermissions[i] = next
    else rolePermissions.push(next)
    return mockRequest(next)
  },
  getPermissionCatalog: () => mockRequest(permissionCatalog),
  getAuditLogs: (): Promise<AuditLog[]> => mockRequest([...auditLogs]),
  getResultPortals: (): Promise<ResultPortalView[]> => mockRequest(resultPortals),
  getResultPortal: async (studentId: string) => {
    const existing = resultPortals.find((p) => p.studentId === studentId)
    if (existing) return mockRequest(existing)
    return mockRequest({
      studentId,
      studentName: 'Student',
      className: '',
      streamName: '',
      academicYear: '',
      term: '',
      accessState: 'RESULTS_NOT_PUBLISHED' as const,
      subjects: [],
      monthly: [],
    })
  },
}

export const catalogService = USE_MOCK_API
  ? mockCatalogService
  : USE_SERVER_API
    ? apiCatalogService
    : firestoreCatalogService

export const classService = USE_MOCK_API
  ? {
      list: () => mockRequest([...classes]),
      getStats: async () => ({
        totalStudents: students.length,
        totalClasses: classes.length,
        ecdStudents: 0,
        primaryStudents: 0,
        secondaryStudents: students.length,
        activeStudents: students.filter((s) => s.status === 'ACTIVE').length,
        transferredStudents: students.filter((s) => s.status === 'TRANSFERRED').length,
        archivedStudents: students.filter((s) => s.status === 'ARCHIVED' || s.status === 'INACTIVE')
          .length,
        classDistribution: classes.map((c) => ({
          classId: c.id,
          className: c.name,
          count: students.filter((s) => s.classId === c.id).length,
        })),
      }),
      getById: (id: string) => mockRequest(classes.find((c) => c.id === id)!),
      create: async (
        input: Omit<SchoolClass, 'id' | 'level' | 'academicYearId'> & {
          educationLevelId: string
          academicYearId?: string
          termSequence?: 1 | 2 | 3
        },
      ) => {
        const created: SchoolClass = {
          ...input,
          id: `cls-${Date.now()}`,
          level: input.educationLevelId,
          academicYearId: input.academicYearId || `ay-${new Date().getFullYear()}`,
          termSequence: input.termSequence ?? 1,
          status: input.status ?? 'ACTIVE',
        }
        classes.unshift(created)
        streams.unshift({
          id: `str-${Date.now()}`,
          classId: created.id,
          name: created.name,
          capacity: input.capacity ?? 40,
        })
        return mockRequest(created, 250)
      },
      update: async (
        id: string,
        patch: Partial<SchoolClass> & { termSequence?: 1 | 2 | 3 },
      ) => {
        const idx = classes.findIndex((c) => c.id === id)
        if (idx < 0) throw new Error('Class not found')
        classes[idx] = { ...classes[idx], ...patch, id }
        return mockRequest({ ...classes[idx] }, 200)
      },
      archive: async (id: string) => {
        const idx = classes.findIndex((c) => c.id === id)
        if (idx < 0) throw new Error('Class not found')
        classes[idx] = { ...classes[idx], status: 'ARCHIVED' }
        return mockRequest({ ...classes[idx] }, 200)
      },
      remove: async (id: string) => {
        const idx = classes.findIndex((c) => c.id === id)
        if (idx < 0) throw new Error('Class not found')
        const assigned = students.filter((s) => s.classId === id)
        if (assigned.length > 0) {
          throw new Error(
            `Cannot delete — ${assigned.length} student(s) are still in this class.`,
          )
        }
        classes.splice(idx, 1)
        return mockRequest({ deleted: true as const, id }, 200)
      },
      getTeacherReports: async () => mockRequest([]),
      saveTeacherReports: async (_classId: string, input: { termId: string; entries: { studentId: string; comment: string }[] }) =>
        mockRequest(
          input.entries.map((e) => ({
            id: `ctr-${e.studentId}`,
            classId: _classId,
            studentId: e.studentId,
            termId: input.termId,
            comment: e.comment,
            updatedAt: new Date().toISOString(),
            updatedBy: 'mock',
          })),
        ),
      getResultsSummary: async (
        classId: string,
        query: { period: import('@/types').ClassResultsPeriod; termId?: string; month?: string },
      ) =>
        mockRequest<import('@/types').ClassResultsSummary>({
          classId,
          period: query.period,
          termId: query.termId,
          month: query.month,
          subjects: [],
          students: [],
        }),
      getDutyRoster: async () => mockRequest(null),
      saveDutyRoster: async (
        classId: string,
        input: { weekOf: string; entries: import('@/types').DutyRosterEntry[] },
      ) =>
        mockRequest({
          id: `duty-${classId}`,
          classId,
          weekOf: input.weekOf,
          entries: input.entries,
          updatedAt: new Date().toISOString(),
          updatedBy: 'mock',
        }),
    }
  : apiClassService

export const subjectAdminService = USE_MOCK_API
  ? {
      list: () => mockRequest([...subjects]),
      create: async (input: Omit<Subject, 'id'>) => {
        const created: Subject = { ...input, id: `sub-${Date.now()}`, active: input.active ?? true }
        subjects.unshift(created)
        return mockRequest(created, 200)
      },
      update: async (id: string, patch: Partial<Subject>) => {
        const idx = subjects.findIndex((s) => s.id === id)
        if (idx < 0) throw new Error('Subject not found')
        subjects[idx] = { ...subjects[idx], ...patch, id }
        return mockRequest({ ...subjects[idx] }, 200)
      },
      remove: async (id: string) => {
        const idx = subjects.findIndex((s) => s.id === id)
        if (idx < 0) throw new Error('Subject not found')
        subjects.splice(idx, 1)
        for (const s of students) {
          s.subjectIds = (s.subjectIds ?? []).filter((sid) => sid !== id)
        }
        return mockRequest({ deleted: true as const, id }, 200)
      },
    }
  : apiSubjectAdminService

export const extracurricularService = USE_MOCK_API
  ? {
      listSports: () => mockRequest([] as import('@/types').Sport[]),
      createSport: async (input: Omit<import('@/types').Sport, 'id'>) =>
        mockRequest({ ...input, id: `sport-${Date.now()}` }, 200),
      updateSport: async (id: string, patch: Partial<import('@/types').Sport>) =>
        mockRequest({ id, name: 'Sport', active: true, ...patch }, 200),
      listClubs: () => mockRequest([] as import('@/types').ClubActivity[]),
      createClub: async (input: Omit<import('@/types').ClubActivity, 'id'>) =>
        mockRequest({ ...input, id: `club-${Date.now()}` }, 200),
      updateClub: async (id: string, patch: Partial<import('@/types').ClubActivity>) =>
        mockRequest({ id, name: 'Club', type: 'CLUB' as const, active: true, ...patch }, 200),
      listHouses: () => mockRequest([] as import('@/types').House[]),
      createHouse: async (input: Omit<import('@/types').House, 'id'>) =>
        mockRequest({ ...input, id: `house-${Date.now()}` }, 200),
      updateHouse: async (id: string, patch: Partial<import('@/types').House>) =>
        mockRequest({ id, name: 'House', active: true, ...patch }, 200),
    }
  : apiExtracurricularService
