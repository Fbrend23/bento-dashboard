import { RANGE_MS, type HistoryRange, type Incident, type IncidentKind } from '@shared/history'
import type { BentoStatus } from '@shared/monitors'
import { UNREACHABLE_GRACE_MS } from '../notifications/tracker'
import { RETENTION_MS } from './recorder'

/** Closed incidents kept besides the open ones; a week of a noisy server stays readable. */
const MAX_CLOSED = 200
/** Incidents shown for a range. */
const MAX_SHOWN = 50

const SERVICE_PREFIX = 'service-down:'
const DISK_PREFIX = 'disk-full:'
const UNREACHABLE_KEY = 'unreachable:bento'

/**
 * Writes the story of what went wrong from the stream of statuses: a service that went down, bento
 * that could not be reached, a disk over its threshold. Each has a start and, once over, an end.
 * Only what is observed is recorded; a container stopped on purpose is not an incident.
 */
export class IncidentTracker {
  private readonly list: Incident[]
  /** When the connection was first seen lost; an outage counts only once it lasted a minute. */
  private offlineSince: number | null = null

  constructor(
    initial: readonly Incident[] = [],
    private readonly retentionMs = RETENTION_MS
  ) {
    this.list = initial.map((incident) => ({ ...incident }))
  }

  get incidents(): readonly Incident[] {
    return this.list
  }

  /** True when an incident was opened, closed or forgotten, so there is something to save. */
  update(status: BentoStatus, now: number): boolean {
    if (!status.configured) return false

    let changed = false
    const open = (key: string, kind: IncidentKind, subject: string, startedAt = now): void => {
      if (this.list.some((i) => i.key === key && i.endedAt === null)) return
      this.list.push({ key, kind, subject, startedAt, endedAt: null })
      changed = true
    }
    const close = (key: string): void => {
      for (const incident of this.list) {
        if (incident.key === key && incident.endedAt === null) {
          incident.endedAt = now
          changed = true
        }
      }
    }
    const closeVanished = (prefix: string, present: Set<string>): void => {
      for (const incident of this.list) {
        if (
          incident.endedAt === null &&
          incident.key.startsWith(prefix) &&
          !present.has(incident.key.slice(prefix.length))
        ) {
          close(incident.key)
        }
      }
    }

    if (status.connection === 'online') {
      this.offlineSince = null
      close(UNREACHABLE_KEY)
    } else {
      // Not before a first attempt was made: starting the app is not an outage.
      if (status.updatedAt !== null || status.lastError !== null) {
        this.offlineSince ??= now
        // A drop shorter than the grace period (the PC woke up, new settings, a Wi-Fi blip) is
        // not an incident; a longer one is dated from when it began.
        if (now - this.offlineSince >= UNREACHABLE_GRACE_MS) {
          open(UNREACHABLE_KEY, 'unreachable', 'bento', this.offlineSince)
        }
      }
      // The values on screen are the last known ones: they say nothing about what is happening now.
      return this.prune(now) || changed
    }

    const present = new Set(status.services.map((s) => s.id))
    for (const service of status.services) {
      const key = `${SERVICE_PREFIX}${service.id}`
      if (service.level === 'down' || service.level === 'absent') {
        open(key, 'service-down', service.label)
      } else if (service.level !== 'unknown') {
        close(key)
      }
    }
    // A container that no longer exists ends its incident, but only when docker could be read.
    const dockerReadable = status.services.some(
      (s) => s.kind === 'container' && s.level !== 'unknown'
    )
    if (dockerReadable) closeVanished(SERVICE_PREFIX, present)

    if (status.metrics) {
      const mounts = new Set(status.metrics.disks.map((d) => d.mount))
      for (const disk of status.metrics.disks) {
        const key = `${DISK_PREFIX}${disk.mount}`
        if (disk.overThreshold) open(key, 'disk-full', disk.mount)
        else close(key)
      }
      closeVanished(DISK_PREFIX, mounts)
    }

    return this.prune(now) || changed
  }

  /** Old closed incidents go; the open ones stay however old they are. */
  private prune(now: number): boolean {
    const cutoff = now - this.retentionMs
    const before = this.list.length
    let kept = this.list.filter((i) => i.endedAt === null || i.endedAt >= cutoff)

    const excess = kept.filter((i) => i.endedAt !== null).length - MAX_CLOSED
    if (excess > 0) {
      let toDrop = excess
      kept = kept.filter((i) => {
        if (i.endedAt !== null && toDrop > 0) {
          toDrop -= 1
          return false
        }
        return true
      })
    }
    this.list.splice(0, this.list.length, ...kept)
    return this.list.length !== before
  }
}

/** The incidents that overlap a range, newest first, capped. */
export function incidentsInRange(
  incidents: readonly Incident[],
  range: HistoryRange,
  now: number
): Incident[] {
  const from = now - RANGE_MS[range]
  return incidents
    .filter((i) => i.endedAt === null || i.endedAt >= from)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, MAX_SHOWN)
    .map((i) => ({ ...i }))
}
