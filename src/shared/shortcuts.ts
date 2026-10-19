// Keyboard shortcuts, as pure functions so main (Electron input events) and the renderer (DOM
// keyboard events) agree and both are tested.

import { APP_VIEWS, type AppView } from './views'

/** The part of Electron's `before-input-event` input that matters here. */
export interface WindowInput {
  type: string
  key: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  isAutoRepeat?: boolean
}

/**
 * F5, Ctrl+R and Ctrl+Shift+R refresh the data instead of reloading the page. Main handles them
 * (and cancels the reload) because Electron would otherwise swallow Ctrl+R before the page sees it.
 */
export function isRefreshShortcut(input: WindowInput): boolean {
  if (input.type !== 'keyDown' || input.isAutoRepeat || input.alt) return false
  if (input.key === 'F5') return true
  return (input.control || input.meta) && input.key.toLowerCase() === 'r'
}

/** The part of a DOM keyboard event that matters here. */
export interface KeyEventLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Ctrl+1, Ctrl+2… show the screens in the order of the tabs. */
export function viewForShortcut(event: KeyEventLike): AppView | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null
  if (!/^[1-9]$/.test(event.key)) return null
  return APP_VIEWS[Number(event.key) - 1] ?? null
}
