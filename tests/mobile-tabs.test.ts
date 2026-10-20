import { describe, expect, it } from 'vitest'
import {
  EDGE_GUARD_PX,
  MOBILE_TABS,
  SWIPE_MIN_PX,
  isSwipeStart,
  swipeTarget,
  tabFromHash
} from '../src/mobile/src/tabs'

describe('MOBILE_TABS', () => {
  it('lists the three tabs in display order', () => {
    expect(MOBILE_TABS.map((tab) => tab.id)).toEqual(['services', 'system', 'history'])
    expect(MOBILE_TABS.map((tab) => tab.label)).toEqual(['Services', 'Système', 'Historique'])
  })
})

describe('swipeTarget', () => {
  it('goes to the next tab on a swipe to the left, and back on a swipe to the right', () => {
    expect(swipeTarget('services', -SWIPE_MIN_PX, 0)).toBe('system')
    expect(swipeTarget('system', -120, 10)).toBe('history')
    expect(swipeTarget('history', SWIPE_MIN_PX, 0)).toBe('system')
    expect(swipeTarget('system', 120, -10)).toBe('services')
  })

  it('stays on the first and the last tab instead of wrapping around', () => {
    expect(swipeTarget('services', 200, 0)).toBeNull()
    expect(swipeTarget('history', -200, 0)).toBeNull()
  })

  it('ignores a short movement', () => {
    expect(swipeTarget('services', -(SWIPE_MIN_PX - 1), 0)).toBeNull()
    expect(swipeTarget('system', 0, 0)).toBeNull()
  })

  it('ignores a movement that is mostly vertical, which is a scroll', () => {
    expect(swipeTarget('services', -100, 80)).toBeNull()
    expect(swipeTarget('services', -100, -70)).toBeNull()
    expect(swipeTarget('services', -100, 60)).toBe('system')
  })
})

describe('isSwipeStart', () => {
  it('refuses a touch that starts within the edge guard, where Android reads its own gestures', () => {
    expect(isSwipeStart(0, 400)).toBe(false)
    expect(isSwipeStart(EDGE_GUARD_PX - 1, 400)).toBe(false)
    expect(isSwipeStart(400 - EDGE_GUARD_PX + 1, 400)).toBe(false)
    expect(isSwipeStart(EDGE_GUARD_PX, 400)).toBe(true)
    expect(isSwipeStart(200, 400)).toBe(true)
  })
})

describe('tabFromHash', () => {
  it('reads the tab from the hash', () => {
    expect(tabFromHash('#system')).toBe('system')
    expect(tabFromHash('#history')).toBe('history')
    expect(tabFromHash('#services')).toBe('services')
  })

  it('falls back to the services tab', () => {
    for (const hash of ['', '#', '#nothing', '#System', '#__proto__', 'system']) {
      expect(tabFromHash(hash)).toBe('services')
    }
  })
})
