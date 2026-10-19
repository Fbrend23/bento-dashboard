import { describe, expect, it } from 'vitest'
import { RANGE_MS, isHistoryRange, type HistoryPoint } from '@shared/history'
import {
  BUCKET_MS,
  HistoryRecorder,
  RETENTION_MS,
  queryPoints,
  type HistorySample
} from '../src/main/history/recorder'

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0)
const minute = (n: number): number => T0 + n * BUCKET_MS

const sample = (at: number, patch: Partial<HistorySample> = {}): HistorySample => ({
  at,
  cpu: 10,
  memory: 20,
  swap: 5,
  down: 1000,
  up: 500,
  temperature: 50,
  disks: { '/': 30 },
  ...patch
})

const point = (t: number, patch: Partial<HistoryPoint> = {}): HistoryPoint => ({
  t,
  cpu: 10,
  memory: 20,
  swap: 5,
  down: 1000,
  up: 500,
  temperature: 50,
  disks: { '/': 30 },
  ...patch
})

describe('history ranges', () => {
  it('are one hour, one day and one week', () => {
    expect(RANGE_MS['1h']).toBe(3_600_000)
    expect(RANGE_MS['24h']).toBe(86_400_000)
    expect(RANGE_MS['7d']).toBe(604_800_000)
    expect(RETENTION_MS).toBe(RANGE_MS['7d'])
  })

  it('are recognised only when exact', () => {
    for (const range of ['1h', '24h', '7d']) expect(isHistoryRange(range)).toBe(true)
    for (const bad of ['', '30d', '1H', 'constructor', null, undefined, 7, {}]) {
      expect(isHistoryRange(bad)).toBe(false)
    }
  })
})

describe('HistoryRecorder', () => {
  it('keeps nothing until a minute is over', () => {
    const recorder = new HistoryRecorder()
    expect(recorder.record(sample(minute(0) + 5_000))).toBe(false)
    expect(recorder.record(sample(minute(0) + 35_000))).toBe(false)
    expect(recorder.points).toEqual([])
  })

  it('turns a finished minute into one point, averaged', () => {
    const recorder = new HistoryRecorder()
    recorder.record(sample(minute(0) + 5_000, { cpu: 10, memory: 20, down: 1000 }))
    recorder.record(sample(minute(0) + 35_000, { cpu: 30, memory: 40, down: 3000 }))
    expect(recorder.record(sample(minute(1) + 5_000))).toBe(true)
    expect(recorder.points).toEqual([
      point(minute(0), { cpu: 20, memory: 30, down: 2000, up: 500 })
    ])
  })

  it('keeps the highest used percentage of each disk during the minute', () => {
    const recorder = new HistoryRecorder()
    recorder.record(sample(minute(0) + 1_000, { disks: { '/': 30, '/mnt/x': 80 } }))
    recorder.record(sample(minute(0) + 31_000, { disks: { '/': 35, '/mnt/x': 79 } }))
    recorder.record(sample(minute(1)))
    expect(recorder.points[0].disks).toEqual({ '/': 35, '/mnt/x': 80 })
  })

  it('ignores unknown values when averaging, and keeps null when all are unknown', () => {
    const recorder = new HistoryRecorder()
    recorder.record(sample(minute(0) + 1_000, { cpu: null, temperature: null, down: null }))
    recorder.record(sample(minute(0) + 31_000, { cpu: 40, temperature: null, down: null }))
    recorder.record(sample(minute(1)))
    expect(recorder.points[0]).toMatchObject({ cpu: 40, temperature: null, down: null })
  })

  it('rounds to what a chart can show: tenths of a percent, whole bytes', () => {
    const recorder = new HistoryRecorder()
    recorder.record(sample(minute(0) + 1_000, { cpu: 10.04, down: 1000.4 }))
    recorder.record(sample(minute(0) + 31_000, { cpu: 10.07, down: 1001.3 }))
    recorder.record(sample(minute(1)))
    expect(recorder.points[0].cpu).toBe(10.1)
    expect(recorder.points[0].down).toBe(1001)
  })

  it('leaves a gap when no sample arrived for a while', () => {
    const recorder = new HistoryRecorder()
    recorder.record(sample(minute(0)))
    recorder.record(sample(minute(10)))
    recorder.record(sample(minute(11)))
    expect(recorder.points.map((p) => p.t)).toEqual([minute(0), minute(10)])
  })

  it('ignores a sample from before the current minute (the clock went backwards)', () => {
    const recorder = new HistoryRecorder()
    recorder.record(sample(minute(5)))
    expect(recorder.record(sample(minute(2)))).toBe(false)
    recorder.record(sample(minute(6)))
    expect(recorder.points.map((p) => p.t)).toEqual([minute(5)])
  })

  it('can be asked to close the minute in progress', () => {
    const recorder = new HistoryRecorder()
    recorder.record(sample(minute(0) + 1_000, { cpu: 50 }))
    expect(recorder.flush()).toBe(true)
    expect(recorder.points).toEqual([point(minute(0), { cpu: 50 })])
    expect(recorder.flush()).toBe(false)
  })

  it('goes on after a flush within the same minute without duplicating it', () => {
    const recorder = new HistoryRecorder()
    recorder.record(sample(minute(0) + 1_000))
    recorder.flush()
    recorder.record(sample(minute(0) + 40_000))
    recorder.record(sample(minute(1)))
    expect(recorder.points.map((p) => p.t)).toEqual([minute(0)])
  })

  it('starts from the points it was given, in order', () => {
    const recorder = new HistoryRecorder([point(minute(0)), point(minute(1))])
    recorder.record(sample(minute(2)))
    recorder.record(sample(minute(3)))
    expect(recorder.points.map((p) => p.t)).toEqual([minute(0), minute(1), minute(2)])
  })

  it('forgets points older than seven days', () => {
    const old = point(T0 - RETENTION_MS - 5 * BUCKET_MS)
    const fresh = point(T0 - RETENTION_MS + 5 * BUCKET_MS)
    const recorder = new HistoryRecorder([old, fresh])
    recorder.record(sample(T0))
    recorder.record(sample(T0 + BUCKET_MS))
    expect(recorder.points.map((p) => p.t)).toEqual([fresh.t, T0])
  })
})

