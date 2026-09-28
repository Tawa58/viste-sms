import { useSyncExternalStore } from 'react'
import { isAndroidApp } from '@/lib/native-app'

/**
 * "Install app" support for the website (Progressive Web App). Chrome installs the site as a
 * real Android app signed by Google, so users never deal with APK files or unknown sources.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** How this device can install the app: native prompt, manual steps, or not at all. */
export type InstallMode = 'prompt' | 'ios' | 'open-in-chrome' | null

let deferredPrompt: BeforeInstallPromptEvent | null = null
let initialized = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isInsideWrapperApp() {
  return isAndroidApp() || /Electron/i.test(navigator.userAgent)
}

export function initPwa() {
  if (typeof window === 'undefined' || initialized) return
  initialized = true

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    emit()
  })

  if ('serviceWorker' in navigator && window.isSecureContext && !isInsideWrapperApp()) {
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* install still works without offline support */
      })
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }
}

function currentMode(): InstallMode {
  if (isStandalone() || isInsideWrapperApp()) return null
  if (deferredPrompt) return 'prompt'
  const ua = navigator.userAgent
  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (ios) return 'ios'
  // Android browsers that cannot install web apps (phone-maker browsers, in-app browsers).
  const android = /android/i.test(ua)
  const chromeLike = /Chrome\/\d+/.test(ua) && !/; wv\)|PHX\/|Phoenix|OPR\/|OPiOS|UCBrowser|MiuiBrowser|HeyTapBrowser/i.test(ua)
  if (android && !chromeLike) return 'open-in-chrome'
  return null
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribe, currentMode, () => null)
}

/** Show Chrome's install dialog. Returns true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferredPrompt
  if (!event) return false
  deferredPrompt = null
  await event.prompt()
  const choice = await event.userChoice
  emit()
  return choice.outcome === 'accepted'
}
