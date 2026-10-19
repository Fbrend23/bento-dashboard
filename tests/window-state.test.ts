import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createWindowStateStore,
  DEFAULT_WINDOW,
  MIN_WINDOW,
  parseWindowState,
  restoreBounds,
  type DisplayArea
} from '../src/main/window-state'

const screen1: DisplayArea = { x: 0, y: 0, width: 1920, height: 1040 }
const screen2: DisplayArea = { x: 1920, y: 0, width: 1280, height: 984 }

describe('parseWindowState', () => {
  it('reads a complete saved state', () => {
    expect(parseWindowState({ width: 1000, height: 700, x: 50, y: 60, maximized: true })).toEqual({
      width: 1000,
      height: 700,
      x: 50,
      y: 60,
      maximized: true
    })
  })

  it('accepts a state without position and treats a missing maximized flag as false', () => {
    expect(parseWindowState({ width: 1000, height: 700 })).toEqual({
      width: 1000,
      height: 700,
      maximized: false
    })
  })

  it('accepts a position on a screen left of or above the main one', () => {
    expect(parseWindowState({ width: 900, height: 600, x: -1500, y: -200 })).toMatchObject({
      x: -1500,
      y: -200
    })
  })

  it.each([
    null,
    'text',
    42,
    [],
    {},
    { width: 1000 },
    { width: '1000', height: 700 },
    { width: 1000.5, height: 700 },
    { width: 10, height: 700 },
    { width: 1000, height: 99999 },
    { width: 1000, height: 700, x: 10 },
    { width: 1000, height: 700, y: 10 },
    { width: 1000, height: 700, x: 'a', y: 1 },
    { width: 1000, height: 700, x: 1e9, y: 0 },
    { width: 1000, height: 700, maximized: 'yes' }
  ])('refuses %j', (raw) => {
    expect(parseWindowState(raw)).toBeNull()
  })
})

describe('restoreBounds', () => {
  it('uses the default size and lets the system place the window when nothing was saved', () => {
    expect(restoreBounds(null, [screen1])).toEqual({ ...DEFAULT_WINDOW, maximized: false })
  })

  it('restores the saved size and position when they are on a screen', () => {
    const saved = { width: 1000, height: 700, x: 100, y: 80, maximized: false }
    expect(restoreBounds(saved, [screen1])).toEqual(saved)
  })

  it('remembers a maximized window', () => {
    const saved = { width: 1000, height: 700, x: 100, y: 80, maximized: true }
    expect(restoreBounds(saved, [screen1]).maximized).toBe(true)
  })

  it('restores a window on a second screen when that screen is still there', () => {
    const saved = { width: 1000, height: 700, x: 2000, y: 100, maximized: false }
    expect(restoreBounds(saved, [screen1, screen2])).toMatchObject({ x: 2000, y: 100 })
  })

  it('drops the position when its screen was unplugged, keeping the size', () => {
    const saved = { width: 1000, height: 700, x: 2000, y: 100, maximized: false }
    expect(restoreBounds(saved, [screen1])).toEqual({
      width: 1000,
      height: 700,
      maximized: false
    })
  })

  it('drops a position that would leave almost nothing of the window visible', () => {
    const saved = { width: 1000, height: 700, x: 1900, y: 1030, maximized: false }
    const bounds = restoreBounds(saved, [screen1])
    expect(bounds.x).toBeUndefined()
    expect(bounds.y).toBeUndefined()
  })

  it('pulls a window that sticks out of its screen back inside', () => {
    const saved = { width: 1000, height: 700, x: 1400, y: 600, maximized: false }
    expect(restoreBounds(saved, [screen1])).toMatchObject({ x: 920, y: 340 })
  })

  it('shrinks a window larger than the screen it is on', () => {
    const saved = { width: 4000, height: 3000, x: 0, y: 0, maximized: false }
    expect(restoreBounds(saved, [screen1])).toMatchObject({ width: 1920, height: 1040, x: 0, y: 0 })
  })

  it('never goes below the minimum size', () => {
    const saved = { width: 300, height: 200, maximized: false }
    expect(restoreBounds(saved, [screen1])).toMatchObject(MIN_WINDOW)
  })

  it('keeps the minimum size even on a screen smaller than it', () => {
    const tiny: DisplayArea = { x: 0, y: 0, width: 500, height: 400 }
    const bounds = restoreBounds({ width: 900, height: 700, maximized: false }, [tiny])
    expect(bounds.width).toBeGreaterThanOrEqual(MIN_WINDOW.width)
    expect(bounds.height).toBeGreaterThanOrEqual(MIN_WINDOW.height)
  })

  it('falls back to defaults without any screen information', () => {
    expect(restoreBounds({ width: 1000, height: 700, x: 5, y: 5, maximized: false }, [])).toEqual({
      width: 1000,
      height: 700,
      maximized: false
    })
  })
})

describe('window state store', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bento-window-'))
    file = join(dir, 'window-state.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('has nothing saved the first time', async () => {
    expect(await createWindowStateStore(file).load()).toBeNull()
  })

  it('round-trips a state', async () => {
    const store = createWindowStateStore(file)
    const state = { width: 1000, height: 700, x: 10, y: 20, maximized: false }
    await store.save(state)
    expect(await store.load()).toEqual(state)
  })

  it('creates the folder and leaves no temporary file', async () => {
    const nested = join(dir, 'a', 'window-state.json')
    await createWindowStateStore(nested).save({ width: 900, height: 600, maximized: false })
    expect(await readdir(join(dir, 'a'))).toEqual(['window-state.json'])
  })

  it('starts fresh from a corrupt or unexpected file', async () => {
    await writeFile(file, '{ not json', 'utf-8')
    expect(await createWindowStateStore(file).load()).toBeNull()
    await writeFile(file, JSON.stringify({ width: 'wide' }), 'utf-8')
    expect(await createWindowStateStore(file).load()).toBeNull()
  })

  it('stores only the known fields', async () => {
    await createWindowStateStore(file).save({
      width: 900,
      height: 600,
      maximized: false,
      extra: 'x'
    } as never)
    expect(Object.keys(JSON.parse(await readFile(file, 'utf-8'))).sort()).toEqual([
      'height',
      'maximized',
      'width'
    ])
  })

  it('does not write an invalid state', async () => {
    const store = createWindowStateStore(file)
    await store.save({ width: 5, height: 5, maximized: false })
    expect(await store.load()).toBeNull()
    expect(await readdir(dir)).toEqual([])
  })
})
