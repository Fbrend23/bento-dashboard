import { describe, expect, it } from 'vitest'
import {
  areaPath,
  formatTick,
  gapThreshold,
  linePath,
  linearScale,
  nearestIndex,
  niceMax,
  timeTicks,
  yTicks
} from '@shared/chart'

describe('linearScale', () => {
  it('maps the domain onto the range', () => {
    const y = linearScale(0, 100, 160, 0)
    expect(y(0)).toBe(160)
    expect(y(100)).toBe(0)
    expect(y(50)).toBe(80)
  })

  it('does not divide by zero on an empty domain', () => {
    const y = linearScale(5, 5, 100, 0)
    expect(Number.isFinite(y(5))).toBe(true)
  })
})

describe('niceMax', () => {
  it.each([
    [0, 1],
    [0.4, 0.5],
    [1, 1],
    [1.2, 2],
    [2.3, 5],
    [3, 5],
    [7, 10],
    [12, 20],
    [230, 500],
    [999, 1000],
    [1_234_567, 2_000_000]
  ])('rounds %d up to the clean number %d', (value, expected) => {
    expect(niceMax(value)).toBe(expected)
  })

  it('never goes below the value', () => {
    for (const v of [0.01, 1.01, 4.9, 77, 1234, 8_765_432])
      expect(niceMax(v)).toBeGreaterThanOrEqual(v)
  })

  it('copes with a value that is not a number', () => {
    expect(niceMax(Number.NaN)).toBe(1)
    expect(niceMax(-5)).toBe(1)
  })
})

describe('niceMax (clean middle tick)', () => {
  it('never gives a maximum whose half is an awkward number', () => {
    for (const v of [0.3, 1.1, 2.3, 4.2, 7, 23, 230, 1_300_000, 2_400_000, 6_100_000]) {
      const half = niceMax(v) / 2
      const mantissa = half / 10 ** Math.floor(Math.log10(half))
      expect([1, 2, 2.5, 5, 10]).toContain(Math.round(mantissa * 100) / 100)
    }
  })
})

describe('yTicks', () => {
  it('gives the bottom, the middle and the top', () => {
    expect(yTicks(100)).toEqual([0, 50, 100])
    expect(yTicks(2_000_000)).toEqual([0, 1_000_000, 2_000_000])
  })
})

describe('linePath', () => {
  it('joins consecutive points', () => {
    expect(
      linePath(
        [
          { x: 0, y: 10 },
          { x: 10, y: 20 },
          { x: 20, y: 5 }
        ],
        100
      )
    ).toBe('M0 10L10 20L20 5')
  })

  it('leaves a gap where a value is unknown', () => {
    expect(
      linePath(
        [
          { x: 0, y: 10 },
          { x: 10, y: null },
          { x: 20, y: 5 },
          { x: 30, y: 6 }
        ],
        100
      )
    ).toBe('M0 10h0M20 5L30 6')
  })

  it('leaves a gap where time jumped (the app was closed)', () => {
    const points = [
      { x: 0, y: 1 },
      { x: 10, y: 2 },
      { x: 500, y: 3 },
      { x: 510, y: 4 }
    ]
    expect(linePath(points, 50)).toBe('M0 1L10 2M500 3L510 4')
  })

  it('draws a lone point as a dot', () => {
    expect(linePath([{ x: 5, y: 7 }], 100)).toBe('M5 7h0')
  })

  it('is empty without data', () => {
    expect(linePath([], 100)).toBe('')
    expect(linePath([{ x: 0, y: null }], 100)).toBe('')
  })

  it('keeps the numbers short', () => {
    expect(
      linePath(
        [
          { x: 0.123456, y: 1.987654 },
          { x: 1, y: 2 }
        ],
        100
      )
    ).toBe('M0.1 2L1 2')
  })
})

describe('areaPath', () => {
  it('closes each run down to the baseline', () => {
    expect(
      areaPath(
        [
          { x: 0, y: 10 },
          { x: 10, y: 20 }
        ],
        100,
        160
      )
    ).toBe('M0 10L10 20L10 160L0 160Z')
  })

  it('makes one shape per run', () => {
    const points = [
      { x: 0, y: 1 },
      { x: 10, y: 2 },
      { x: 500, y: 3 },
      { x: 510, y: 4 }
    ]
    expect(areaPath(points, 50, 160)).toBe('M0 1L10 2L10 160L0 160ZM500 3L510 4L510 160L500 160Z')
  })

  it('has no area for a lone point', () => {
    expect(areaPath([{ x: 5, y: 7 }], 100, 160)).toBe('')
  })

  it('is empty without data', () => {
    expect(areaPath([], 100, 160)).toBe('')
  })
})

