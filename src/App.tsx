import { Suspense, lazy, type ComponentType } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/auth-context'
import { AppShell } from '@/layouts/app-shell'
import { AppToaster } from '@/components/shared/app-toaster'
import { WelcomeSplash } from '@/components/shared/welcome-splash'
import { canAccessPath } from '@/lib/roles'

function isChunkLoadError(err: unknown) {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; message?: string }
  return (
    e.name === 'ChunkLoadError' ||
    (typeof e.message === 'string' &&
      (e.message.includes('Loading chunk') ||
        e.message.includes('Failed to fetch dynamically imported module') ||
        e.message.includes('error loading dynamically imported module')))
  )
}

/**
 * Hard navigation with a cache-bust query when a tab still references chunks
 * from a previous Vercel deploy (classic ChunkLoadError / 404).
 */
function reloadForStaleChunks() {
  if (typeof window === 'undefined') return
  const key = 'viste.chunk-reload'
  try {
    const attempts = Number(sessionStorage.getItem(key) || '0')
    if (attempts >= 3) return
    sessionStorage.setItem(key, String(attempts + 1))
  } catch {
    /* private mode */
  }
  try {
    const path = window.location.pathname || '/'
    window.location.replace(`${path}?_r=${Date.now()}`)
  } catch {
    window.location.reload()
  }
}

function lazyPage<T extends ComponentType<object>>(
  factory: () => Promise<{ default: T } | Record<string, T>>,
  exportName?: string,
) {
  return lazy(async () => {
    try {
      const mod = await factory()
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem('viste.chunk-reload')
        } catch {
          /* ignore */
        }
      }
      if (exportName && exportName in mod) {
        return { default: (mod as Record<string, T>)[exportName]! }
      }
      return mod as { default: T }
    } catch (err) {
      if (isChunkLoadError(err)) {
        reloadForStaleChunks()
      }
      throw err
    }
  })
}

const LoginPage = lazyPage(() => import('@/views/login-page'), 'LoginPage')
const DashboardPage = lazyPage(() => import('@/views/dashboard-page'), 'DashboardPage')
const StudentsPage = lazyPage(() => import('@/views/students-page'), 'StudentsPage')
const StudentDetailPage = lazyPage(() => import('@/views/student-detail-page'), 'StudentDetailPage')
const TeachersPage = lazyPage(() => import('@/views/teachers-page'), 'TeachersPage')
const TeacherDetailPage = lazyPage(() => import('@/views/teachers-page'), 'TeacherDetailPage')
const ClassesPage = lazyPage(() => import('@/views/classes-page'), 'ClassesPage')
const ClassDetailPage = lazyPage(() => import('@/views/class-detail-page'), 'ClassDetailPage')
const SubjectsPage = lazyPage(() => import('@/views/subjects-page'), 'SubjectsPage')
const SportsPage = lazyPage(() => import('@/views/extracurricular-page'), 'SportsPage')
const ClubsPage = lazyPage(() => import('@/views/extracurricular-page'), 'ClubsPage')
const AttendancePage = lazyPage(() => import('@/views/attendance-page'), 'AttendancePage')
const ExaminationsPage = lazyPage(() => import('@/views/exams-results-page'), 'ExaminationsPage')
const ResultsPage = lazyPage(() => import('@/views/exams-results-page'), 'ResultsPage')
const FeesPage = lazyPage(() => import('@/views/fees-page'), 'FeesPage')
const ParentsPage = lazyPage(() => import('@/views/fees-parents-page'), 'ParentsPage')
const ParentDetailPage = lazyPage(() => import('@/views/fees-parents-page'), 'ParentDetailPage')
const ReportsPage = lazyPage(() => import('@/views/reports-page'), 'ReportsPage')
const AnnouncementsPage = lazyPage(() => import('@/views/ops-pages'), 'AnnouncementsPage')
const AuditLogsPage = lazyPage(() => import('@/views/audit-logs-page'), 'AuditLogsPage')
const InventoryPage = lazyPage(() => import('@/views/inventory-page'), 'InventoryPage')
const LibraryPage = lazyPage(() => import('@/views/ops-pages'), 'LibraryPage')
const TransportPage = lazyPage(() => import('@/views/transport-page'), 'TransportPage')
const UsersRolesPage = lazyPage(() => import('@/views/users-roles-page'), 'UsersRolesPage')
const SettingsPage = lazyPage(() => import('@/views/settings-page'), 'SettingsPage')

function RouteFallback() {
  return <WelcomeSplash />
}

function ProtectedRoute() {
  const { user, loading } = useAuth()
  if (loading) {
    return <WelcomeSplash />
  }
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

function RoleRoute() {
  const { user, permissions } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace />
  if (!canAccessPath(user.role, location.pathname, permissions)) {
    return <Navigate to="/dashboard" replace />
  }
  return <Outlet />
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<AppShell />}>
              <Route element={<RoleRoute />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/students" element={<StudentsPage />} />
                <Route path="/students/:id" element={<StudentDetailPage />} />
                <Route path="/teachers" element={<TeachersPage />} />
                <Route path="/teachers/:id" element={<TeacherDetailPage />} />
                <Route path="/classes" element={<ClassesPage />} />
                <Route path="/classes/:id" element={<ClassDetailPage />} />
                <Route path="/subjects" element={<SubjectsPage />} />
                <Route path="/sports" element={<SportsPage />} />
                <Route path="/clubs" element={<ClubsPage />} />
                <Route path="/attendance" element={<AttendancePage />} />
                <Route path="/examinations" element={<ExaminationsPage />} />
                <Route path="/results" element={<ResultsPage />} />
                <Route path="/fees" element={<FeesPage />} />
                <Route path="/parents" element={<ParentsPage />} />
                <Route path="/parents/:id" element={<ParentDetailPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/announcements" element={<AnnouncementsPage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/transport" element={<TransportPage />} />
                <Route path="/users" element={<UsersRolesPage />} />
                <Route path="/roles" element={<Navigate to="/users" replace />} />
                <Route path="/audit-logs" element={<AuditLogsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
      <AppToaster />
    </BrowserRouter>
  )
}
