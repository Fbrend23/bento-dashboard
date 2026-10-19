import { describe, expect, it } from 'vitest'
import type { HistoryPoint, HistoryResult } from '@shared/history'
import { buildCharts, formatChartValue } from '@shared/history-charts'

const NBSP = ' '
const NOW = Date.UTC(2026, 9, 16, 12, 0, 0)

const point = (i: number, patch: Partial<HistoryPoint> = {}): HistoryPoint => ({
  t: NOW - (10 - i) * 60_000,
  cpu: 10 + i,
  memory: 40,
  swap: 15,
  down: 2000,
  up: 500,
  temperature: 55,
  disks: { '/': 30, '/mnt/media': 80 },
  ...patch
})

const result = (points: HistoryPoint[]): HistoryResult => ({
  range: '24h',
  points,
  incidents: [],
  now: NOW
})

const chart = (r: HistoryResult, id: string): ReturnType<typeof buildCharts>[number] | undefined =>
  buildCharts(r).find((c) => c.id === id)

describe('buildCharts', () => {
  it('draws nothing without points', () => {
    expect(buildCharts(result([]))).toEqual([])
  })

  it('offers the charts in a fixed order, skipping the ones without any data', () => {
    const points = [point(0), point(1)]
    expect(buildCharts(result(points)).map((c) => c.id)).toEqual([
      'cpu',
      'memory',
      'network',
      'temperature',
      'disks'
    ])
    const bare = [point(0, { temperature: null, down: null, up: null, disks: {} })]
    expect(buildCharts(result(bare)).map((c) => c.id)).toEqual(['cpu', 'memory'])
  })

  it('shares one time axis: a value per point, in order', () => {
    const points = [point(0), point(1), point(2)]
    const charts = buildCharts(result(points))
    for (const c of charts) {
      for (const s of c.series) expect(s.values).toHaveLength(3)
    }
    expect(charts[0].times).toEqual(points.map((p) => p.t))
  })
})

describe('cpu chart', () => {
  it('is one series on a 0 to 100 percent axis', () => {
    const c = chart(result([point(0), point(1)]), 'cpu')
    expect(c).toMatchObject({
      title: 'Processeur',
      unit: 'percent',
      domain: { min: 0, max: 100 }
    })
    expect(c?.series).toEqual([{ id: 'cpu', name: 'Processeur', slot: 1, values: [10, 11] }])
  })

  it('keeps unknown values as gaps', () => {
    const c = chart(result([point(0), point(1, { cpu: null }), point(2)]), 'cpu')
    expect(c?.series[0].values).toEqual([10, null, 12])
  })
})

describe('memory chart', () => {
  it('shows memory and swap, each with its own stable colour slot', () => {
    const c = chart(result([point(0)]), 'memory')
    expect(c?.series.map((s) => [s.name, s.slot, s.values])).toEqual([
      ['Mémoire', 1, [40]],
      ['Swap', 2, [15]]
    ])
    expect(c?.domain).toEqual({ min: 0, max: 100 })
  })

  it('leaves out swap on a machine without any', () => {
    const c = chart(result([point(0, { swap: null })]), 'memory')
    expect(c?.series.map((s) => s.name)).toEqual(['Mémoire'])
  })
})

describe('network chart', () => {
  it('shows what is received and what is sent, on a clean automatic axis', () => {
    const c = chart(result([point(0, { down: 1_300_000, up: 200_000 })]), 'network')
    expect(c?.unit).toBe('bytes')
    expect(c?.series.map((s) => [s.name, s.slot])).toEqual([
      ['Réception', 1],
      ['Envoi', 2]
    ])
    expect(c?.domain).toEqual({ min: 0, max: 2_000_000 })
  })

  it('never shrinks the axis below a readable scale on an idle server', () => {
    const c = chart(result([point(0, { down: 10, up: 0 })]), 'network')
    expect(c?.domain.max).toBeGreaterThanOrEqual(1000)
  })

  it('is left out when no throughput was ever measured', () => {
    expect(chart(result([point(0, { down: null, up: null })]), 'network')).toBeUndefined()
  })
})

describe('temperature chart', () => {
  it('is one series in degrees, on an axis that starts at zero', () => {
    const c = chart(result([point(0), point(1)]), 'temperature')
    expect(c).toMatchObject({ title: 'Température du processeur', unit: 'celsius' })
    expect(c?.domain.min).toBe(0)
    expect(c?.domain.max).toBeGreaterThanOrEqual(60)
  })

  it('grows its axis for a very hot machine', () => {
    const c = chart(result([point(0, { temperature: 95 })]), 'temperature')
    expect(c?.domain.max).toBeGreaterThanOrEqual(95)
  })
})

describe('disks chart', () => {
  it('draws one line per mount point, in name order, on a 0 to 100 percent axis', () => {
    const c = chart(result([point(0), point(1)]), 'disks')
    expect(c?.domain).toEqual({ min: 0, max: 100 })
    expect(c?.series.map((s) => [s.name, s.slot, s.values])).toEqual([
      ['/', 1, [30, 30]],
      ['/mnt/media', 2, [80, 80]]
    ])
  })

  it('gives a gap to a point where a disk was not read', () => {
    const c = chart(result([point(0), point(1, { disks: { '/': 31 } })]), 'disks')
    expect(c?.series.find((s) => s.name === '/mnt/media')?.values).toEqual([80, null])
  })

  it('keeps the colour of a disk whatever the other disks do', () => {
    const base = chart(result([point(0)]), 'disks')
    const slotOf = (r: ReturnType<typeof chart>, name: string): number | undefined =>
      r?.series.find((s) => s.name === name)?.slot
    const withExtra = chart(
      result([point(0, { disks: { '/': 30, '/mnt/media': 80, '/srv': 5 } })]),
      'disks'
    )
    expect(slotOf(withExtra, '/')).toBe(slotOf(base, '/'))
    expect(slotOf(withExtra, '/mnt/media')).toBe(slotOf(base, '/mnt/media'))
  })

  it('draws at most four disks: the four that went highest', () => {
    const disks = { '/a': 10, '/b': 20, '/c': 30, '/d': 40, '/e': 50, '/f': 60 }
    const c = chart(result([point(0, { disks })]), 'disks')
    expect(c?.series.map((s) => s.name)).toEqual(['/c', '/d', '/e', '/f'])
    expect(c?.series.map((s) => s.slot)).toEqual([1, 2, 3, 4])
  })
})

describe('formatChartValue', () => {
  it('formats each unit the way the dashboard does', () => {
    expect(formatChartValue('percent', 61.4)).toBe(`61${NBSP}%`)
    expect(formatChartValue('bytes', 2_500_000)).toBe(`2,5${NBSP}Mo/s`)
    expect(formatChartValue('celsius', 54.6)).toBe(`55${NBSP}°C`)
  })

  it('shows a dash for an unknown value', () => {
    for (const unit of ['percent', 'bytes', 'celsius'] as const) {
      expect(formatChartValue(unit, null)).toBe('—')
    }
  })
})
