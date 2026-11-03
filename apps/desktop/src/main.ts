import { dialog, app, BrowserWindow, session, shell, systemPreferences } from 'electron'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { createApplication, type Application } from '../../api/src/bootstrap.js'
import { createHttpServer } from '../../api/src/http/create-http-server.js'
import { isAllowedPermission, isAllowedPermissionCheck } from './permissions.js'
import { listenOnFreePort } from './ports.js'
import { runSmokeTest } from './smoke.js'

const PREFERRED_PORT = 3100
const smoke = process.argv.includes('--smoke-test')

let application: Application | null = null
let server: Server | null = null
let mainWindow: BrowserWindow | null = null
let shuttingDown = false

function openWindow(origin: string): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Listen Instant Ans',
    backgroundColor: '#fffefa',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const openInBrowser = (url: string): void => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault()
      openInBrowser(url)
    }
  })
  window.on('closed', () => { mainWindow = null })
  mainWindow = window
  void window.loadURL(origin)
}

async function start(): Promise<void> {
  await app.whenReady()
  try {
    application = createApplication()
    server = createHttpServer(application, join(app.getAppPath(), 'public'))
    const port = await listenOnFreePort(server, Number(process.env.PORT ?? PREFERRED_PORT))
    const origin = `http://127.0.0.1:${port}`

    if (smoke) {
      app.dock?.hide()
      const result = await runSmokeTest(origin, { withModel: process.env.LISTEN_INSTANT_ANS_SMOKE_MODEL === '1' })
      for (const item of result.checks) console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.name}${item.detail ? ` -- ${item.detail}` : ''}`)
      console.log(result.ok ? 'SMOKE_OK' : 'SMOKE_FAILED')
      app.exit(result.ok ? 0 : 1)
      return
    }

    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback, details) => {
      callback(isAllowedPermission(permission, details as never, origin))
    })
    session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) =>
      isAllowedPermissionCheck(permission, requestingOrigin, details as never, origin))
    // Ask macOS for the microphone right away, so the first recording does not stall on the prompt.
    if (process.platform === 'darwin') void systemPreferences.askForMediaAccess('microphone')
    openWindow(origin)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (smoke) {
      console.log(`SMOKE_FAILED ${message}`)
      app.exit(1)
    } else {
      dialog.showErrorBox('Listen Instant Ans 无法启动', message)
      app.exit(1)
    }
  }
}

async function shutDown(): Promise<void> {
  await Promise.race([application?.runtime.stopAll(), new Promise((resolve) => setTimeout(resolve, 3000))])
  server?.closeAllConnections()
  server?.close()
}

if (!smoke && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (shuttingDown) return
    shuttingDown = true
    event.preventDefault()
    void shutDown().finally(() => app.exit(0))
  })
  void start()
}
