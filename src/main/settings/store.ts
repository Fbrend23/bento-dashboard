import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { DEFAULT_SETTINGS, type Settings, type SettingsErrors } from '@shared/settings'
import { validateSettings } from './validate'

export class SettingsValidationError extends Error {
  constructor(readonly errors: SettingsErrors) {
    super(`Invalid settings: ${Object.keys(errors).join(', ')}`)
    this.name = 'SettingsValidationError'
  }
}

export interface SettingsStore {
  load(): Promise<Settings>
  save(settings: Settings): Promise<void>
}

export function createSettingsStore(filePath: string): SettingsStore {
  return {
    async load() {
      try {
        const raw = JSON.parse(await readFile(filePath, 'utf-8')) as unknown
        return validateSettings(raw).settings
      } catch {
        // Missing or corrupt file is a normal first-run state, not an error.
        return structuredClone(DEFAULT_SETTINGS)
      }
    },

    async save(input) {
      const { settings, errors } = validateSettings(input)
      if (Object.keys(errors).length > 0) throw new SettingsValidationError(errors)

      await mkdir(dirname(filePath), { recursive: true })
      const temp = `${filePath}.${process.pid}.tmp`
      try {
        await writeFile(temp, JSON.stringify(settings, null, 2), 'utf-8')
        await rename(temp, filePath)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
    }
  }
}
