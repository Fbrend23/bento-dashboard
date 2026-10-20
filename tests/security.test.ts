import { readdirSync, readFileSync } from 'fs'
import { join, relative, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  isAllowedNavigation,
  permissionHandler,
  secureWebPreferences,
  windowOpenHandler
} from '../src/main/security'

describe('secureWebPreferences', () => {
  const prefs = secureWebPreferences('/app/preload/index.js')

  it('enables context isolation, sandbox and web security', () => {
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.sandbox).toBe(true)
    expect(prefs.webSecurity).toBe(true)
  })

  it('disables node integration and webview tags', () => {
    expect(prefs.nodeIntegration).toBe(false)
    expect(prefs.webviewTag).toBe(false)
  })

  it('forwards the preload path', () => {
    expect(prefs.preload).toBe('/app/preload/index.js')
  })
})

describe('isAllowedNavigation', () => {
  const devUrl = 'http://localhost:5173/'
  const prodUrl = 'file:///C:/Program%20Files/Bento/resources/app.asar/out/renderer/index.html'

  it('allows the dev server origin', () => {
    expect(isAllowedNavigation('http://localhost:5173/', devUrl)).toBe(true)
    expect(isAllowedNavigation('http://localhost:5173/#/settings', devUrl)).toBe(true)
  })

  it('allows the packaged renderer file', () => {
    expect(isAllowedNavigation(prodUrl, prodUrl)).toBe(true)
    expect(isAllowedNavigation(`${prodUrl}#/settings`, prodUrl)).toBe(true)
  })

  it('refuses remote sites', () => {
    expect(isAllowedNavigation('https://example.com/', devUrl)).toBe(false)
    expect(isAllowedNavigation('https://example.com/', prodUrl)).toBe(false)
    expect(isAllowedNavigation('http://localhost:9999/', devUrl)).toBe(false)
  })

  it('refuses another local file', () => {
    expect(isAllowedNavigation('file:///C:/Windows/win.ini', prodUrl)).toBe(false)
  })

  it('refuses javascript: and data: URLs', () => {
    expect(isAllowedNavigation('javascript:alert(1)', devUrl)).toBe(false)
    expect(isAllowedNavigation('data:text/html,<h1>x</h1>', prodUrl)).toBe(false)
  })

  it('refuses invalid URLs', () => {
    expect(isAllowedNavigation('not a url', devUrl)).toBe(false)
  })
})

describe('windowOpenHandler', () => {
  it('always denies new windows', () => {
    expect(windowOpenHandler()).toEqual({ action: 'deny' })
  })
})

describe('permissionHandler', () => {
  it('refuses every permission request except writing plain text to the clipboard', () => {
    const answers = (permission: string): boolean[] => {
      const callback: boolean[] = []
      permissionHandler(null, permission, (granted) => callback.push(granted))
      return callback
    }
    expect(answers('clipboard-sanitized-write')).toEqual([true])
    for (const permission of [
      'media',
      'geolocation',
      'notifications',
      'clipboard-read',
      'openExternal',
      'fullscreen',
      'unknown',
      ''
    ]) {
      expect(answers(permission)).toEqual([false])
    }
  })
})

describe('opening links', () => {
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return /\.(ts|vue)$/.test(entry.name) ? [path] : []
    })
  const using = (pattern: RegExp): string[] =>
    sources(resolve('src'))
      .filter((file) => pattern.test(readFileSync(file, 'utf-8')))
      .map((file) => relative(resolve('src'), file).replaceAll('\\', '/'))
      .sort()

  it('only the service and the electron wiring know about openExternal', () => {
    expect(using(/openExternal/)).toEqual(['main/index.ts', 'main/service.ts'])
  })

  it('the electron shell is only used by the wiring in index.ts', () => {
    expect(using(/\bshell\.openExternal\b/)).toEqual(['main/index.ts'])
  })

  it('the renderer and the preload never reach the shell', () => {
    expect(using(/from 'electron'/).filter((f) => f.startsWith('renderer/'))).toEqual([])
    expect(using(/openExternal|\bshell\./).filter((f) => f.startsWith('renderer/'))).toEqual([])
  })
})
