import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { createSettingsStore, SettingsValidationError } from '../src/main/settings/store'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bento-settings-'))
  file = join(dir, 'settings.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const custom: Settings = {
  ...DEFAULT_SETTINGS,
  host: 'bento.example.ts.net',
  hostFingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  diskThresholdPercent: 90
}

describe('settings store load', () => {
  it('returns the defaults when the file does not exist', async () => {
    expect(await createSettingsStore(file).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('returns the defaults when the file is not valid JSON', async () => {
    await writeFile(file, '{ not json', 'utf-8')
    expect(await createSettingsStore(file).load()).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid fields and resets invalid ones', async () => {
    await writeFile(file, JSON.stringify({ host: 'bento.ts.net', port: 0 }), 'utf-8')
    expect(await createSettingsStore(file).load()).toEqual({
      ...DEFAULT_SETTINGS,
      host: 'bento.ts.net'
    })
  })
})

describe('settings store migration', () => {
  it('loads a file written by v1.0 (watchedContainers) without error, showing everything', async () => {
    await writeFile(
      file,
      JSON.stringify({
        host: 'bento.ts.net',
        diskThresholdPercent: 90,
        watchedContainers: ['jellyfin', 'proxy-app-1']
      }),
      'utf-8'
    )
    const loaded = await createSettingsStore(file).load()
    expect(loaded).toEqual({ ...DEFAULT_SETTINGS, host: 'bento.ts.net', diskThresholdPercent: 90 })
    expect(loaded.hiddenContainers).toEqual([])
    expect(loaded).not.toHaveProperty('watchedContainers')
  })
})

describe('settings store save', () => {
  it('round-trips a valid configuration', async () => {
    const store = createSettingsStore(file)
    await store.save(custom)
    expect(await store.load()).toEqual(custom)
  })

  it('creates the parent directory and leaves no temporary file', async () => {
    const nested = join(dir, 'a', 'b', 'settings.json')
    await createSettingsStore(nested).save(custom)
    expect(await readdir(join(dir, 'a', 'b'))).toEqual(['settings.json'])
  })

  it('refuses invalid settings without touching the existing file', async () => {
    const store = createSettingsStore(file)
    await store.save(custom)
    const before = await readFile(file, 'utf-8')

    const error = await store.save({ ...custom, port: 0 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SettingsValidationError)
    expect((error as SettingsValidationError).errors).toHaveProperty('port')
    expect(await readFile(file, 'utf-8')).toBe(before)
  })

  it('does not create a file when the first save is invalid', async () => {
    await mkdir(join(dir, 'empty'))
    const store = createSettingsStore(join(dir, 'empty', 'settings.json'))
    await expect(store.save({ ...custom, username: '' })).rejects.toBeInstanceOf(
      SettingsValidationError
    )
    expect(await readdir(join(dir, 'empty'))).toEqual([])
  })

  it('never writes secrets: only known settings keys are stored', async () => {
    await createSettingsStore(file).save({ ...custom, password: 'x' } as unknown as Settings)
    expect(Object.keys(JSON.parse(await readFile(file, 'utf-8'))).sort()).toEqual(
      Object.keys(DEFAULT_SETTINGS).sort()
    )
  })
})