describe('gapThreshold', () => {
  const MIN = 60_000
  const every = (stepMs: number, count: number, start = 0): number[] =>
    Array.from({ length: count }, (_, i) => start + i * stepMs)

  it('is two and a half readings, with a floor of two and a half minutes', () => {
    expect(gapThreshold(every(MIN, 60))).toBe(150_000)
    expect(gapThreshold(every(5 * MIN, 60))).toBe(750_000)
    expect(gapThreshold(every(34 * MIN, 60))).toBe(85 * MIN)
  })

  it('goes by the usual spacing, not by the one odd pair: a short step must not break every line', () => {
    const times = [...every(5 * MIN, 30), 30 * 5 * MIN + MIN, 30 * 5 * MIN + 6 * MIN]
    expect(gapThreshold(times)).toBe(750_000)
  })

  it('is not stretched by a hole in the data', () => {
    const times = [...every(5 * MIN, 20), ...every(5 * MIN, 20, 20 * 5 * MIN + 120 * MIN)]
    expect(gapThreshold(times)).toBe(750_000)
  })

  it('falls back to the floor without enough points', () => {
    expect(gapThreshold([])).toBe(150_000)
    expect(gapThreshold([1000])).toBe(150_000)
    expect(gapThreshold([5, 5, 5])).toBe(150_000)
  })
})

describe('timeTicks', () => {
  const at = (h: number, m = 0, d = 16): number => new Date(2026, 9, d, h, m).getTime()

  it('marks every quarter hour for the last hour', () => {
    expect(timeTicks(at(11, 10), at(12, 10), '1h')).toEqual([
      at(11, 15),
      at(11, 30),
      at(11, 45),
      at(12, 0)
    ])
  })

  it('marks every six hours for the last day', () => {
    expect(timeTicks(at(14, 0, 15), at(14, 0, 16), '24h')).toEqual([
      at(18, 0, 15),
      at(0, 0, 16),
      at(6, 0, 16),
      at(12, 0, 16)
    ])
  })

  it('marks every midnight for the last week', () => {
    const ticks = timeTicks(at(14, 0, 9), at(14, 0, 16), '7d')
    expect(ticks).toEqual([10, 11, 12, 13, 14, 15, 16].map((d) => at(0, 0, d)))
  })

  it('includes both ends when they fall on a mark', () => {
    expect(timeTicks(at(12, 0), at(13, 0), '1h')).toEqual([
      at(12, 0),
      at(12, 15),
      at(12, 30),
      at(12, 45),
      at(13, 0)
    ])
  })

  it('is empty for an empty or reversed span', () => {
    expect(timeTicks(at(12), at(12), '1h')).toEqual([at(12)])
    expect(timeTicks(at(13), at(12), '1h')).toEqual([])
  })
})

describe('formatTick', () => {
  const at = (h: number, m = 0, d = 16): number => new Date(2026, 9, d, h, m).getTime()

  it('shows the hour for the short ranges', () => {
    expect(formatTick(at(9, 5), '1h')).toBe('09:05')
    expect(formatTick(at(18, 0), '24h')).toBe('18:00')
  })

  it('shows the day for the week', () => {
    expect(formatTick(at(0, 0, 16), '7d')).toBe('ven. 16')
    expect(formatTick(at(0, 0, 12), '7d')).toBe('lun. 12')
    expect(formatTick(at(0, 0, 18), '7d')).toBe('dim. 18')
  })
})

describe('nearestIndex', () => {
  it('finds the closest position', () => {
    expect(nearestIndex([0, 10, 20, 30], 12)).toBe(1)
    expect(nearestIndex([0, 10, 20, 30], 16)).toBe(2)
    expect(nearestIndex([0, 10, 20, 30], -50)).toBe(0)
    expect(nearestIndex([0, 10, 20, 30], 999)).toBe(3)
  })

  it('takes the earlier one when exactly between two', () => {
    expect(nearestIndex([0, 10], 5)).toBe(0)
  })

  it('works on uneven spacing', () => {
    expect(nearestIndex([0, 1, 100, 101], 60)).toBe(2)
  })

  it('answers -1 for nothing', () => {
    expect(nearestIndex([], 5)).toBe(-1)
  })
})
