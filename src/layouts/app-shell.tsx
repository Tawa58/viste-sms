import { useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Download,
  LogOut,
  Menu,
  Search,
  Settings,
  UserRound,
  X,
} from 'lucide-react'
import { BrandMark } from '@/components/shared/brand-mark'
import { notify } from '@/lib/notify'
import { SchoolLogo } from '@/components/shared/school-logo'
import { ThemeToggle } from '@/components/shared/theme-toggle'
import { PageTransition } from '@/components/shared/page-transition'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useInstallApp } from '@/components/shared/install-app'
import { ResolvedAvatar } from '@/components/shared/resolved-avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/contexts/auth-context'
import { getMainNavForRole, getNavGroupsForRole, type NavGroup } from '@/lib/navigation'
import { canAccessPath } from '@/lib/roles'
import { catalogService } from '@/services/api'
import { cn } from '@/lib/utils'
import type { AppNotification } from '@/types'

function isAdminNotificationsRole(role: string | undefined) {
  return (
    role === 'SUPER_ADMIN' ||
    role === 'SCHOOL_ADMIN' ||
    role === 'PRINCIPAL' ||
    role === 'REGISTRAR'
  )
}

function SidebarNav({ collapsed, groups }: { collapsed: boolean; groups: NavGroup[] }) {
  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
      {groups.map((group) => (
        <div key={group.label}>
          {!collapsed && (
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {group.label}
            </p>
          )}
          <div className="space-y-1">
            {group.items.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-black transition-colors duration-150 hover:bg-sidebar-accent dark:text-sidebar-foreground',
                      isActive && 'bg-sidebar-accent font-semibold text-black shadow-sm dark:text-sidebar-accent-foreground',
                      collapsed && 'justify-center px-2',
                    )
                  }
                  title={item.label}
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />
                      )}
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          isActive
                            ? 'text-primary dark:text-primary'
                            : 'text-accent group-hover:text-primary dark:text-accent',
                        )}
                      />
                      {!collapsed && (
                        <span className="truncate text-black dark:text-inherit">{item.label}</span>
                      )}
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}

