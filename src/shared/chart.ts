// Geometry of the charts: pure functions, so the SVG the renderer draws is tested.

import type { HistoryRange } from './history'

/** Maps a value of [d0, d1] onto [r0, r1]; an empty domain maps everything to r0. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0
  return (v) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0))
}

// No 2.5: the middle tick of an axis ending at 2.5 would be 1.25.
const NICE = [1, 2, 5, 10]

/** The smallest clean number (1, 2, 5 or 10 times a power of ten) that is not below `value`. */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const base = 10 ** Math.floor(Math.log10(value))
  for (const step of NICE) {
    const candidate = step * base
    if (candidate >= value * (1 - 1e-9)) return candidate
  }
  return 10 * base
}

/** The bottom, the middle and the top of an axis that starts at zero. */
export const yTicks = (max: number): number[] => [0, max / 2, max]

export interface XY {
  x: number
  /** Null where the value is unknown: the line is cut there. */
  y: number | null
}

const num = (n: number): string => String(Math.round(n * 10) / 10)

/** Runs of known points; a run also ends where x jumps by more than `maxGap` (a hole in the data). */
function runs(points: readonly XY[], maxGap: number): { x: number; y: number }[][] {
  const result: { x: number; y: number }[][] = []
  let current: { x: number; y: number }[] = []
  let previous: number | null = null
  for (const point of points) {
    if (point.y === null) {
      if (current.length > 0) result.push(current)
      current = []
      previous = null
      continue
    }
    if (previous !== null && point.x - previous > maxGap && current.length > 0) {
      result.push(current)
      current = []
    }
    current.push({ x: point.x, y: point.y })
    previous = point.x
  }
  if (current.length > 0) result.push(current)
  return result
}

/** A path with a gap for every unknown value and every hole in time. A lone point is a dot. */
export function linePath(points: readonly XY[], maxGap: number): string {
  return runs(points, maxGap)
    .map((run) =>
      run.length === 1
        ? `M${num(run[0].x)} ${num(run[0].y)}h0`
        : `M${num(run[0].x)} ${num(run[0].y)}` +
          run
            .slice(1)
            .map((p) => `L${num(p.x)} ${num(p.y)}`)
            .join('')
    )
    .join('')
}

/** The wash under a line: one closed shape per run, down to the baseline. */
export function areaPath(points: readonly XY[], maxGap: number, baseline: number): string {
  return runs(points, maxGap)
    .filter((run) => run.length > 1)
    .map((run) => {
      const first = run[0]
      const last = run[run.length - 1]
      return (
        `M${num(first.x)} ${num(first.y)}` +
        run
          .slice(1)
          .map((p) => `L${num(p.x)} ${num(p.y)}`)
          .join('') +
        `L${num(last.x)} ${num(baseline)}L${num(first.x)} ${num(baseline)}Z`
      )
    })
    .join('')
}

/**
 * How far apart two points may be before the line between them is cut: two and a half times the
 * usual spacing (the median, so one odd pair or one hole in the data does not change it), and
 * never less than two and a half minutes.
 */
export function gapThreshold(times: readonly number[]): number {
  const floor = 150_000
  const deltas: number[] = []
  for (let i = 1; i < times.length; i++) {
    const delta = times[i] - times[i - 1]
    if (delta > 0) deltas.push(delta)
  }
  if (deltas.length === 0) return floor
  deltas.sort((a, b) => a - b)
  return Math.max(floor, 2.5 * deltas[Math.floor(deltas.length / 2)])
}

/** Marks of the time axis, on round local times: every 15 min, 6 h or midnight by range. */
export function timeTicks(from: number, to: number, range: HistoryRange): number[] {
  if (to < from) return []
  const date = new Date(from)
  const advance = (): void => {
    if (range === '1h') date.setMinutes(date.getMinutes() + 15)
    else if (range === '24h') date.setHours(date.getHours() + 6)
    else date.setDate(date.getDate() + 1)
  }

  if (range === '1h') date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0)
  else if (range === '24h') date.setHours(Math.ceil(date.getHours() / 6) * 6, 0, 0, 0)
  else date.setHours(0, 0, 0, 0)
  if (date.getTime() < from) advance()

  const ticks: number[] = []
  while (date.getTime() <= to) {
    ticks.push(date.getTime())
    advance()
  }
  return ticks
}

const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.']
const two = (n: number): string => String(n).padStart(2, '0')

/** "09:05" for the short ranges, "ven. 16" for the week. */
export function formatTick(t: number, range: HistoryRange): string {
  const date = new Date(t)
  return range === '7d'
    ? `${DAYS[date.getDay()]} ${date.getDate()}`
    : `${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Index of the position closest to `x` (the earlier one on a tie), or -1 for none. */
export function nearestIndex(xs: readonly number[], x: number): number {
  let best = -1
  let bestDistance = Infinity
  xs.forEach((value, index) => {
    const distance = Math.abs(value - x)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

/** "ven. 16 · 14:05": the moment under the pointer, or the start of an incident. */
export function formatMoment(t: number): string {
  const date = new Date(t)
  return `${DAYS[date.getDay()]} ${date.getDate()} · ${two(date.getHours())}:${two(date.getMinutes())}`
}
