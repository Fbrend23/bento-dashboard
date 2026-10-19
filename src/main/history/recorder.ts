import { RANGE_MS, type HistoryPoint, type HistoryRange } from '@shared/history'

/** One point per minute: fine enough to see a spike, small enough to keep a week. */
export const BUCKET_MS = 60_000
export const RETENTION_MS = RANGE_MS['7d']

/** One reading of the metrics, as the poller produces it. */
export interface HistorySample {
  at: number
  cpu: number | null
  memory: number | null
  swap: number | null
  down: number | null
  up: number | null
  temperature: number | null
  /** Used percentage by mount point. */
  disks: Record<string, number>
}

type Field = 'cpu' | 'memory' | 'swap' | 'down' | 'up' | 'temperature'

const bucketOf = (at: number): number => Math.floor(at / BUCKET_MS) * BUCKET_MS
const tenth = (value: number): number => Math.round(value * 10) / 10

/** Mean of the known values, or null when none is known. */
function mean(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null)
  return known.length === 0 ? null : known.reduce((sum, v) => sum + v, 0) / known.length
}

/** Percentages and temperatures to a tenth, throughput to the byte. */
const round = (field: Field, value: number | null): number | null => {
  if (value === null) return null
  return field === 'down' || field === 'up' ? Math.round(value) : tenth(value)
}

function highestDisks(all: Record<string, number>[]): Record<string, number> {
  const disks: Record<string, number> = {}
  for (const one of all) {
    for (const [mount, percent] of Object.entries(one)) {
      disks[mount] = Math.max(disks[mount] ?? -Infinity, tenth(percent))
    }
  }
  return disks
}

function combine(t: number, parts: Omit<HistorySample, 'at'>[]): HistoryPoint {
  const field = (name: Field): number | null => round(name, mean(parts.map((part) => part[name])))
  return {
    t,
    cpu: field('cpu'),
    memory: field('memory'),
    swap: field('swap'),
    down: field('down'),
    up: field('up'),
    temperature: field('temperature'),
    disks: highestDisks(parts.map((part) => part.disks))
  }
}

/**
 * Turns the stream of readings into one-minute points: the readings of the minute in progress wait
 * in memory, and become a point (averaged, with the highest disk usage) when the minute is over.
 */
export class HistoryRecorder {
  private readonly list: HistoryPoint[]
  private pending: { bucket: number; samples: HistorySample[] } | null = null

  constructor(
    initial: readonly HistoryPoint[] = [],
    private readonly retentionMs = RETENTION_MS
  ) {
    this.list = [...initial]
  }

  get points(): readonly HistoryPoint[] {
    return this.list
  }

  /** True when a point was added, so the caller knows there is something new to save. */
  record(sample: HistorySample): boolean {
    const bucket = bucketOf(sample.at)
    const last = this.list.at(-1)
    // Older than what is already kept (the clock went backwards, or the minute was flushed).
    if (last && bucket <= last.t) return false
    if (this.pending && bucket < this.pending.bucket) return false

    if (!this.pending || this.pending.bucket === bucket) {
      this.pending ??= { bucket, samples: [] }
      this.pending.samples.push(sample)
      return false
    }

    this.finish()
    this.pending = { bucket, samples: [sample] }
    this.prune(sample.at)
    return true
  }

  /** Closes the minute in progress, for instance before the data is written for the last time. */
  flush(): boolean {
    if (!this.pending) return false
    this.finish()
    return true
  }

  private finish(): void {
    if (!this.pending) return
    this.list.push(combine(this.pending.bucket, this.pending.samples))
    this.pending = null
  }

  private prune(now: number): void {
    const cutoff = now - this.retentionMs
    let drop = 0
    while (drop < this.list.length && this.list[drop].t < cutoff) drop += 1
    if (drop > 0) this.list.splice(0, drop)
  }
}

/**
 * The points of a range, thinned to at most `maxPoints` by averaging the points that share a time
 * step (the highest disk usage is kept, so a spike is not smoothed away). Steps follow the clock,
 * not the number of points, so a gap in the data stays a gap.
 */
export function queryPoints(
  points: readonly HistoryPoint[],
  range: HistoryRange,
  now: number,
  maxPoints = 300
): HistoryPoint[] {
  const from = now - RANGE_MS[range]
  const inside = points.filter((p) => p.t >= from)
  // At most maxPoints groups: floor(range / step) + 1 <= maxPoints.
  const slots = Math.max(1, maxPoints - 1)
  const step = Math.max(BUCKET_MS, Math.ceil(RANGE_MS[range] / slots / BUCKET_MS) * BUCKET_MS)
  if (step === BUCKET_MS) return inside.map((p) => ({ ...p, disks: { ...p.disks } }))

  const groups = new Map<number, HistoryPoint[]>()
  for (const point of inside) {
    const key = Math.floor(point.t / step)
    groups.set(key, [...(groups.get(key) ?? []), point])
  }
  return [...groups.values()].map((group) => combine(group[0].t, group))
}
