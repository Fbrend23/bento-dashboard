import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ConnectionTestResult } from '@shared/connection-test'
import type { Settings, SettingsErrors } from '@shared/settings'
import { fromForm, type SettingsForm } from '../settings-form'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings | null>(null)
  const errors = ref<SettingsErrors>({})
  const saving = ref(false)
  const testing = ref(false)
  const testResult = ref<ConnectionTestResult | null>(null)

  async function load(): Promise<void> {
    settings.value = await window.bento.getSettings()
  }

  /** Returns true when the settings were saved; otherwise `errors` explains why. */
  async function save(form: SettingsForm): Promise<boolean> {
    saving.value = true
    try {
      const result = await window.bento.saveSettings(fromForm(form))
      if (result.ok) {
        settings.value = result.settings
        errors.value = {}
        testResult.value = null
        return true
      }
      errors.value = result.errors
      return false
    } catch {
      errors.value = { settings: "Enregistrement impossible. Réessayez ou relancez l'application." }
      return false
    } finally {
      saving.value = false
    }
  }

  /** Tries the form as typed; nothing is saved. Main validates the draft and runs one fixed command. */
  async function testConnection(form: SettingsForm): Promise<void> {
    if (testing.value) return
    testing.value = true
    testResult.value = null
    try {
      testResult.value = await window.bento.testConnection(fromForm(form))
    } catch {
      testResult.value = {
        ok: false,
        message: "Le test a échoué. Réessayez ou relancez l'application.",
        technical: null
      }
    } finally {
      testing.value = false
    }
  }

  return { settings, errors, saving, testing, testResult, load, save, testConnection }
})
