import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { BentoStatus } from '@shared/monitors'

export const useStatusStore = defineStore('status', () => {
  const status = ref<BentoStatus | null>(null)
  let unsubscribe: (() => void) | null = null

  async function init(): Promise<void> {
    if (unsubscribe) return
    let pushed = false
    unsubscribe = window.bento.onStatus((next) => {
      pushed = true
      status.value = next
    })
    const current = await window.bento.getStatus()
    // A pushed update is newer than the snapshot we just asked for.
    if (!pushed) status.value = current
  }

  async function refresh(): Promise<void> {
    await window.bento.refresh()
  }

  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  return { status, init, refresh, dispose }
})
