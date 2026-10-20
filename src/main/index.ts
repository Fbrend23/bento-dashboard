import {
  app,
  BrowserWindow,
  dialog,
  Notification,
  screen,
  shell,
  type MessageBoxOptions,
  type SaveDialogOptions
} from 'electron'
import { rm, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import type { ContainerAction } from '@shared/actions'
import { IPC_CHANNELS } from '@shared/ipc'
import { isRefreshShortcut } from '@shared/shortcuts'
import type { AppView } from '@shared/views'
import { confirmationText } from '@shared/confirm-text'
import { registerIpc } from './ipc'
import { createFileRunningMemory } from './monitors/running-memory'
import { createNotifier, type Notifier } from './notifications/notifier'
import { createBentoService } from './service'
import { createSettingsStore } from './settings/store'
import { hardenApp, secureWebPreferences, windowOpenHandler } from './security'
import { loginItemOptions, shouldStartHidden } from './startup'
import {
  createWindowStateStore,
  restoreBounds,
  type SavedWindowState,
  type WindowStateStore
} from './window-state'
import { createSsh2Connector } from './ssh/ssh2-connector'
import { createTray } from './tray/tray-controller'
import { UpdateController } from './updater/controller'
import { createElectronUpdater } from './updater/electron-updater'

const rendererFile = resolve(__dirname, '../renderer/index.html')
/** How often the notifier re-checks, so the "unreachable" grace period can expire on its own. */
const NOTIFIER_TICK_MS = 15_000

let mainWindow: BrowserWindow | null = null
/** Set once the service exists: F5 and Ctrl+R refresh the data. */
let refreshShortcut: (() => void) | null = null
/** Where and how big the window was last time; loaded before the first window is created. */
let savedWindow: SavedWindowState | null = null
let windowStateStore: WindowStateStore | null = null
let quitting = false

function appUrl(): string {
  return is.dev && process.env['ELECTRON_RENDERER_URL']
    ? process.env['ELECTRON_RENDERER_URL']
    : pathToFileURL(rendererFile).href
}

/** Remembers the size, position and maximized state, saved shortly after each change. */
function rememberBounds(window: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = (): void => {
    clearTimeout(timer)
    if (window.isDestroyed() || window.isMinimized()) return
    // The normal bounds, so a maximized window comes back to its usual size when un-maximized.
    const { x, y, width, height } = window.getNormalBounds()
    void windowStateStore
      ?.save({ x, y, width, height, maximized: window.isMaximized() })
      .catch(() => {})
  }
  const later = (): void => {
    clearTimeout(timer)
    timer = setTimeout(save, 500)
  }
  window.on('resize', later)
  window.on('move', later)
  window.on('maximize', later)
  window.on('unmaximize', later)
  window.on('close', save)
}

function createWindow(showWhenReady: boolean): BrowserWindow {
  const bounds = restoreBounds(
    savedWindow,
    screen.getAllDisplays().map((display) => display.workArea)
  )
  const window = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    ...(bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: secureWebPreferences(join(__dirname, '../preload/index.js'))
  })

  if (bounds.maximized) window.maximize()
  rememberBounds(window)

  window.on('ready-to-show', () => {
    if (showWhenReady) window.show()
  })

  // Closing the window keeps the app running in the tray; only "Quitter" really quits.
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
    }
  })

  window.webContents.setWindowOpenHandler(windowOpenHandler)

  // F5 and Ctrl+R refresh the data. Handled here because Electron would reload the page, and in a
  // packaged app swallow Ctrl+R before the page could see it.
  window.webContents.on('before-input-event', (event, input) => {
    if (!isRefreshShortcut(input)) return
    event.preventDefault()
    refreshShortcut?.()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(rendererFile)
  }
  return window
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow(true)
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

/** The window if it is on screen: a box attached to a window hidden in the tray would not show. */
function visibleWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() ? mainWindow : null
}

/** Brings the window forward on a given screen (tray menu). */
function showView(view: AppView): void {
  showWindow()
  const contents = mainWindow?.webContents
  if (!contents || contents.isDestroyed()) return
  const send = (): void => contents.send(IPC_CHANNELS.navigate, view)
  if (contents.isLoading()) contents.once('did-finish-load', send)
  else send()
}

