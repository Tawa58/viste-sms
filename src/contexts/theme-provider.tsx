import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { syncAndroidTheme } from '@/lib/native-app'

type Theme = 'light' | 'dark' | 'system'

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
  resolvedTheme: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function resolveSystem(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Client-only theme provider — no injected <script> (avoids React 19 warning). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('viste.theme') as Theme | null
    return stored ?? 'light'
  })
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')

  useEffect(() => {
    const resolved = theme === 'system' ? resolveSystem() : theme
    setResolvedTheme(resolved)
    document.documentElement.classList.toggle('dark', resolved === 'dark')
    document.documentElement.classList.toggle('light', resolved === 'light')
    localStorage.setItem('viste.theme', theme)
  }, [theme])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolvedTheme(resolveSystem())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  useEffect(() => {
    syncAndroidTheme(resolvedTheme === 'dark')
  }, [resolvedTheme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
