import { ref, type Ref } from 'vue'
import type { ContainerAction } from '@shared/actions'
import type { AgentStatus } from '@shared/agent'
import type { AgentApi } from './api'

/** How often the page reads bento while it is open. */
export const REFRESH_INTERVAL_MS = 30_000

const FALLBACK: Record<ContainerAction, string> = {
  start: 'Le démarrage a échoué.',
  stop: "L'arrêt a échoué.",
  restart: 'Le redémarrage a échoué.'
}

export interface Bento {
  status: Ref<AgentStatus | null>
  /** When this phone last read bento successfully (its own clock, not the server's). */
  fetchedAt: Ref<number | null>
  /** Why the last refresh failed; the previous status stays in `status`. */
  error: Ref<string | null>
  loading: Ref<boolean>
  /** The action in progress, if any: one at a time. */
  busy: Ref<{ action: ContainerAction; container: string } | null>
  actionError: Ref<{ container: string; message: string } | null>
  refresh(): Promise<void>
  run(action: ContainerAction, container: string): Promise<void>
  start(): void
  stop(): void
}

/** State of the page: framework-light on purpose, so it is tested without a DOM. */
export function useBento(api: AgentApi): Bento {
  const status = ref<AgentStatus | null>(null)
  const fetchedAt = ref<number | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)
  const busy = ref<{ action: ContainerAction; container: string } | null>(null)
  const actionError = ref<{ container: string; message: string } | null>(null)
  let inflight: Promise<void> | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  function refresh(): Promise<void> {
    if (inflight) return inflight
    loading.value = true
    const promise: Promise<void> = api
      .getStatus()
      .then((result) => {
        if (result.ok) {
          status.value = result.status
          fetchedAt.value = Date.now()
          error.value = null
        } else {
          error.value = result.error
        }
      })
      .finally(() => {
        loading.value = false
        if (inflight === promise) inflight = null
      })
    inflight = promise
    return promise
  }

  async function run(action: ContainerAction, container: string): Promise<void> {
    if (busy.value) return
    busy.value = { action, container }
    actionError.value = null
    try {
      const result = await api.runAction(action, container)
      if (!result.ok && 'error' in result) actionError.value = { container, message: result.error }
    } catch {
      actionError.value = { container, message: FALLBACK[action] }
    } finally {
      // Read again whatever happened: the container may have changed even if the call failed.
      await refresh()
      busy.value = null
    }
  }

  function start(): void {
    if (timer) return
    void refresh()
    timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { status, fetchedAt, error, loading, busy, actionError, refresh, run, start, stop }
}
