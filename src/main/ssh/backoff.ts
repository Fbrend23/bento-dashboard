const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 60000

/** Delay before the next reconnection attempt, given the number of consecutive failures so far. */
export function reconnectDelay(attempt: number): number {
  const failures = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.min(failures, 20))
}
