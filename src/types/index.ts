export type UserRole =
  | 'SUPER_ADMIN'
  | 'SCHOOL_ADMIN'
  | 'PRINCIPAL'
  | 'TEACHER'
  | 'ACCOUNTANT'
  | 'FINANCE_OFFICER'
  | 'REGISTRAR'
  | 'RECEPTIONIST'
  | 'STUDENT'
  | 'PARENT'
  | 'LIBRARIAN'
  | 'TRANSPORT_MANAGER'

export type StudentStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'GRADUATED'
  | 'TRANSFERRED'
  | 'SUSPENDED'
  | 'WITHDRAWN'
  | 'ARCHIVED'

export type ClassStatus = 'ACTIVE' | 'ARCHIVED'

export type ExemptionType = 'SUBJECT' | 'SPORT' | 'ACTIVITY' | 'OTHER'

export type ClubActivityType = 'CLUB' | 'SOCIETY' | 'ACTIVITY' | 'OTHER'

/** Role category for teachers & staff directory (not the same as portal UserRole). */
export type StaffCategory =
  | 'TEACHER'
  | 'COACH'
  | 'SPORTS_OFFICIAL'
  | 'MEDIC'
  | 'ADMINISTRATION'
  | 'SUPPORT_STAFF'
  | 'ACCOUNTANT'
  | 'LIBRARIAN'
  | 'OTHER'

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED' | 'AUTHORIZED_ABSENCE'
export type PaymentStatus = 'PENDING' | 'CONFIRMED' | 'REVERSED' | 'CANCELLED'
export type ResultAccessState =
  | 'RESULTS_AVAILABLE'
  | 'RESULTS_LOCKED_FEES'
  | 'RESULTS_NOT_PUBLISHED'
  | 'ACCOUNT_RESTRICTED'
export type MarkWorkflowStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'LOCKED'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
  avatarUrl?: string | null
  /** Firestore file id for avatar when using chunked file storage. */
  avatarFileId?: string | null
  phone?: string
  title?: string
  department?: string
  employeeNumber?: string
  /** Links profile updates to the staff directory when present. */
  staffId?: string
  studentId?: string
  guardianId?: string
  bio?: string
  preferredLanguage?: 'en' | 'sn' | 'nd'
  timezone?: string
  notificationPrefs?: {
    email: boolean
    sms: boolean
    inApp: boolean
  }
  securityPrefs?: {
    requireReauthForFees: boolean
  }
}

/** School identity shown on reports, receipts, and the console. */
export interface SchoolProfile {
  id: 'schoolProfile'
  name: string
  motto?: string
  address: string
  phone: string
  email: string
  website?: string
  registrationNumber?: string
  updatedAt?: string
  updatedBy?: string
}

/** How a student attends school — drives which term fee they are billed. */
export type StudentResidency = 'DAY' | 'BOARDER' | 'NON_FORMAL'

/** Term fee categories configured in Settings → Fees. */
export type FeeCategory = 'BOARDING' | 'DAY' | 'PRIMARY' | 'NON_FORMAL'

export type TermFeeAmounts = Record<FeeCategory, number>

/** Fee and receipt policy for the school. */
export interface FeePolicy {
  id: 'feePolicy'
  currency: string
  receiptPrefix: string
  nextReceiptNumber: number
  blockResultsWhenFeesOutstanding: boolean
  overdueGraceDays: number
  /** Amount billed per student per term, by fee category. */
  termFees: TermFeeAmounts
  updatedAt?: string
  updatedBy?: string
}

export interface Student {
  id: string
  studentNumber: string
  admissionNumber: string
  firstName: string
  middleName?: string
  lastName: string
  dateOfBirth: string
  gender: 'Male' | 'Female'
  email?: string
  phone?: string
  address: string
  admissionDate: string
  status: StudentStatus
  /** Day scholar, boarder, or non-formal learner (defaults to day). */
  residency?: StudentResidency
  classId: string
  streamId: string
  /** Canonical education level id (ecd, grade-1, form-1, …). */
  educationLevelId?: string
  academicYearId?: string
  termId?: string
  /** Subjects the student is registered for. */
  subjectIds: string[]
  sportIds?: string[]
  clubIds?: string[]
  houseId?: string
  guardianIds: string[]
  /** Firestore `files/{id}` reference — never store image bytes here. */
  profilePhotoId?: string
}