describe('queryPoints', () => {
  const NOW = minute(1000)

  it('keeps only the points inside the range', () => {
    const points = [point(NOW - 2 * 3_600_000), point(NOW - 30 * BUCKET_MS), point(NOW - BUCKET_MS)]
    expect(queryPoints(points, '1h', NOW).map((p) => p.t)).toEqual([
      NOW - 30 * BUCKET_MS,
      NOW - BUCKET_MS
    ])
  })

  it('returns every minute of a short range untouched', () => {
    const points = Array.from({ length: 60 }, (_, i) => point(NOW - (60 - i) * BUCKET_MS))
    expect(queryPoints(points, '1h', NOW)).toEqual(points)
  })

  it('thins a long range by averaging points that share a time step', () => {
    const points = Array.from({ length: 1440 }, (_, i) =>
      point(NOW - (1440 - i) * BUCKET_MS, { cpu: i % 2 === 0 ? 10 : 30 })
    )
    const thinned = queryPoints(points, '24h', NOW, 300)
    expect(thinned.length).toBeLessThanOrEqual(300)
    expect(thinned.length).toBeGreaterThan(100)
    // Five-minute steps of alternating 10 and 30 average to about 20, never a raw value.
    expect(thinned.every((p) => p.cpu !== null && Math.abs(p.cpu - 20) <= 4)).toBe(true)
  })

  it('keeps the highest disk percentage when thinning, so a spike is not smoothed away', () => {
    const points = Array.from({ length: 1440 }, (_, i) =>
      point(NOW - (1440 - i) * BUCKET_MS, { disks: { '/': i === 700 ? 95 : 30 } })
    )
    const thinned = queryPoints(points, '24h', NOW, 300)
    expect(Math.max(...thinned.map((p) => p.disks['/']))).toBe(95)
  })

  it('keeps gaps: points far apart are not merged', () => {
    const points = [point(NOW - 20 * 3_600_000), point(NOW - 60_000)]
    expect(queryPoints(points, '24h', NOW, 300).map((p) => p.t)).toHaveLength(2)
  })

  it('never exceeds the requested number of points', () => {
    const points = Array.from({ length: 10_080 }, (_, i) => point(NOW - (10_080 - i) * BUCKET_MS))
    expect(queryPoints(points, '7d', NOW, 300).length).toBeLessThanOrEqual(300)
    expect(queryPoints(points, '7d', NOW, 100).length).toBeLessThanOrEqual(100)
  })

  it('does not change the points it is given', () => {
    const points = [
      point(NOW - 3 * BUCKET_MS, { cpu: 10 }),
      point(NOW - 2 * BUCKET_MS, { cpu: 30 })
    ]
    const copy = structuredClone(points)
    queryPoints(points, '24h', NOW, 1)
    expect(points).toEqual(copy)
  })

  it('returns nothing for no points', () => {
    expect(queryPoints([], '7d', NOW)).toEqual([])
  })
})
