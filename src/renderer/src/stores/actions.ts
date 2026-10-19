import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ContainerAction } from '@shared/actions'

const FALLBACK: Record<ContainerAction, string> = {
  start: 'Le démarrage a échoué.',
  stop: "L'arrêt a échoué.",
  restart: 'Le redémarrage a échoué.'
}

export const useActionsStore = defineStore('actions', () => {
  /** The action in progress, if any: one at a time, from the confirmation to the end. */
  const busy = ref<{ action: ContainerAction; container: string } | null>(null)
  const actionError = ref<{ container: string; message: string } | null>(null)
  const portError = ref<string | null>(null)

  /**
   * Only the verb and the container name go to main, which validates both and shows the native
   * confirmation for stop and restart; cancelling that box is not an error.
   */
  async function runAction(action: ContainerAction, container: string): Promise<void> {
    if (busy.value) return
    busy.value = { action, container }
    actionError.value = null
    try {
      const result = await window.bento.containerAction(action, container)
      if (!result.ok && 'error' in result) {
        actionError.value = { container, message: result.error }
      }
    } catch {
      actionError.value = { container, message: FALLBACK[action] }
    } finally {
      busy.value = null
    }
  }

  /** Only the container name and the port go to main, which checks them and builds the URL. */
  async function openPort(container: string, hostPort: number): Promise<void> {
    portError.value = null
    try {
      const result = await window.bento.openContainerPort(container, hostPort)
      if (!result.ok) portError.value = result.error
    } catch {
      portError.value = "Impossible d'ouvrir ce lien."
    }
  }

  /** "Ignore this stop": the status pushed by main shows the container as inactive. */
  async function forgetContainer(name: string): Promise<void> {
    try {
      await window.bento.forgetContainer(name)
    } catch {
      // Nothing to show: the container simply stays flagged until the next attempt.
    }
  }

  return { busy, actionError, portError, runAction, openPort, forgetContainer }
})