export interface StaffLoginCredential {
  staffId: string
  email: string
  /** Admin-issued temporary password (shown on login sheet until reset again). */
  password: string
  role: Extract<UserRole, 'TEACHER' | 'SCHOOL_ADMIN' | 'PRINCIPAL' | 'ACCOUNTANT' | 'REGISTRAR'>
  /** True when the password was issued by an admin and should be changed after first login. */
  temporaryPassword?: boolean
  lastResetAt?: string
}

export type StudentPortalStatus = 'NONE' | 'ACTIVE' | 'EXPIRED' | 'REVOKED'

/** Student results-portal login (student number + admin-issued monthly code). */
export interface StudentPortalAccess {
  studentId: string
  /** Sign-in username. */
  studentNumber: string
  status: StudentPortalStatus
  /** Admin-issued code; empty once the student has changed it. */
  code?: string
  codeChangedByStudent?: boolean
  /** `YYYY-MM` month the code is valid for. */
  validMonth?: string
  expiresAt?: string
  issuedAt?: string
  issuedByName?: string
  feeCleared: boolean
  /** Why a code cannot be issued right now (e.g. outstanding fees). */
  feeMessage?: string
}

export interface StudentPortalBatchRow {
  studentId: string
  studentNumber: string
  name: string
  code?: string
  expiresAt?: string
  skipped?: string
}

export interface Guardian {
  id: string
  firstName: string
  lastName: string
  relationship: string
  email: string
  phone: string
  address: string
  studentIds: string[]
  occupation?: string
  /** Marked as the primary emergency contact when true. */
  emergencyContact?: boolean
}

/** Admin-issued portal suspension (INACTIVE while this is in effect). */
export interface StaffSuspension {
  reason: string
  /** ISO date (YYYY-MM-DD) when suspension started. */
  startsAt: string
  /**
   * ISO date (YYYY-MM-DD) when access resumes, or null for indefinite
   * (admin must reactivate).
   */
  endsAt: string | null
  suspendedAt: string
  suspendedBy: string
  suspendedByName?: string
}

export interface Staff {
  id: string
  employeeNumber: string
  firstName: string
  lastName: string
  email: string
  phone: string
  department: string
  title: string
  /** Staff type (teacher, coach, medic, admin, …). */
  category?: StaffCategory
  status: 'ACTIVE' | 'INACTIVE'
  /** Present while suspended / inactivated by an admin. */
  suspension?: StaffSuspension | null
  subjectIds: string[]
  classIds: string[]
  hireDate: string
  /**
   * Per-teacher RBAC overrides (grant/deny on top of TEACHER role defaults).
   * Only admins with teachers.manage / roles.manage may edit.
   */
  permissionOverrides?: {
    grant?: string[]
    deny?: string[]
  }
  /** Firestore `files/{id}` reference — never store image bytes here. */
  profilePhotoId?: string
  /**
   * @deprecated Local preview/cache only. Prefer `profilePhotoId` + fileService.
   */
  photoUrl?: string
}

/** One band in the school grading scale (percent of max score). */
export interface GradeBand {
  grade: string
  minPercent: number
  maxPercent: number
}

/** High-school mark schemes: O-Level (Form 1–4) and A-Level (Form 5–6). */
export type GradingTrack = 'FORM_1_4' | 'FORM_5_6'

export interface GradingScale {
  id: GradingTrack
  track: GradingTrack
  label: string
  passMark: number
  bands: GradeBand[]
  updatedAt?: string
  updatedBy?: string
}

export interface GradingScalesBundle {
  FORM_1_4: GradingScale
  FORM_5_6: GradingScale
}

export interface AcademicYear {
  id: string
  name: string
  startDate: string
  endDate: string
  isCurrent: boolean
}

export interface Term {
  id: string
  academicYearId: string
  name: string
  sequence: number
  startDate: string
  endDate: string
}

export interface SchoolClass {
  id: string
  name: string
  /** Display / legacy label — prefer educationLevelId. */
  level: string
  educationLevelId?: string
  academicYearId: string
  termId?: string
  /** 1 | 2 | 3 — denormalized for display when term docs vary. */
  termSequence?: number
  classTeacherId?: string
  /** Subjects offered / undertaken by this class. */
  subjectIds?: string[]
  description?: string
  status?: ClassStatus
  capacity?: number
}

export interface Stream {
  id: string
  classId: string
  name: string
  capacity: number
}

