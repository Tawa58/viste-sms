/**
 * Bridge to the Viste SMS Android app (mobile/). The Android WebView injects
 * `window.VisteAndroid`; in a normal browser it is absent and every helper
 * falls back to the standard web behaviour.
 */
type VisteAndroidBridge = {
  printHtml(html: string, jobName: string): void
  saveFile(base64: string, fileName: string, mimeType: string): void
  copyText(text: string): void
  setDarkTheme(dark: boolean): void
}

function bridge(): VisteAndroidBridge | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { VisteAndroid?: VisteAndroidBridge }).VisteAndroid ?? null
}

export function isAndroidApp(): boolean {
  return bridge() !== null
}

/** True inside the Viste SMS Windows desktop app (electron/), which exposes `window.visteDesktop`. */
export function isDesktopApp(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean((window as unknown as { visteDesktop?: { isDesktop?: boolean } }).visteDesktop?.isDesktop)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
    reader.readAsDataURL(blob)
  })
}

/** In the Android app, save a file to Downloads and open it. Returns false in a browser. */
export async function saveBlobInApp(blob: Blob, fileName: string): Promise<boolean> {
  const native = bridge()
  if (!native) return false
  native.saveFile(await blobToBase64(blob), fileName, blob.type || 'application/octet-stream')
  return true
}

/** In the Android app, open the system print dialog (print or Save as PDF). Returns false in a browser. */
export function printHtmlInApp(html: string, jobName: string): boolean {
  const native = bridge()
  if (!native) return false
  native.printHtml(html, jobName)
  return true
}

/** Match the Android status and navigation bar colours to the app theme. */
export function syncAndroidTheme(dark: boolean): void {
  bridge()?.setDarkTheme(dark)
}

/** Copy text to the clipboard, using the Android clipboard inside the app. */
export async function copyText(text: string): Promise<void> {
  const native = bridge()
  if (native) {
    native.copyText(text)
    return
  }
  await navigator.clipboard.writeText(text)
}
