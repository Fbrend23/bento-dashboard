import { describe, expect, it } from 'vitest'
import { isRefreshShortcut, viewForShortcut } from '@shared/shortcuts'

const input = (
  key: string,
  mods: Partial<{ control: boolean; meta: boolean; alt: boolean; shift: boolean }> = {},
  type = 'keyDown'
): Parameters<typeof isRefreshShortcut>[0] => ({
  type,
  key,
  control: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods
})

describe('isRefreshShortcut', () => {
  it.each([
    ['F5', {}],
    ['F5', { control: true }],
    ['r', { control: true }],
    ['R', { control: true }],
    ['r', { control: true, shift: true }],
    ['r', { meta: true }]
  ])('is true for %s with %j', (key, mods) => {
    expect(isRefreshShortcut(input(key, mods))).toBe(true)
  })

  it.each([
    ['r', {}],
    ['F5', { alt: true }],
    ['r', { control: true, alt: true }],
    ['F4', {}],
    ['f', { control: true }],
    ['Enter', { control: true }]
  ])('is false for %s with %j', (key, mods) => {
    expect(isRefreshShortcut(input(key, mods))).toBe(false)
  })

  it('reacts to the key going down only, not to its release or to auto repeat', () => {
    expect(isRefreshShortcut(input('F5', {}, 'keyUp'))).toBe(false)
    expect(isRefreshShortcut({ ...input('F5'), isAutoRepeat: true })).toBe(false)
  })
})

describe('viewForShortcut', () => {
  const key = (
    k: string,
    mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}
  ): Parameters<typeof viewForShortcut>[0] => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods
  })

  it('maps Ctrl+1 to Ctrl+4 to the screens in tab order', () => {
    expect(viewForShortcut(key('1', { ctrlKey: true }))).toBe('dashboard')
    expect(viewForShortcut(key('2', { ctrlKey: true }))).toBe('history')
    expect(viewForShortcut(key('3', { ctrlKey: true }))).toBe('logs')
    expect(viewForShortcut(key('4', { ctrlKey: true }))).toBe('settings')
  })

  it('also accepts the Meta key', () => {
    expect(viewForShortcut(key('1', { metaKey: true }))).toBe('dashboard')
  })

  it.each([
    ['1', {}],
    ['5', { ctrlKey: true }],
    ['0', { ctrlKey: true }],
    ['1', { ctrlKey: true, altKey: true }],
    ['1', { ctrlKey: true, shiftKey: true }],
    ['a', { ctrlKey: true }],
    ['10', { ctrlKey: true }]
  ])('is null for %s with %j', (k, mods) => {
    expect(viewForShortcut(key(k, mods))).toBeNull()
  })
})
