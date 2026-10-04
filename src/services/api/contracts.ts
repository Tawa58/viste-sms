import { demoCredentials } from '@/mocks/data'
import type {
  AuthUser,
  DashboardStats,
  Guardian,
  Payment,
  Staff,
  Student,
} from '@/types'

export interface AuthService {
  login(email: string, password: string, remember?: boolean): Promise<AuthUser>
  logout(): Promise<void>
  getDemoCredentials(): typeof demoCredentials
  updateProfile(userId: string, patch: Partial<AuthUser>): Promise<AuthUser>
  /** Change password and clear admin temporary-password tag when linked to staff. */
  changePassword?(currentPassword: string, nextPassword: string): Promise<void>
  /** Send Firebase password-reset email (forgot password). */
  requestPasswordReset?(email: string): Promise<void>
  me?(): Promise<AuthUser>
  /** Current user plus effective RBAC permissions. */
  session?(): Promise<{ user: AuthUser; permissions: string[] }>
}

export type StudentInput = Omit<Student, 'id'>
export type StudentUpdate = Partial<Omit<Student, 'id'>>
export type GuardianInput = Omit<Guardian, 'id'>
export type GuardianUpdate = Partial<Omit<Guardian, 'id'>>

export interface StudentService {
  list(opts?: { classId?: string }): Promise<Student[]>
  getById(id: string): Promise<Student | undefined>
  create(input: StudentInput): Promise<Student>
  update(id: string, patch: StudentUpdate): Promise<Student>
  archive?(id: string): Promise<Student>
  remove?(id: string): Promise<{ deleted: true; id: string }>
  transfer?(input: {
    studentId: string
    toClassId: string
    reason?: string
    notes?: string
    date?: string
  }): Promise<{ student: Student; transfer: import('@/types').ClassTransfer }>
  listTransfers?(studentId: string): Promise<import('@/types').ClassTransfer[]>
  listExemptions?(studentId: string): Promise<import('@/types').StudentExemption[]>
  createExemption?(
    studentId: string,
    input: Omit<import('@/types').StudentExemption, 'id' | 'studentId' | 'createdBy' | 'createdAt' | 'active' | 'createdByName'> & {
      studentId?: string
    },
  ): Promise<import('@/types').StudentExemption>
  deactivateExemption?(studentId: string, exemptionId: string): Promise<import('@/types').StudentExemption>
  listScholarships?(studentId: string): Promise<import('@/types').StudentScholarship[]>
  createScholarship?(
    studentId: string,
    input: Omit<
      import('@/types').StudentScholarship,
      'id' | 'studentId' | 'active' | 'createdBy' | 'createdByName' | 'createdAt'
    >,
  ): Promise<import('@/types').StudentScholarship>
  deactivateScholarship?(
    studentId: string,
    scholarshipId: string,
  ): Promise<import('@/types').StudentScholarship>
  getPortalAccess?(studentId: string): Promise<import('@/types').StudentPortalAccess>
  /** Issue or regenerate this month's portal code (fee-cleared students only). */
  issuePortalCode?(studentId: string): Promise<import('@/types').StudentPortalAccess>
  revokePortalAccess?(studentId: string): Promise<import('@/types').StudentPortalAccess>
  issuePortalCodesForClass?(classId: string): Promise<import('@/types').StudentPortalBatchRow[]>
}

export interface DashboardService {
  getStats(): Promise<DashboardStats>
  getEnrollmentTrend(): Promise<{ month: string; students: number }[]>
  getAttendanceOverview(): Promise<{ name: string; value: number }[]>
  getFeeCollection(): Promise<{ month: string; collected: number; outstanding: number }[]>
  getPerformance(): Promise<{ subject: string; average: number }[]>
  getRecentPayments(): Promise<Payment[]>
  getRecentActivities(): Promise<{ id: string; title: string; detail: string; at: string }[]>
}

export type CreateStaffInput = Omit<Staff, 'id'> & { password?: string }