export interface Subject {
  id: string
  code: string
  name: string
  category: string
  /** Levels this subject is offered for (filters student registration). */
  educationLevelIds?: string[]
  teacherIds?: string[]
  active?: boolean
}

export interface SportKitItem {
  id: string
  /** e.g. Jerseys, Match balls, Training balls, Cones, Bibs */
  name: string
  quantity: number
  /** Jersey / kit numbers on hand, e.g. "1–15" or "1,2,3,7" */
  jerseyNumbers?: string
  notes?: string
}

export interface Sport {
  id: string
  name: string
  description?: string
  active: boolean
  /** Head coach (staff id). */
  coachStaffId?: string
  /** Team leader / captain coordinator (staff id). */
  leaderStaffId?: string
  /** Medics / first aiders assigned to this sport. */
  medicStaffIds?: string[]
  /** Other sporting leadership officials. */
  officialStaffIds?: string[]
  /** Equipment and kit inventory for this sport. */
  kits?: SportKitItem[]
}

export interface ClubActivity {
  id: string
  name: string
  type: ClubActivityType
  description?: string
  active: boolean
}

export interface House {
  id: string
  name: string
  color?: string
  active: boolean
}

export interface StudentExemption {
  id: string
  studentId: string
  type: ExemptionType
  /** Subject / sport / club id when applicable. */
  targetId?: string
  targetLabel: string
  reason: string
  startDate: string
  endDate?: string
  notes?: string
  createdBy: string
  createdByName?: string
  createdAt: string
  active: boolean
}

export interface ClassTransfer {
  id: string
  studentId: string
  fromClassId: string
  toClassId: string
  fromStreamId?: string
  toStreamId?: string
  date: string
  reason?: string
  notes?: string
  transferredBy: string
  transferredByName?: string
}

export interface StudentClassStats {
  totalStudents: number
  totalClasses: number
  ecdStudents: number
  primaryStudents: number
  secondaryStudents: number
  activeStudents: number
  transferredStudents: number
  archivedStudents: number
  classDistribution: { classId: string; className: string; count: number }[]
}

export interface AttendanceRecord {
  id: string
  date: string
  studentId: string
  classId: string
  streamId: string
  subjectId?: string
  status: AttendanceStatus
  recordedBy: string
  /** Homeroom daily register vs subject period mark. */
  kind?: 'DAILY' | 'PERIOD'
  recordedAt?: string
}

/** One submitted daily register for a class on a date. */
export interface AttendanceSession {
  id: string
  date: string
  classId: string
  className?: string
  submittedAt: string
  submittedBy: string
  submittedByName?: string
  presentCount: number
  absentCount: number
  lateCount?: number
  excusedCount?: number
  totalCount: number
}

export type AppNotificationType =
  | 'REGISTER_SUBMITTED'
  | 'REGISTER_SUBMITTED_DIGEST'
  | 'REGISTER_MISSING'

export interface AppNotificationClassContact {
  classId: string
  className: string
  teacherName?: string
  teacherPhone?: string
  teacherEmail?: string
}

/** In-app notification (admin bell + list). */
export interface AppNotification {
  id: string
  audience: 'ADMIN'
  type: AppNotificationType
  title: string
  body: string
  createdAt: string
  read: boolean
  /** Attendance calendar date (YYYY-MM-DD) when relevant. */
  date?: string
  href?: string
  meta?: {
    classId?: string
    className?: string
    teacherName?: string
    count?: number
    classes?: AppNotificationClassContact[]
  }
}

export interface Examination {
  id: string
  name: string
  termId: string
  startDate: string
  endDate: string
  status: 'SCHEDULED' | 'ONGOING' | 'COMPLETED'
}

export interface Assessment {
  id: string
  examinationId?: string
  name: string
  /** MONTHLY | WEEKLY | MOCK | TERMLY */
  type: string
  subjectId: string
  streamId: string
  termId: string
  maxScore: number
  status: MarkWorkflowStatus
  /** Class for class-scoped assessments (e.g. monthly / termly entry). */
  classId?: string
  /** YYYY-MM for monthly / mock tests. */
  month?: string
  /** YYYY-MM-DD week start for weekly tests (also may be stored in month). */
  weekOf?: string
  /** Staff who last entered / submitted marks. */
  enteredBy?: string
  enteredByName?: string
  submittedAt?: string
  approvedAt?: string
  approvedBy?: string
}

