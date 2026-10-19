import { describe, expect, it } from 'vitest'
import { APP_VIEWS, isAppView } from '@shared/views'

describe('app views', () => {
  it('are the screens the window can show', () => {
    expect([...APP_VIEWS]).toEqual(['dashboard', 'history', 'logs', 'settings'])
  })

  it('recognise only a known view', () => {
    for (const view of APP_VIEWS) expect(isAppView(view)).toBe(true)
    for (const bad of ['', 'Logs', 'admin', 'constructor', '__proto__', null, undefined, 3, {}]) {
      expect(isAppView(bad)).toBe(false)
    }
  })
})
