import { isHistoryRange, type HistoryResult } from '@shared/history'
import type { BentoStatus, Metrics } from '@shared/monitors'
import { IncidentTracker, incidentsInRange } from './incidents'
import { HistoryRecorder, queryPoints, type HistorySample } from './recorder'
import type { HistoryData, HistoryStore } from './store'

export interface HistoryDeps {
  store: HistoryStore
  now?: () => number
  /** Writes are grouped: at most one per this delay, and none when nothing changed. */
  saveDelayMs?: number
}

const DEFAULT_SAVE_DELAY_MS = 60_000

function sampleFrom(metrics: Metrics, at: number): HistorySample {
  return {
    at,
    cpu: metrics.cpuPercent,
    memory: metrics.memoryUsedPercent,
    swap: metrics.swapUsedPercent,
    down: metrics.network?.downBytesPerSec ?? null,
    up: metrics.network?.upBytesPerSec ?? null,
    temperature: metrics.temperatureC,
    disks: Object.fromEntries(metrics.disks.map((d) => [d.mount, d.usedPercent]))
  }
}

/**
 * The history of the metrics and of the incidents: fed with each published status, queried by the
 * window, and written to a file in groups so a week of data costs one small write a minute.
 */
export class History {
  private readonly recorder: HistoryRecorder
  private readonly incidents: IncidentTracker
  private readonly now: () => number
  private readonly saveDelayMs: number
  private lastReading: number | null = null
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly deps: HistoryDeps,
    data: HistoryData
  ) {
    this.recorder = new HistoryRecorder(data.points)
    this.incidents = new IncidentTracker(data.incidents)
    this.now = deps.now ?? Date.now
    this.saveDelayMs = deps.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS
  }

  observe(status: BentoStatus): void {
    let changed = this.incidents.update(status, this.now())

    // A reading is recorded once, and only while bento answers: otherwise the values on screen are
    // the last known ones and would be drawn as if they were new.
    if (
      status.connection === 'online' &&
      status.metrics &&
      status.updatedAt !== null &&
      status.updatedAt !== this.lastReading
    ) {
      this.lastReading = status.updatedAt
      changed = this.recorder.record(sampleFrom(status.metrics, status.updatedAt)) || changed
    }
    if (changed) this.markDirty()
  }

  /** `range` comes from the renderer: only the fixed ranges are answered. */
  query(range: unknown): HistoryResult | null {
    if (!isHistoryRange(range)) return null
    const now = this.now()
    return {
      range,
      points: queryPoints(this.recorder.points, range, now),
      incidents: incidentsInRange(this.incidents.incidents, range, now),
      now
    }
  }

  /** The last write, when the app quits: synchronous, since nothing may be awaited then. */
  flushSync(): void {
    this.clearTimer()
    this.recorder.flush()
    try {
      this.deps.store.saveSync(this.snapshot())
      this.dirty = false
    } catch {
      // Nothing more can be done while quitting.
    }
  }

  dispose(): void {
    this.clearTimer()
  }

  private snapshot(): HistoryData {
    return { points: [...this.recorder.points], incidents: [...this.incidents.incidents] }
  }

  private markDirty(): void {
    this.dirty = true
    this.schedule()
  }

  /** Does not postpone a write already planned, or a steady flow of changes would never save. */
  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.save()
    }, this.saveDelayMs)
  }

  private async save(): Promise<void> {
    if (!this.dirty) return
    this.dirty = false
    try {
      await this.deps.store.save(this.snapshot())
    } catch {
      // A failed write must not stop the monitoring: try again later.
      this.dirty = true
      this.schedule()
    }
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

export async function createHistory(deps: HistoryDeps): Promise<History> {
  return new History(deps, await deps.store.load())
}