export type MarkCommentMode = 'NONE' | 'AUTO' | 'CUSTOM'

export interface Mark {
  id: string
  assessmentId: string
  studentId: string
  score: number
  grade: string
  status: MarkWorkflowStatus
  /** How the comment was produced. */
  commentMode?: MarkCommentMode
  /** Teacher remark shown on the student portal when published. */
  comment?: string
  recordedAt?: string
  recordedBy?: string
}

export interface FeeStructure {
  id: string
  name: string
  academicYearId: string
  classId: string
  items: { name: string; amount: number }[]
}

export interface Invoice {
  id: string
  studentId: string
  number: string
  dueDate: string
  total: number
  paid: number
  status: 'OPEN' | 'PARTIAL' | 'PAID' | 'OVERDUE'
  /** Set on term fee invoices. */
  termId?: string
  termName?: string
  category?: FeeCategory
  createdAt?: string
}

export interface Payment {
  id: string
  studentId: string
  invoiceId: string
  amount: number
  method: string
  status: PaymentStatus
  paidAt: string
  receiptNumber: string
  recordedByName?: string
}

export interface RecordPaymentInput {
  studentId: string
  invoiceId: string
  amount: number
  method: string
  /** Blank → next receipt number from Settings → Fees. */
  receiptNumber?: string
  paidAt?: string
}

export interface RecordPaymentResult {
  payment: Payment
  invoice: Invoice
  /** True when the student has no outstanding balance left (portal passcode can be issued). */
  feesCleared: boolean
}

/** Outcome of billing every active student for a term. */
export interface TermBillingResult {
  termId: string
  termName: string
  created: number
  updated: number
  unchanged: number
  skipped: number
}

/** Daily check-in: school geofence and rules (`settings/checkin`). */
export interface CheckinSettings {
  id: 'checkin'
  siteName: string
  /** Centre of the school premises; null until an administrator sets it. */
  latitude: number | null
  longitude: number | null
  radiusMeters: number
  /** Check-in and check-out only succeed inside the boundary. */
  requireInside: boolean
  /** HH:mm school time after which a check-in counts as late; '' turns late marking off. */
  lateAfter: string
  /** 0 = Sunday … 6 = Saturday. */
  workingDays: number[]
  updatedAt?: string
  updatedBy?: string
}

export type CheckinSettingsInput = Omit<CheckinSettings, 'id' | 'updatedAt' | 'updatedBy'>

/** One staff member's attendance for one school day (`staffCheckins/{uid}_{date}`). */
export interface StaffCheckin {
  id: string
  uid: string
  staffId?: string
  name: string
  role: UserRole
  department?: string
  employeeNumber?: string
  /** YYYY-MM-DD, school time. */
  date: string
  checkInAt: string
  checkInLatitude: number
  checkInLongitude: number
  checkInAccuracy: number | null
  /** Metres from the centre of the premises. */
  checkInDistance: number
  checkInInside: boolean
  late: boolean
  checkOutAt?: string
  checkOutLatitude?: number
  checkOutLongitude?: number
  checkOutAccuracy?: number | null
  checkOutDistance?: number
  checkOutInside?: boolean
  /** Premises exit currently in progress. */
  openExitId?: string | null
  exitCount: number
  /** Total closed time off the premises today, in seconds. */
  secondsOutside: number
  siteName: string
  updatedAt: string
}

/** A period a checked-in staff member spent outside the school boundary. */
export interface StaffBoundaryEvent {
  id: string
  uid: string
  staffId?: string
  name: string
  department?: string
  date: string
  /** `${uid}_${YYYY-MM}` for per-person monthly lookups. */
  monthKey: string
  status: 'OPEN' | 'CLOSED'
  exitAt: string
  returnAt?: string
  durationSeconds?: number
  latitude: number
  longitude: number
  distanceFromBoundary: number
  distanceFromCentre: number
  maxDistanceFromBoundary: number
  maxDistanceFromCentre: number
  reason?: string
  reasonNote?: string
  closedBy?: 'RETURN' | 'CHECK_OUT'
  createdAt: string
  updatedAt: string
}

export type CheckinMessageKind = 'ABSENCE' | 'ISSUE'
export type CheckinMessageStatus = 'OPEN' | 'SEEN' | 'RESOLVED'

