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

export function getNavGroupsForRole(
  role: UserRole,
  permissions?: readonly string[] | null,
): NavGroup[] {
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
  return mainNav.filter((item) => canAccessPath(role, item.to, permissions))
}
