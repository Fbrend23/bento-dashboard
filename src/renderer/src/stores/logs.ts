import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { TAILSCALED_SOURCE, type LogSourceId, type LogsResult } from '@shared/logs'
import { filterLogLines, type LogLevelFilter } from '@shared/log-lines'

export const AUTO_REFRESH_MS = 10_000

export interface LogsNotice {
  kind: 'ok' | 'error'
  text: string
}

export const useLogsStore = defineStore('logs', () => {
  const source = ref<LogSourceId>(TAILSCALED_SOURCE)
  const result = ref<LogsResult | null>(null)
  const loading = ref(false)
  const query = ref('')
  const level = ref<LogLevelFilter>('all')
  const wrap = ref(false)
  const autoRefresh = ref(false)
  const notice = ref<LogsNotice | null>(null)
  /** Only the answer to the latest request is kept; older ones are stale. */
  let latest = 0
  let timer: ReturnType<typeof setInterval> | null = null

  const lines = computed(() => (result.value?.ok ? result.value.lines : []))
  const filtered = computed(() => filterLogLines(lines.value, query.value, level.value))
  const total = computed(() => lines.value.length)

  async function load(): Promise<void> {
    const request = ++latest
    loading.value = true
    let next: LogsResult
    try {
      next = await window.bento.getLogs(source.value)
    } catch {
      next = { ok: false, error: 'Lecture des journaux impossible.' }
    }
    if (request !== latest) return
    result.value = next
    loading.value = false
  }

  async function select(id: LogSourceId): Promise<void> {
    source.value = id
    result.value = null
    notice.value = null
    await load()
  }

  function clearTimer(): void {
    if (timer !== null) clearInterval(timer)
    timer = null
  }

  function setAutoRefresh(on: boolean): void {
    clearTimer()
    autoRefresh.value = on
    if (on) {
      timer = setInterval(() => {
        if (!loading.value) void load()
      }, AUTO_REFRESH_MS)
    }
  }

  /** Called when the view goes away: nothing keeps polling in the background. */
  function stopAutoRefresh(): void {
    setAutoRefresh(false)
  }

  async function copy(): Promise<boolean> {
    if (filtered.value.length === 0) return false
    try {
      await navigator.clipboard.writeText(filtered.value.join('\n'))
      return true
    } catch {
      return false
    }
  }

  /** Main owns the text, the dialog and the path: only the source id is sent. */
  async function exportLogs(): Promise<void> {
    try {
      const answer = await window.bento.exportLogs(source.value)
      if (answer.ok) notice.value = { kind: 'ok', text: 'Journal enregistré.' }
      else if (answer.cancelled) notice.value = null
      else notice.value = { kind: 'error', text: answer.error }
    } catch {
      notice.value = { kind: 'error', text: "Impossible d'enregistrer le fichier." }
    }
  }

  return {
    source,
    result,
    loading,
    query,
    level,
    wrap,
    autoRefresh,
    notice,
    filtered,
    total,
    load,
    select,
    setAutoRefresh,
    stopAutoRefresh,
    copy,
    exportLogs
  }
})