/** Absence notice or check-in problem sent by a staff member to the administrators. */
export interface StaffCheckinMessage {
  id: string
  uid: string
  staffId?: string
  name: string
  role: UserRole
  department?: string
  kind: CheckinMessageKind
  category: string
  details: string
  /** YYYY-MM-DD the absence notice is for. */
  absenceDate?: string
  status: CheckinMessageStatus
  adminReply?: string
  repliedAt?: string
  repliedByName?: string
  createdAt: string
  updatedAt: string
}

export interface CheckinRosterEntry {
  uid: string
  staffId?: string
  name: string
  role: UserRole
  department?: string
  employeeNumber?: string
  category?: StaffCategory
}

export interface CheckinTermRange {
  startDate: string
  endDate: string
}

export interface CheckinSelfBundle {
  settings: CheckinSettings
  /** YYYY-MM-DD, school time. */
  today: string
  serverTime: string
  month: string
  todayRecord: StaffCheckin | null
  todayEvents: StaffBoundaryEvent[]
  records: StaffCheckin[]
  events: StaffBoundaryEvent[]
  messages: StaffCheckinMessage[]
  terms: CheckinTermRange[]
}

export interface CheckinAdminBundle {
  settings: CheckinSettings
  today: string
  serverTime: string
  month: string
  roster: CheckinRosterEntry[]
  records: StaffCheckin[]
  events: StaffBoundaryEvent[]
  messages: StaffCheckinMessage[]
  terms: CheckinTermRange[]
}

export type CheckinPosition = { latitude: number; longitude: number; accuracy?: number | null }

export type CheckinPunchInput = CheckinPosition & { action: 'CHECK_IN' | 'CHECK_OUT' }

export type BoundaryUpdateInput =
  | ({ action: 'EXIT' } & CheckinPosition)
  | ({ action: 'PROGRESS' | 'RETURN'; eventId: string } & CheckinPosition)
  | { action: 'REASON'; eventId: string; reason: string; reasonNote?: string }

export interface BoundaryUpdateResult {
  event: StaffBoundaryEvent
  record: StaffCheckin
}

export interface CheckinMessageInput {
  kind: CheckinMessageKind
  category: string
  details: string
  absenceDate?: string
}

export interface CheckinMessageUpdate {
  status?: CheckinMessageStatus
  adminReply?: string
}

export interface Announcement {
  id: string
  title: string
  body: string
  audience: string[]
  status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'
  publishedAt?: string
  author: string
}

export interface LibraryBook {
  id: string
  title: string
  author: string
  category: string
  isbn: string
  copies: number
  available: number
}

export interface LibraryLoan {
  id: string
  bookId: string
  studentId: string
  borrowedAt: string
  dueAt: string
  returnedAt?: string
  fine: number
}

/** School asset / inventory stock status. */
export type InventoryAssetStatus = 'IN_STOCK' | 'DISPATCHED' | 'SOLD' | 'WRITTEN_OFF'

export interface InventoryItem {
  id: string
  name: string
  category: string
  /** Internal stock / catalogue code. */
  sku: string
  /** Official registration / serial / asset tag. */
  registrationNumber?: string
  quantity: number
  location: string
  supplier: string
  /** Purchase / acquisition value (unit or lot). */
  purchaseValue: number
  purchaseDate: string
  /** Firestore file id for receipt photo / scan. */
  receiptFileId?: string
  status: InventoryAssetStatus
  dispatchedTo?: string
  dispatchedAt?: string
  soldAmount?: number
  soldAt?: string
  notes?: string
  createdAt?: string
  updatedAt?: string
}

export type TransportVehicleType = 'BUS' | 'VAN' | 'MINIBUS' | 'OTHER'
export type TransportVehicleStatus = 'ACTIVE' | 'MAINTENANCE' | 'RETIRED'

export interface TransportVehicle {
  id: string
  name: string
  registrationNumber: string
  capacity: number
  type: TransportVehicleType
  status: TransportVehicleStatus
  notes?: string
}

export interface TransportStop {
  id: string
  name: string
  /** Morning pickup HH:mm */
  pickupTime: string
  /** Afternoon drop HH:mm */
  dropTime: string
  order: number
}

