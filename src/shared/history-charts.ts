// What to draw for a history result: which charts, which series, which axis. Pure, so it is
// tested; the renderer only turns this into SVG.

import { niceMax } from './chart'
import { formatPercent, formatRate, formatTemperature } from './format'
import type { HistoryPoint, HistoryResult } from './history'

export type ChartId = 'cpu' | 'memory' | 'network' | 'temperature' | 'disks'
export type ChartUnit = 'percent' | 'bytes' | 'celsius'

export interface ChartSeries {
  id: string
  name: string
  /** Colour slot (1 to 4): fixed per entity, so a filter never repaints the survivors. */
  slot: number
  values: (number | null)[]
}

export interface ChartSpec {
  id: ChartId
  title: string
  unit: ChartUnit
  domain: { min: number; max: number }
  /** The time of each value, shared by every series of the chart. */
  times: number[]
  series: ChartSeries[]
}

type Numeric = 'cpu' | 'memory' | 'swap' | 'down' | 'up' | 'temperature'

/** Disks drawn at most: more lines than colours would be unreadable. */
const MAX_DISKS = 4
const PERCENT_DOMAIN = { min: 0, max: 100 }

const hasData = (values: (number | null)[]): boolean => values.some((v) => v !== null)

export function buildCharts(result: HistoryResult): ChartSpec[] {
  const points = result.points
  if (points.length === 0) return []
  const times = points.map((p) => p.t)
  const column = (field: Numeric): (number | null)[] => points.map((p) => p[field])
  const maxOf = (values: (number | null)[]): number =>
    values.reduce<number>((m, v) => (v !== null && v > m ? v : m), 0)

  const charts: ChartSpec[] = []
  const add = (spec: Omit<ChartSpec, 'times'>): void => {
    if (spec.series.some((s) => hasData(s.values))) charts.push({ ...spec, times })
  }
  const series = (
    id: string,
    name: string,
    slot: number,
    values: (number | null)[]
  ): ChartSeries[] => (hasData(values) ? [{ id, name, slot, values }] : [])

  add({
    id: 'cpu',
    title: 'Processeur',
    unit: 'percent',
    domain: PERCENT_DOMAIN,
    series: series('cpu', 'Processeur', 1, column('cpu'))
  })

  add({
    id: 'memory',
    title: 'Mémoire',
    unit: 'percent',
    domain: PERCENT_DOMAIN,
    series: [
      ...series('memory', 'Mémoire', 1, column('memory')),
      ...series('swap', 'Swap', 2, column('swap'))
    ]
  })

  const down = column('down')
  const up = column('up')
  add({
    id: 'network',
    title: 'Réseau',
    unit: 'bytes',
    // Never below 1 Ko/s: an idle server must not stretch noise to the full height.
    domain: { min: 0, max: niceMax(Math.max(1000, maxOf(down), maxOf(up))) },
    series: [...series('down', 'Réception', 1, down), ...series('up', 'Envoi', 2, up)]
  })

  const temperature = column('temperature')
  add({
    id: 'temperature',
    title: 'Température du processeur',
    unit: 'celsius',
    domain: { min: 0, max: niceMax(Math.max(60, maxOf(temperature))) },
    series: series('temperature', 'Température', 1, temperature)
  })

  add({
    id: 'disks',
    title: 'Disques',
    unit: 'percent',
    domain: PERCENT_DOMAIN,
    series: diskSeries(points)
  })

  return charts
}

/** One series per mount point: the four that went highest, coloured in name order. */
function diskSeries(points: readonly HistoryPoint[]): ChartSeries[] {
  const highest = new Map<string, number>()
  for (const point of points) {
    for (const [mount, percent] of Object.entries(point.disks)) {
      highest.set(mount, Math.max(highest.get(mount) ?? -Infinity, percent))
    }
  }
  const shown = [...highest.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_DISKS)
    .map(([mount]) => mount)
    .sort((a, b) => a.localeCompare(b))

  return shown.map((mount, index) => ({
    id: `disk:${mount}`,
    name: mount,
    slot: index + 1,
    values: points.map((p) => p.disks[mount] ?? null)
  }))
}

/** A value as the legend, the tooltip and the table show it. */
export function formatChartValue(unit: ChartUnit, value: number | null): string {
  switch (unit) {
    case 'percent':
      return formatPercent(value)
    case 'bytes':
      return formatRate(value)
    case 'celsius':
      return formatTemperature(value)
  }
}
