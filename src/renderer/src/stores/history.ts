import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { HistoryRange, HistoryResult } from '@shared/history'

export const useHistoryStore = defineStore('history', () => {
  const range = ref<HistoryRange>('24h')
  const result = ref<HistoryResult | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  /** Numbers the requests: an answer that is no longer the latest one is thrown away. */
  let latest = 0

  /** Loads the current range. The previous charts stay on screen until the new ones arrive. */
  async function load(): Promise<void> {
    const mine = ++latest
    loading.value = true
    try {
      const answer = await window.bento.getHistory(range.value)
      if (mine !== latest) return
      result.value = answer
      failed.value = false
    } catch {
      if (mine !== latest) return
      failed.value = true
    } finally {
      if (mine === latest) loading.value = false
    }
  }

  async function setRange(next: HistoryRange): Promise<void> {
    range.value = next
    await load()
  }

  return { range, result, loading, failed, load, setRange }
})
