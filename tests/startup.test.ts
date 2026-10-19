import { describe, expect, it } from 'vitest'
import { HIDDEN_ARG, loginItemOptions, shouldStartHidden } from '../src/main/startup'

describe('loginItemOptions', () => {
  it('registers the packaged app to open hidden at login', () => {
    expect(loginItemOptions(true, true)).toEqual({ openAtLogin: true, args: [HIDDEN_ARG] })
  })

  it('unregisters it when the setting is off', () => {
    expect(loginItemOptions(false, true)).toEqual({ openAtLogin: false, args: [HIDDEN_ARG] })
  })

  it('never registers a development run: that would start a bare electron.exe at login', () => {
    expect(loginItemOptions(true, false).openAtLogin).toBe(false)
  })
})

describe('shouldStartHidden', () => {
  it('starts hidden when launched with the hidden flag', () => {
    expect(shouldStartHidden(['bento.exe', HIDDEN_ARG], false)).toBe(true)
  })

  it('starts hidden when Windows reports a launch at login', () => {
    expect(shouldStartHidden(['bento.exe'], true)).toBe(true)
  })

  it('shows the window for a normal launch', () => {
    expect(shouldStartHidden(['bento.exe'], false)).toBe(false)
    expect(shouldStartHidden([], false)).toBe(false)
  })
})