export function AppShell() {
  const { user, permissions, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const installApp = useInstallApp()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const canSeeAdminNotifications = isAdminNotificationsRole(user?.role)
  const unreadCount = notifications.filter((n) => !n.read).length

  const roleNav = useMemo(
    () => (user ? getNavGroupsForRole(user.role, permissions) : []),
    [user, permissions],
  )
  const roleMainNav = useMemo(
    () => (user ? getMainNavForRole(user.role, permissions) : []),
    [user, permissions],
  )

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!canSeeAdminNotifications) {
      setNotifications([])
      return
    }
    let cancelled = false
    let inFlight = false
    let failStreak = 0
    let timer: number | undefined

    const BASE_MS = 60_000
    const MAX_MS = 5 * 60_000

    function schedule(delayMs: number) {
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        void load()
      }, delayMs)
    }

    async function load() {
      if (cancelled || inFlight) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        schedule(BASE_MS)
        return
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        failStreak = Math.min(failStreak + 1, 5)
        schedule(Math.min(BASE_MS * 2 ** failStreak, MAX_MS))
        return
      }

      inFlight = true
      try {
        const list = await catalogService.getNotifications()
        if (!cancelled) setNotifications(list)
        failStreak = 0
        schedule(BASE_MS)
      } catch {
        // Network/DNS blips should stay quiet — keep last known list.
        failStreak = Math.min(failStreak + 1, 5)
        schedule(Math.min(BASE_MS * 2 ** failStreak, MAX_MS))
      } finally {
        inFlight = false
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible') void load()
    }
    function onOnline() {
      failStreak = 0
      void load()
    }

    void load()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [canSeeAdminNotifications])

  async function handleNotificationClick(item: AppNotification) {
    try {
      if (!item.read) {
        await catalogService.markNotificationRead(item.id)
        setNotifications((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)),
        )
      }
    } catch (err) {
      console.error(err)
    }
    navigate(item.href || '/attendance')
  }

  async function handleMarkAllRead() {
    try {
      await catalogService.markAllNotificationsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    } catch (err) {
      console.error(err)
    }
  }

  const pageTitle = useMemo(() => {
    const match = roleMainNav.find(
      (item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`),
    )
    return match?.label ?? 'Viste High School'
  }, [location.pathname, roleMainNav])

  const searchLinks = useMemo(
    () =>
      [
        { label: 'Students', to: '/students' },
        { label: 'Teachers & Staff', to: '/teachers' },
        { label: 'Fees & Payments', to: '/fees' },
        { label: 'Attendance', to: '/attendance' },
        { label: 'Results', to: '/results' },
      ].filter((link) => (user ? canAccessPath(user.role, link.to, permissions) : false)),
    [user, permissions],
  )

  async function handleLogout() {
    await notify.process(() => logout(), {
      loading: 'Signing you out…',
      success: 'Signed out successfully',
      error: 'Could not sign out',
    })
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-background">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-300 ease-out lg:flex',
          collapsed ? 'w-[80px]' : 'w-[272px]',
        )}
      >
        <div className={cn('flex items-center justify-between gap-2 px-4 py-5', collapsed && 'px-2')}>
          <BrandMark compact={collapsed} />
          <Button
            variant="ghost"
            size="icon"
            className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight /> : <ChevronLeft />}
          </Button>
        </div>
        <SidebarNav collapsed={collapsed} groups={roleNav} />
        <div className="mt-auto border-t border-sidebar-border p-3">
          <div
            className={cn(
              'flex items-center gap-3 rounded-xl border border-border/70 bg-card p-2.5 shadow-card',
              collapsed && 'justify-center',
            )}
          >
            <ResolvedAvatar
              name={user?.name ?? 'User'}
              src={user?.avatarUrl}
              fileId={user?.avatarFileId}
              access={
                user
                  ? {
                      userId: user.id,
                      role: user.role,
                      staffId: user.staffId,
                      studentId: user.studentId,
                      guardianId: user.guardianId,
                    }
                  : null
              }
            />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-black dark:text-foreground">
                  {user?.name}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {user?.role.replaceAll('_', ' ')}
                </p>
              </div>
            )}
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                onClick={() => setLogoutOpen(true)}
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.button
              type="button"
              className="absolute inset-0 bg-black/45"
              aria-label="Close menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              className="absolute inset-y-0 left-0 flex w-[min(300px,86vw)] flex-col bg-sidebar pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-elevated"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            >
              <div className="flex items-center justify-between gap-2 px-4 py-4">
                <BrandMark />
                <div className="flex items-center gap-1">
                  <ThemeToggle />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-sidebar-foreground hover:bg-sidebar-accent"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Close menu"
                  >
                    <X />
                  </Button>
                </div>
              </div>
              <SidebarNav collapsed={false} groups={roleNav} />
              <div className="border-t border-sidebar-border p-3">
                <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-card p-2.5 shadow-card">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{user?.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user?.role.replaceAll('_', ' ')}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                    onClick={() => {
                      setMobileOpen(false)
                      setLogoutOpen(true)
                    }}
                    aria-label="Sign out"
                  >
                    <LogOut className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div
        className={cn(
          'transition-[padding] duration-300 ease-out',
          collapsed ? 'lg:pl-[80px]' : 'lg:pl-[272px]',
        )}
      >
        <header className="sticky top-0 z-30 border-b border-border/70 bg-card/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
          <div className="flex items-center gap-1.5 px-2 py-2 sm:gap-3 sm:px-6 sm:py-2.5">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu />
            </Button>

            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-2.5">
              <SchoolLogo size="sm" className="hidden min-[380px]:block" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Viste High School</p>
                <p className="truncate text-xs text-muted-foreground">{pageTitle}</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Search">
                    <Search />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-1rem))] p-2">
                  <DropdownMenuLabel className="px-2 pb-2">Search</DropdownMenuLabel>
                  <div className="relative px-1 pb-1">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Students, staff, fees…"
                      className="h-9 pl-9"
                      autoFocus
                    />
                  </div>
                  <DropdownMenuSeparator />
                  {searchLinks.map((link) => (
                    <DropdownMenuItem key={link.to} onClick={() => navigate(link.to)}>
                      {link.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <span className="hidden sm:contents">
                <ThemeToggle />
              </span>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Notifications"
                    className="relative"
                  >
                    <Bell />
                    {canSeeAdminNotifications && unreadCount > 0 ? (
                      <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    ) : null}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-[70dvh] w-[min(24rem,calc(100vw-1rem))] overflow-y-auto"
                >
                  <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                    <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
                    {canSeeAdminNotifications && unreadCount > 0 ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => void handleMarkAllRead()}
                      >
                        Mark all read
                      </button>
                    ) : null}
                  </div>
                  <DropdownMenuSeparator />
                  {!canSeeAdminNotifications ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground">
                      No notifications for this account.
                    </p>
                  ) : notifications.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground">
                      No register alerts yet.
                    </p>
                  ) : (
                    notifications.map((item) => (
                      <DropdownMenuItem
                        key={item.id}
                        className={cn(
                          'flex cursor-pointer flex-col items-start gap-1 whitespace-normal py-2.5',
                          !item.read && 'bg-accent/10',
                        )}
                        onClick={() => void handleNotificationClick(item)}
                      >
                        <span className="text-sm font-medium leading-snug">{item.title}</span>
                        <span className="whitespace-pre-line text-xs text-muted-foreground">
                          {item.body}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString()}
                        </span>
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 px-1.5 sm:px-2" aria-label="Account menu">
                    <ResolvedAvatar
                      name={user?.name ?? 'User'}
                      src={user?.avatarUrl}
                      fileId={user?.avatarFileId}
                      access={
                        user
                          ? {
                              userId: user.id,
                              role: user.role,
                              staffId: user.staffId,
                              studentId: user.studentId,
                              guardianId: user.guardianId,
                            }
                          : null
                      }
                    />
                    <span className="hidden text-left lg:block">
                      <span className="block text-sm font-semibold leading-none">
                        {user?.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {user?.role.replaceAll('_', ' ')}
                      </span>
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>{user?.email}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate('/settings?tab=profile')}>
                    <UserRound className="h-4 w-4" /> My profile
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/settings')}>
                    <Settings className="h-4 w-4" /> Settings
                  </DropdownMenuItem>
                  {installApp.mode ? (
                    <DropdownMenuItem onClick={installApp.start}>
                      <Download className="h-4 w-4" /> Install app
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onClick={() => setLogoutOpen(true)}>
                    <LogOut className="h-4 w-4" /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        <main className="min-w-0 px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-6 lg:px-8">
          <PageTransition key={location.pathname}>
            <Outlet />
          </PageTransition>
        </main>

        <footer className="border-t border-border px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-center text-xs text-muted-foreground sm:px-6">
          Viste High School Management System ·{' '}
          <Link to="/settings" className="underline-offset-2 hover:underline">
            Settings
          </Link>
        </footer>
      </div>

      {installApp.dialog}

      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="Sign out?"
        description="You will need to sign in again to access the school console."
        confirmLabel="Sign out"
        onConfirm={() => {
          void handleLogout()
        }}
      />
    </div>
  )
}
