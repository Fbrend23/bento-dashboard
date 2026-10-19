import { formatAge } from './format'
import type { BentoStatus } from './monitors'
import { explainSshError } from './ssh-errors'

export interface Staleness {
  /** What is wrong with the numbers on screen. */
  message: string
  /** Plain-French reason, when the error is a known one. */
  cause: string | null
  /** Raw error text for the curious. */
  technical: string | null
}

/** Data older than this many refresh intervals is flagged, so one late poll is not an alarm. */
const STALE_AFTER_INTERVALS = 2.5

/**
 * Tells when the numbers on screen cannot be trusted although bento is reachable: the last reading
 * failed, or no reading arrived for much longer than the refresh interval. When bento is
 * unreachable the main verdict already says so, and nothing is reported here.
 */
export function staleness(status: BentoStatus, intervalSec: number, now: number): Staleness | null {
  if (!status.configured || status.connection !== 'online' || status.updatedAt === null) return null

  const failing = status.lastError !== null
  const old = now - status.updatedAt > intervalSec * 1000 * STALE_AFTER_INTERVALS
  if (!failing && !old) return null

  const age = formatAge(status.updatedAt, now)
  return {
    message: failing
      ? `Le dernier relevé a échoué : les valeurs affichées ont été relevées ${age}.`
      : `Les valeurs affichées ont été relevées ${age}.`,
    cause: failing ? explainSshError(status.lastError) : null,
    technical: failing ? status.lastError : null
  }
}
