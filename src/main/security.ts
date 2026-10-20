import { app, session } from 'electron'
import type { WebPreferences } from 'electron'

export function secureWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false
  }
}

export function isAllowedNavigation(url: string, appUrl: string): boolean {
  let target: URL
  let base: URL
  try {
    target = new URL(url)
    base = new URL(appUrl)
  } catch {
    return false
  }
  if (target.protocol !== base.protocol) return false
  if (base.protocol === 'file:') return target.pathname === base.pathname
  if (base.protocol === 'http:' || base.protocol === 'https:') return target.origin === base.origin
  return false
}

export function windowOpenHandler(): { action: 'deny' } {
  return { action: 'deny' }
}

/**
 * Everything is refused except writing plain text to the clipboard (the "Copier" button of the
 * logs): Chromium sanitises what is written, and nothing can be read back.
 */
export function permissionHandler(
  _webContents: unknown,
  permission: string,
  callback: (granted: boolean) => void
): void {
  callback(permission === 'clipboard-sanitized-write')
}

/**
 * Wiring only: applies the pure helpers above to every web contents.
 * `getAppUrl` returns the renderer URL (dev server or packaged file).
 */
export function hardenApp(getAppUrl: () => string): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(windowOpenHandler)
    contents.on('will-navigate', (event, url) => {
      if (!isAllowedNavigation(url, getAppUrl())) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
  session.defaultSession.setPermissionRequestHandler(permissionHandler)
}
