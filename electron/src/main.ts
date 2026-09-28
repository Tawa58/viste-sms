import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
  type WebPreferences,
} from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { APP_TITLE, APP_USER_MODEL_ID, resolveAppUrl } from './config'
import { log } from './logger'
import { checkForUpdatesManually, initAutoUpdates } from './updater'

const appUrl = resolveAppUrl()
let mainWindow: BrowserWindow | null = null

/** Permissions the web app actually uses (copy buttons, daily check-in location). Everything else is denied. */
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen', 'geolocation'])

function assetPath(...parts: string[]) {
  return path.join(__dirname, '..', 'assets', ...parts)
}

function isAppOrigin(url: string): boolean {
  try {
    return new URL(url).origin === appUrl.origin
  } catch {
    return false
  }
}

/** Print previews and receipt images open as about:blank or same-origin blob: popups. */
function isAllowedPopup(url: string): boolean {
  return (
    url === '' ||
    url === 'about:blank' ||
    url.startsWith(`blob:${appUrl.origin}/`) ||
    isAppOrigin(url)
  )
}

function openExternal(url: string) {
  try {
    const { protocol } = new URL(url)
    if (['https:', 'http:', 'mailto:', 'tel:'].includes(protocol)) void shell.openExternal(url)
  } catch {
    /* ignore malformed links */
  }
}

function secureWebPreferences(extra: WebPreferences = {}): WebPreferences {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: true,
    ...extra,
  }
}

function loadApp(win: BrowserWindow) {
  log(`Loading ${appUrl.toString()}`)
  void win.loadURL(appUrl.toString())
}

function showOfflinePage(win: BrowserWindow, reason: string) {
  const page = pathToFileURL(assetPath('offline.html'))
  page.searchParams.set('url', appUrl.toString())
  page.searchParams.set('reason', reason)
  void win.loadURL(page.toString())
}

/** Applied to every renderer (main window and print/receipt popups). */
function hardenWebContents(contents: WebContents) {
  contents.on('will-navigate', (event, url) => {
    if (isAppOrigin(url)) return
    event.preventDefault()
    openExternal(url)
  })

  contents.on('will-attach-webview', (event) => event.preventDefault())

  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedPopup(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900,
          height: 900,
          autoHideMenuBar: true,
          icon: assetPath('icon.png'),
          parent: mainWindow ?? undefined,
          webPreferences: secureWebPreferences(),
        },
      }
    }
    openExternal(url)
    return { action: 'deny' }
  })
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: APP_TITLE,
    icon: assetPath('icon.png'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences({
      preload: path.join(__dirname, 'preload.js'),
    }),
  })
  mainWindow = win

  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })
  win.on('page-title-updated', (event) => event.preventDefault())
  win.on('closed', () => {
    mainWindow = null
  })

  win.webContents.on('did-fail-load', (_event, code, description, validatedUrl, isMainFrame) => {
    // -3 = navigation aborted (e.g. a newer navigation replaced it)
    if (!isMainFrame || code === -3 || validatedUrl.startsWith('file:')) return
    log(`Load failed (${code} ${description}) for ${validatedUrl}`, 'warn')
    showOfflinePage(win, description || `Error ${code}`)
  })

  win.webContents.on('render-process-gone', async (_event, details) => {
    log(`Renderer gone: ${details.reason} (${details.exitCode})`, 'error')
    if (details.reason === 'clean-exit') return
    const { response } = await dialog.showMessageBox(win, {
      type: 'error',
      title: APP_TITLE,
      message: 'Viste SMS stopped unexpectedly',
      detail: 'Your data is saved online. Reload to continue.',
      buttons: ['Reload', 'Close'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    })
    if (response === 0) loadApp(win)
    else win.close()
  })

  win.on('unresponsive', async () => {
    log('Window unresponsive', 'warn')
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: APP_TITLE,
      message: 'Viste SMS is not responding',
      buttons: ['Wait', 'Reload'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    if (response === 1) loadApp(win)
  })

  loadApp(win)
  return win
}

function buildMenu() {
  const focused = () => BrowserWindow.getFocusedWindow() ?? mainWindow
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => focused()?.webContents.print(),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) loadApp(mainWindow)
          },
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Check for updates…', click: () => checkForUpdatesManually() },
        { label: 'Open Viste SMS in browser', click: () => openExternal(appUrl.toString()) },
        { type: 'separator' },
        {
          label: 'About Viste SMS',
          click: () => {
            const win = focused()
            const options = {
              type: 'info' as const,
              title: 'About Viste SMS',
              message: `Viste SMS ${app.getVersion()}`,
              detail: `Viste School Management System — desktop edition.\n${appUrl.origin}`,
              buttons: ['OK'],
            }
            void (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options))
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function configureSession() {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppOrigin(details.requestingUrl))
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isAppOrigin(requestingOrigin)
  })
}

process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err.stack ?? err.message}`, 'error')
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.setAppUserModelId(APP_USER_MODEL_ID)
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents))

  ipcMain.handle('viste:get-version', (event) => {
    const url = event.senderFrame?.url ?? ''
    if (!isAppOrigin(url) && !url.startsWith('file:')) throw new Error('Not allowed')
    return app.getVersion()
  })

  app
    .whenReady()
    .then(() => {
      log(`Viste SMS ${app.getVersion()} starting (packaged=${app.isPackaged})`)
      configureSession()
      buildMenu()
      createMainWindow()
      initAutoUpdates(() => mainWindow)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      log(`Startup failed: ${message}`, 'error')
      dialog.showErrorBox(APP_TITLE, `Viste SMS could not start.\n\n${message}`)
      app.quit()
    })

  app.on('window-all-closed', () => app.quit())
}
