import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'

export interface SavedWindowState {
  width: number
  height: number
  /** Both set or both absent: a window never saved with a position is placed by the system. */
  x?: number
  y?: number
  maximized: boolean
}

/** A screen's usable area (the part not covered by the taskbar). */
export interface DisplayArea {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowBounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

export const DEFAULT_WINDOW = { width: 980, height: 720 }
export const MIN_WINDOW = { width: 640, height: 480 }

/** At least this much of the window must be on a screen, or it could not be grabbed again. */
const MIN_VISIBLE = { width: 120, height: 60 }

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max

/** Lenient on purpose: anything unexpected means "no saved state", never an error. */
export function parseWindowState(raw: unknown): SavedWindowState | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const { width, height, x, y, maximized } = raw as Record<string, unknown>
  if (!isInt(width, 200, 10_000) || !isInt(height, 200, 10_000)) return null
  if (maximized !== undefined && typeof maximized !== 'boolean') return null

  const state: SavedWindowState = { width, height, maximized: maximized ?? false }
  if (x !== undefined || y !== undefined) {
    if (!isInt(x, -30_000, 30_000) || !isInt(y, -30_000, 30_000)) return null
    state.x = x
    state.y = y
  }
  return state
}

const overlap = (a: [number, number], b: [number, number]): number =>
  Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]))

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max))

/**
 * The bounds to open the window with: the saved ones, adjusted to the screens that exist now. A
 * window whose screen was unplugged keeps its size and is placed by the system; one that sticks
 * out of its screen is pulled back in; the size never goes below the minimum.
 */
export function restoreBounds(
  saved: SavedWindowState | null,
  areas: readonly DisplayArea[]
): WindowBounds {
  const maximized = saved?.maximized ?? false
  const wanted = {
    width: saved?.width ?? DEFAULT_WINDOW.width,
    height: saved?.height ?? DEFAULT_WINDOW.height
  }

  const fit = (area: DisplayArea | undefined): { width: number; height: number } => ({
    width: Math.max(MIN_WINDOW.width, Math.min(wanted.width, area?.width ?? wanted.width)),
    height: Math.max(MIN_WINDOW.height, Math.min(wanted.height, area?.height ?? wanted.height))
  })

  if (saved?.x === undefined || saved.y === undefined || areas.length === 0) {
    return { ...fit(areas[0]), maximized }
  }

  const rect = { x: saved.x, y: saved.y, ...wanted }
  const visible = (area: DisplayArea): { w: number; h: number } => ({
    w: overlap([rect.x, rect.x + rect.width], [area.x, area.x + area.width]),
    h: overlap([rect.y, rect.y + rect.height], [area.y, area.y + area.height])
  })
  const best = areas.reduce((a, b) => {
    const va = visible(a)
    const vb = visible(b)
    return vb.w * vb.h > va.w * va.h ? b : a
  })
  const seen = visible(best)
  if (seen.w < MIN_VISIBLE.width || seen.h < MIN_VISIBLE.height) {
    return { ...fit(areas[0]), maximized }
  }

  const size = fit(best)
  return {
    ...size,
    x: clamp(saved.x, best.x, best.x + best.width - size.width),
    y: clamp(saved.y, best.y, best.y + best.height - size.height),
    maximized
  }
}

export interface WindowStateStore {
  load(): Promise<SavedWindowState | null>
  save(state: SavedWindowState): Promise<void>
}

export function createWindowStateStore(filePath: string): WindowStateStore {
  return {
    async load() {
      try {
        return parseWindowState(JSON.parse(await readFile(filePath, 'utf-8')) as unknown)
      } catch {
        // Missing or corrupt file is a normal first-run state, not an error.
        return null
      }
    },

    async save(input) {
      const state = parseWindowState(input)
      if (!state) return

      await mkdir(dirname(filePath), { recursive: true })
      const temp = `${filePath}.${process.pid}.tmp`
      try {
        await writeFile(temp, JSON.stringify(state), 'utf-8')
        await rename(temp, filePath)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
    }
  }
}
