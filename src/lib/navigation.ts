import {
  LayoutDashboard,
  Users,
  GraduationCap,
  School,
  BookOpen,
  CalendarCheck,
  ClipboardList,
  Trophy,
  Wallet,
  UserRound,
  FileBarChart,
  Megaphone,
  Library,
  Boxes,
  Bus,
  Shield,
  ScrollText,
  Settings,
  Dumbbell,
  Puzzle,
  MapPinCheck,
  UserCheck,
  CalendarClock,
  FileText,
  type LucideIcon,
} from 'lucide-react'
import { canAccessPath } from '@/lib/roles'
import type { UserRole } from '@/types'

export type NavItem = {
  label: string
  to: string
  icon: LucideIcon
}

export type NavGroup = {
  label: string
  items: NavItem[]
}

export const mainNav: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Check in', to: '/check-in', icon: MapPinCheck },
  { label: 'Staff attendance', to: '/staff-attendance', icon: UserCheck },
  { label: 'Students', to: '/students', icon: Users },
  { label: 'Teachers & Staff', to: '/teachers', icon: GraduationCap },
  { label: 'Classes', to: '/classes', icon: School },
  { label: 'Subjects', to: '/subjects', icon: BookOpen },
  { label: 'Sports', to: '/sports', icon: Dumbbell },
  { label: 'Clubs & Activities', to: '/clubs', icon: Puzzle },
  { label: 'Attendance', to: '/attendance', icon: CalendarCheck },
  { label: 'Examinations', to: '/examinations', icon: ClipboardList },
  { label: 'Results', to: '/results', icon: Trophy },
  { label: 'Fees & Payments', to: '/fees', icon: Wallet },
  { label: 'Parents/Guardians', to: '/parents', icon: UserRound },
  { label: 'Reports', to: '/reports', icon: FileBarChart },
  { label: 'Announcements', to: '/announcements', icon: Megaphone },
  { label: 'Library', to: '/library', icon: Library },
  { label: 'Inventory', to: '/inventory', icon: Boxes },
  { label: 'Transport', to: '/transport', icon: Bus },
  { label: 'Users & Roles', to: '/users', icon: Shield },
  { label: 'Audit Logs', to: '/audit-logs', icon: ScrollText },
  { label: 'Settings', to: '/settings', icon: Settings },
]

export const navGroups: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Daily check-in',
    items: [
      { label: 'Check in', to: '/check-in', icon: MapPinCheck },
      { label: 'Staff attendance', to: '/staff-attendance', icon: UserCheck },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Students', to: '/students', icon: Users },
      { label: 'Teachers & Staff', to: '/teachers', icon: GraduationCap },
      { label: 'Parents/Guardians', to: '/parents', icon: UserRound },
    ],
  },
  {
    label: 'Academics',
    items: [
      { label: 'Classes', to: '/classes', icon: School },
      { label: 'Subjects', to: '/subjects', icon: BookOpen },
      { label: 'Sports', to: '/sports', icon: Dumbbell },
      { label: 'Clubs & Activities', to: '/clubs', icon: Puzzle },
      { label: 'Attendance', to: '/attendance', icon: CalendarCheck },
      { label: 'Examinations', to: '/examinations', icon: ClipboardList },
      { label: 'Results', to: '/results', icon: Trophy },
    ],
  },
  {
    label: 'Finance',
    items: [{ label: 'Fees & Payments', to: '/fees', icon: Wallet }],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Reports', to: '/reports', icon: FileBarChart },
      { label: 'Announcements', to: '/announcements', icon: Megaphone },
      { label: 'Library', to: '/library', icon: Library },
      { label: 'Inventory', to: '/inventory', icon: Boxes },
      { label: 'Transport', to: '/transport', icon: Bus },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users & Roles', to: '/users', icon: Shield },
      { label: 'Audit Logs', to: '/audit-logs', icon: ScrollText },
      { label: 'Settings', to: '/settings', icon: Settings },
    ],
  },
]

/** Student portal sidebar — students never see the staff console groups. */
export const studentNavGroups: NavGroup[] = [
  {
    label: 'My school',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
      { label: 'My Profile', to: '/my/profile', icon: UserRound },
      { label: 'Results', to: '/my/results', icon: Trophy },
      { label: 'Attendance', to: '/my/attendance', icon: CalendarCheck },
      { label: 'Timetable', to: '/my/timetable', icon: CalendarClock },
      { label: 'Subjects', to: '/my/subjects', icon: BookOpen },
      { label: 'Fees', to: '/my/fees', icon: Wallet },
      { label: 'Exams', to: '/my/exams', icon: ClipboardList },
      { label: 'Announcements', to: '/my/announcements', icon: Megaphone },
      { label: 'Documents', to: '/my/documents', icon: FileText },
      { label: 'Activities', to: '/my/activities', icon: Puzzle },
    ],
  },
  {
    label: 'Account',
    items: [{ label: 'Settings', to: '/settings', icon: Settings }],
  },
]

/** Staff console paths a student may bookmark, mapped to their portal equivalents. */
export const STUDENT_PATH_REDIRECTS: Record<string, string> = {
  '/results': '/my/results',
  '/attendance': '/my/attendance',
  '/fees': '/my/fees',
  '/announcements': '/my/announcements',
  '/subjects': '/my/subjects',
  '/examinations': '/my/exams',
  '/sports': '/my/activities',
  '/clubs': '/my/activities',
}

export function getNavGroupsForRole(
  role: UserRole,
  permissions?: readonly string[] | null,
): NavGroup[] {
  if (role === 'STUDENT') return studentNavGroups
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessPath(role, item.to, permissions)),
    }))
    .filter((group) => group.items.length > 0)
}

export function getMainNavForRole(
  role: UserRole,
  permissions?: readonly string[] | null,
): NavItem[] {
  if (role === 'STUDENT') return studentNavGroups.flatMap((group) => group.items)
  return mainNav.filter((item) => canAccessPath(role, item.to, permissions))
}
