'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { authService } from '@/services/api'
import { USE_MOCK_API } from '@/services/api/client'
import { getFirebaseAuth } from '@/services/firebase/app'
import { clearSchoolDataCache, prefetchSchoolData } from '@/services/api/prefetch'
import { clearAuthTokenCache } from '@/services/api/http-client'
import { mockUsers } from '@/mocks/data'
import type { AuthUser } from '@/types'

type AuthContextValue = {
  user: AuthUser | null
  permissions: string[]
  loading: boolean
  login: (email: string, password: string, remember?: boolean) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (patch: Partial<AuthUser>) => Promise<AuthUser>
  changePassword: (currentPassword: string, nextPassword: string) => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  hasPermission: (permission: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)
const STORAGE_KEY = 'viste.auth.user'
const PERMS_KEY = 'viste.auth.permissions'

function persistUser(user: AuthUser, remember = true, permissions: string[] = []) {
  const payload = JSON.stringify(user)
  const perms = JSON.stringify(permissions)
  sessionStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(STORAGE_KEY)
  sessionStorage.removeItem(PERMS_KEY)
  localStorage.removeItem(PERMS_KEY)
  ;(remember ? localStorage : sessionStorage).setItem(STORAGE_KEY, payload)
  ;(remember ? localStorage : sessionStorage).setItem(PERMS_KEY, perms)
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY)
  sessionStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(PERMS_KEY)
  sessionStorage.removeItem(PERMS_KEY)
}

function readStoredPermissions(): string[] {
  try {
    const raw = localStorage.getItem(PERMS_KEY) ?? sessionStorage.getItem(PERMS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === 'string') : []
  } catch {
    return []
  }
}

async function loadSession(): Promise<{ user: AuthUser; permissions: string[] }> {
  if (authService.session) return authService.session()
  if (authService.me) {
    const user = await authService.me()
    return { user, permissions: readStoredPermissions() }
  }
  throw new Error('Auth session unavailable')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (USE_MOCK_API) {
      const raw = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY)
      if (raw) {
        try {
          const stored = JSON.parse(raw) as AuthUser
          const canonical = mockUsers.find((u) => u.id === stored.id || u.email === stored.email)
          setUser(
            canonical
              ? { ...canonical, ...stored, role: canonical.role, id: canonical.id }
              : stored,
          )
          setPermissions(readStoredPermissions())
        } catch {
          clearSession()
        }
      }
      setLoading(false)
      return
    }

    const unsub = onAuthStateChanged(
      getFirebaseAuth(),
      async (firebaseUser) => {
        try {
          if (!firebaseUser || firebaseUser.isAnonymous) {
            setUser(null)
            setPermissions([])
            clearSession()
            clearSchoolDataCache()
            clearAuthTokenCache()
            return
          }
          const { user: profile, permissions: perms } = await loadSession()
          setUser(profile)
          setPermissions(perms)
          persistUser(profile, true, perms)
          if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            window.requestIdleCallback(() => prefetchSchoolData(), { timeout: 2500 })
          } else {
            setTimeout(() => prefetchSchoolData(), 300)
          }
        } catch (err) {
          console.error('[auth] Could not restore the signed-in session', err)
          setUser(null)
          setPermissions([])
          clearSession()
          clearSchoolDataCache()
          clearAuthTokenCache()
        } finally {
          setLoading(false)
        }
      },
      (err) => {
        console.error('[auth] Firebase auth state listener failed', err)
        setUser(null)
        setPermissions([])
        clearSession()
        clearSchoolDataCache()
        clearAuthTokenCache()
        setLoading(false)
      },
    )

    return () => unsub()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      loading,
      hasPermission: (permission: string) => permissions.includes(permission),
      async login(email, password, remember = true) {
        try {
          await authService.login(email, password, remember)
          const { user: profile, permissions: perms } = await loadSession()
          setUser(profile)
          setPermissions(perms)
          persistUser(profile, remember, perms)
          if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
            window.requestIdleCallback(() => prefetchSchoolData(), { timeout: 2500 })
          } else {
            setTimeout(() => prefetchSchoolData(), 300)
          }
        } catch (err) {
          setUser(null)
          setPermissions([])
          clearSession()
          clearSchoolDataCache()
          clearAuthTokenCache()
          if (!USE_MOCK_API) {
            try {
              await signOut(getFirebaseAuth())
            } catch (signOutError) {
              console.error('[auth] Could not clear Firebase session after login failure', signOutError)
            }
          }
          throw err
        }
      },
      async logout() {
        await authService.logout()
        clearSession()
        clearSchoolDataCache()
        clearAuthTokenCache()
        setUser(null)
        setPermissions([])
      },
      async updateProfile(patch) {
        if (!user) throw new Error('Not signed in')
        const next = await authService.updateProfile(user.id, patch)
        setUser(next)
        persistUser(next, Boolean(localStorage.getItem(STORAGE_KEY)), permissions)
        return next
      },
      async changePassword(currentPassword, nextPassword) {
        if (!authService.changePassword) {
          throw new Error('Password change is not available')
        }
        await authService.changePassword(currentPassword, nextPassword)
      },
      async requestPasswordReset(email) {
        if (!authService.requestPasswordReset) {
          throw new Error('Password reset is not available')
        }
        await authService.requestPasswordReset(email)
      },
    }),
    [user, permissions, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
