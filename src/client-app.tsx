'use client'

import { useEffect, useState } from 'react'
import { AuthProvider } from '@/contexts/auth-context'
import { ThemeProvider } from '@/contexts/theme-provider'
import { WelcomeSplash } from '@/components/shared/welcome-splash'
import { initPwa } from '@/lib/pwa'
import App from '@/App'

const SPLASH_MS = 7000

initPwa()

/** Mounts the existing React UI after a branded 7s welcome splash. */
export function ClientApp() {
  const [ready, setReady] = useState(false)
  const [splashDone, setSplashDone] = useState(false)

  useEffect(() => {
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => setSplashDone(true), SPLASH_MS)
    return () => window.clearTimeout(timer)
  }, [ready])

  if (!ready || !splashDone) {
    return <WelcomeSplash />
  }

  return (
    <ThemeProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ThemeProvider>
  )
}