export interface TransportRoute {
  id: string
  name: string
  /** Linked fleet vehicle (preferred). */
  vehicleId?: string
  /** Display label when vehicleId is unset (legacy). */
  vehicle: string
  driver: string
  driverPhone?: string
  /** Monthly transport fee for this route. */
  fee: number
  stops: TransportStop[]
  /** @deprecated Prefer TransportRider records. Kept for display fallbacks. */
  studentIds: string[]
  active: boolean
}

export type TransportRiderStatus = 'ACTIVE' | 'SUSPENDED' | 'LEFT'

/** Student subscribed to a bus route. */
export interface TransportRider {
  id: string
  studentId: string
  routeId: string
  /** Monthly amount due (defaults to route fee). */
  monthlyFee: number
  status: TransportRiderStatus
  startedAt: string
  endedAt?: string
  notes?: string
}

/** One month’s transport payment for a rider. */
export interface TransportPayment {
  id: string
  riderId: string
  studentId: string
  routeId: string
  amount: number
  /** Billing month YYYY-MM */
  month: string
  paidAt: string
  method: string
  receiptNumber?: string
  recordedBy?: string
  notes?: string
}

export interface AppUser {
  id: string
  name: string
  email: string
  role: UserRole
  status: 'ACTIVE' | 'DISABLED'
  lastLogin?: string
  title?: string
  staffId?: string
  createdAt?: string
}

export interface RolePermission {
  role: UserRole
  /** Effective permissions after school-level grant/deny. */
  permissions: string[]
  /** School-level adds on top of the role baseline. */
  grant?: string[]
  /** School-level removals from the role baseline. */
  deny?: string[]
  /** True when this role’s matrix is locked (e.g. SUPER_ADMIN). */
  locked?: boolean
}

export interface AuditLog {
  id: string
  /** Display name when known; falls back to actor id. */
  user: string
  actorId?: string
  actorName?: string
  actorEmail?: string
  actorRole?: UserRole
  action: string
  module: string
  record: string
  entityId?: string
  status: 'SUCCESS' | 'FAILED' | 'WARNING'
  at: string
  metadata?: Record<string, unknown> | null
  /** Human-readable summary for the UI. */
  summary?: string
}

export interface DashboardStats {
  totalStudents: number
  totalTeachers: number
  todayAttendancePct: number
  outstandingFees: number
  feesCollected: number
  pendingResults: number
}

export interface EnrollmentPoint {
  month: string
  students: number
}

export interface ResultPortalView {
  studentId: string
  studentName: string
  className: string
  streamName: string
  academicYear: string
  term: string
  accessState: ResultAccessState
  /** Latest / mixed subject rows (includes comments when published). */
  subjects: { name: string; score: number; grade: string; comment?: string; type?: string }[]
  /** Structured monthly progress for the student portal. */
  monthly?: {
    month: string
    label: string
    rows: {
      subject: string
      score: number
      grade: string
      maxScore: number
      comment?: string
    }[]
    average?: number
  }[]
  /** End-of-term results grouped by term. */
  termly?: {
    termId: string
    termName: string
    rows: {
      subject: string
      score: number
      grade: string
      maxScore: number
      comment?: string
    }[]
    average?: number
  }[]
  /** Academic cumulative average (ACC) across published scores. */
  overallAverage?: number
  /** Class (homeroom) teacher end-of-term / final report comment. */
  teacherComment?: string
}

export interface ClassTeacherReport {
  id: string
  classId: string
  studentId: string
  termId: string
  comment: string
  updatedAt: string
  updatedBy: string
  updatedByName?: string
}

export type ClassResultsPeriod = 'TERM' | 'MONTH'

export interface ClassResultsSubjectScore {
  subjectId: string
  subjectName: string
  score: number
  maxScore: number
  percent: number
  grade: string
}

export interface ClassResultsStudentRow {
  studentId: string
  subjects: ClassResultsSubjectScore[]
  average: number | null
  grade?: string
  position?: number
}

export interface ClassResultsSummary {
  classId: string
  period: ClassResultsPeriod
  termId?: string
  month?: string
  subjects: { id: string; name: string }[]
  students: ClassResultsStudentRow[]
}

export type DutyDay = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI'

export interface DutyRosterEntry {
  day: DutyDay
  duty: string
  assigneeName?: string
  studentId?: string
  notes?: string
}

export interface DutyRoster {
  id: string
  classId: string
  /** YYYY-MM-DD week starting Monday */
  weekOf: string
  entries: DutyRosterEntry[]
  updatedAt: string
  updatedBy: string
  updatedByName?: string
}
