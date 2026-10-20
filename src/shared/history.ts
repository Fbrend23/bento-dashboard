// History of the metrics and of the incidents, shared by main (recording, storage) and renderer
// (charts). Points are one-minute averages kept for seven days; incidents are what went wrong.

export const HISTORY_RANGES = ['1h', '24h', '7d'] as const

export type HistoryRange = (typeof HISTORY_RANGES)[number]

export const RANGE_MS: Readonly<Record<HistoryRange, number>> = Object.freeze({
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 604_800_000
})

export function isHistoryRange(value: unknown): value is HistoryRange {
  return typeof value === 'string' && (HISTORY_RANGES as readonly string[]).includes(value)
}

export interface HistoryPoint {
  /** Start of the one-minute bucket, in ms since epoch. */
  t: number
  cpu: number | null
  memory: number | null
  swap: number | null
  /** Network throughput of the physical interfaces, in bytes per second. */
  down: number | null
  up: number | null
  /** Cpu package temperature, in degrees Celsius. */
  temperature: number | null
  /** Highest used percentage of each disk during the bucket, by mount point. */
  disks: Record<string, number>
}

/** A brief drop of the connection is normal; only a lasting one is an incident or a notification. */
export const UNREACHABLE_GRACE_MS = 60_000

export const INCIDENT_KINDS = ['service-down', 'unreachable', 'disk-full'] as const

export type IncidentKind = (typeof INCIDENT_KINDS)[number]

export interface Incident {
  /** Stable per kind and subject, e.g. "service-down:app-1". */
  key: string
  kind: IncidentKind
  /** What it is about, as shown: a service label, a mount point, or "bento". */
  subject: string
  startedAt: number
  /** Null while it lasts. */
  endedAt: number | null
}

export interface HistoryResult {
  range: HistoryRange
  /** Points inside the range, thinned to a drawable number. */
  points: HistoryPoint[]
  /** Incidents that overlap the range, newest first. */
  incidents: Incident[]
  /** The server-side "now" the range was cut at, so the charts share one time axis. */
  now: number
}
