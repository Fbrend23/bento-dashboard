import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { UpdateState } from '@shared/updates'

export const useUpdatesStore = defineStore('updates', () => {
  const state = ref<UpdateState | null>(null)
  let unsubscribe: (() => void) | null = null

  async function init(): Promise<void> {
    if (unsubscribe) return
    let pushed = false
    unsubscribe = window.bento.onUpdate((next) => {
      pushed = true
      state.value = next
    })
    const current = await window.bento.getUpdateState()
    // A pushed update is newer than the snapshot we just asked for.
    if (!pushed) state.value = current
  }

  async function check(): Promise<void> {
    await window.bento.checkForUpdate()
  }

  async function install(): Promise<void> {
    await window.bento.installUpdate()
  }

  function dispose(): void {
    unsubscribe?.()
    unsubscribe = null
  }

  return { state, init, check, install, dispose }
})