/** The confirmation is owned by the main process: the renderer cannot answer it. */
async function confirmContainerAction(action: ContainerAction, label: string): Promise<boolean> {
  const text = confirmationText(action, label)
  const options: MessageBoxOptions = {
    type: 'warning',
    title: text.title,
    message: text.message,
    detail: text.detail,
    buttons: [text.confirmLabel, 'Annuler'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  }
  const parent = visibleWindow()
  const { response } = parent
    ? await dialog.showMessageBox(parent, options)
    : await dialog.showMessageBox(options)
  return response === 0
}

/** The path is chosen by the user in a native dialog; the text is main's own copy of the lines. */
async function saveLogsFile(defaultName: string, text: string): Promise<boolean> {
  const options: SaveDialogOptions = {
    title: 'Exporter les journaux',
    defaultPath: join(app.getPath('documents'), defaultName),
    filters: [{ name: 'Journal', extensions: ['log', 'txt'] }]
  }
  const parent = visibleWindow()
  const { canceled, filePath } = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (canceled || !filePath) return false
  await writeFile(filePath, text, 'utf8')
  return true
}

async function main(): Promise<void> {
  electronApp.setAppUserModelId('ch.bento.dashboard')
  hardenApp(appUrl)

  windowStateStore = createWindowStateStore(join(app.getPath('userData'), 'window-state.json'))
  savedWindow = await windowStateStore.load()

  // The notifier is created after the service, which needs it only once a restart is requested.
  let notifier: Notifier | null = null
  const service = await createBentoService({
    store: createSettingsStore(join(app.getPath('userData'), 'settings.json')),
    createConnector: createSsh2Connector,
    onSettings: (settings) =>
      app.setLoginItemSettings(loginItemOptions(settings.launchAtStartup, app.isPackaged)),
    confirmAction: confirmContainerAction,
    saveLogsFile,
    runningMemory: await createFileRunningMemory(
      join(app.getPath('userData'), 'running-containers.json')
    ),
    // Only ever called by the service with a URL it built itself from a listed published port.
    openExternal: (url) => shell.openExternal(url),
    quietNotifications: (serviceId, durationMs) => notifier?.suppress(serviceId, durationMs)
  })

  refreshShortcut = () => void service.refresh()

  const updateController = new UpdateController({
    updater: createElectronUpdater(),
    isPackaged: app.isPackaged,
    autoUpdate: () => service.getSettings().autoUpdate,
    currentVersion: app.getVersion()
  })
  registerIpc(service, updateController, appUrl)
  updateController.start()
  // The 1.0 to 1.2 versions kept an encrypted read-only token here; the repository is public now.
  void rm(join(app.getPath('userData'), 'update-token.bin'), { force: true }).catch(() => {})
  // Until 1.3 the history was recorded here; the agent on bento keeps it now (and it starts afresh).
  void rm(join(app.getPath('userData'), 'history.json'), { force: true }).catch(() => {})

  const tray = createTray(service.status, {
    open: showWindow,
    logs: () => showView('logs'),
    refresh: () => void service.refresh(),
    restartContainer: (container) => {
      // The confirmation box is shown by the service; a failure has no window to appear in.
      void service.containerAction('restart', container).then((result) => {
        if (!result.ok && 'error' in result && Notification.isSupported()) {
          new Notification({ title: 'Redémarrage impossible', body: result.error }).show()
        }
      })
    },
    quit: () => {
      quitting = true
      app.quit()
    }
  })
  const activeNotifier = createNotifier({
    getSettings: () => service.getSettings(),
    onClick: showWindow
  })
  notifier = activeNotifier

  service.onStatus((status) => {
    tray.update(status)
    activeNotifier.check(status)
  })
  const tick = setInterval(() => {
    activeNotifier.check(service.status)
  }, NOTIFIER_TICK_MS)

  app.on('before-quit', () => {
    quitting = true
    clearInterval(tick)
  })
  app.on('will-quit', () => {
    tray.destroy()
    updateController.stop()
    service.dispose()
  })
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
  app.on('activate', showWindow)
  // Staying in the tray after the last window closes is intended.
  app.on('window-all-closed', () => {})

  const startHidden = shouldStartHidden(process.argv, app.getLoginItemSettings().wasOpenedAtLogin)
  mainWindow = createWindow(!startHidden)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // A second launch (e.g. the shortcut) brings the running instance forward.
  app.on('second-instance', showWindow)
  app.whenReady().then(main)
}
