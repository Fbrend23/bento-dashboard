import { ref, type Ref } from 'vue'
import type { HistoryRange, HistoryResult } from '@shared/history'
import type { HistoryApi } from './api'

/** The agent writes a point every minute: reading twice a minute is enough. */
export const HISTORY_REFRESH_MS = 30_000

export interface HistoryState {
  range: Ref<HistoryRange>
  /** The charts of the selected range; the last good ones stay when a read fails. */
  result: Ref<HistoryResult | null>
  error: Ref<string | null>
  loading: Ref<boolean>
  load(): Promise<void>
  setRange(range: HistoryRange): Promise<void>
  start(): void
  stop(): void
}

/** State of the history tab: framework-light on purpose, so it is tested without a DOM. */
export function useHistory(api: HistoryApi): HistoryState {
  const range = ref<HistoryRange>('24h')
  const result = ref<HistoryResult | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)
  let inflight: Promise<void> | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  function load(): Promise<void> {
    if (inflight) return inflight
    const asked = range.value
    loading.value = true
    const promise: Promise<void> = api
      .getHistory(asked)
      .then((reply) => {
        // The reader may have changed the range while this was on its way.
        if (asked !== range.value) return
        if (reply.ok) {
          result.value = reply.result
          error.value = null
        } else {
          error.value = reply.error
        }
      })
      .finally(() => {
        if (inflight === promise) inflight = null
        loading.value = false
      })
    inflight = promise
    return promise
  }

  async function setRange(next: HistoryRange): Promise<void> {
    if (next === range.value) return
    range.value = next
    result.value = null
    error.value = null
    // A read of the previous range may still be running: wait for it, then read the new one.
    if (inflight) await inflight
    await load()
  }

  function start(): void {
    if (timer) return
    void load()
    timer = setInterval(() => void load(), HISTORY_REFRESH_MS)
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { range, result, error, loading, load, setRange, start, stop }
}
