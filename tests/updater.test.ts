import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { UpdateState } from '@shared/updates'
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  UpdateController,
  type UpdaterLike
} from '../src/main/updater/controller'

type Listener = (...args: unknown[]) => void

interface FakeUpdater extends UpdaterLike {
  emit(event: string, ...args: unknown[]): void
  checkForUpdates: Mock<() => Promise<unknown>>
  quitAndInstall: Mock<() => void>
  downloadUpdate: Mock<() => Promise<unknown>>
}

function fakeUpdater(): FakeUpdater {
  const listeners = new Map<string, Listener[]>()
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdates: vi.fn().mockResolvedValue(null),
    quitAndInstall: vi.fn(),
    downloadUpdate: vi.fn().mockResolvedValue(null),
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener])
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    }
  }
}

let updater: FakeUpdater
let now: number

function create(overrides: { isPackaged?: boolean } = {}): UpdateController {
  return new UpdateController({
    updater,
    isPackaged: overrides.isPackaged ?? true,
    currentVersion: '1.0.0',
    now: () => now
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  updater = fakeUpdater()
  now = 1_000
})

afterEach(() => {
  vi.useRealTimers()
})

describe('UpdateController setup', () => {
  it('never downloads on its own, and installs on quit only what the user downloaded', () => {
    create()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })

  it('starts idle with the current version', () => {
    const controller = create()
    expect(controller.state).toMatchObject({
      phase: 'idle',
      currentVersion: '1.0.0',
      version: null
    })
    expect(controller.state).not.toHaveProperty('tokenSet')
  })
})

describe('UpdateController check()', () => {
  it('does nothing in development', async () => {
    const controller = create({ isPackaged: false })
    await controller.check()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(controller.state.phase).toBe('unavailable')
  })

  it('checks the public releases without any credential', async () => {
    const controller = create()
    const seen: string[] = []
    controller.onState((s) => seen.push(s.phase))

    await controller.check()
    expect(updater).not.toHaveProperty('authenticate')
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(seen[0]).toBe('checking')
  })

  it('shares one check between concurrent calls', async () => {
    let finish: () => void = () => {}
    updater.checkForUpdates.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    const controller = create()

    const first = controller.check()
    const second = controller.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    finish()
    await Promise.all([first, second])
  })

  it('goes up-to-date and remembers when it checked', async () => {
    const controller = create()
    await controller.check()
    now = 5_000
    updater.emit('update-not-available')
    expect(controller.state).toMatchObject({ phase: 'up-to-date', checkedAt: 5_000 })
  })

  it('waits for the user when an update is found', async () => {
    const controller = create()
    await controller.check()

    updater.emit('update-available', { version: '1.1.0' })
    expect(controller.state).toMatchObject({ phase: 'available', version: '1.1.0', percent: null })
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('follows an update from found to downloaded once the user agrees', async () => {
    const controller = create()
    await controller.check()
    updater.emit('update-available', { version: '1.1.0' })

    await controller.download()
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(controller.state).toMatchObject({ phase: 'downloading', version: '1.1.0', percent: 0 })

    updater.emit('download-progress', { percent: 41.6 })
    expect(controller.state).toMatchObject({ phase: 'downloading', percent: 42 })

    updater.emit('update-downloaded', { version: '1.1.0' })
    expect(controller.state).toMatchObject({ phase: 'ready', version: '1.1.0', percent: null })
  })

  it.each([
    [
      'HttpError: 403 rate limit',
      'GitHub refuse la vérification pour le moment. Réessayez plus tard.'
    ],
    [
      'HttpError: 429 Too Many Requests',
      'GitHub refuse la vérification pour le moment. Réessayez plus tard.'
    ],
    ['HttpError: 404 Not Found', 'Aucune version trouvée sur GitHub.'],
    ['getaddrinfo ENOTFOUND api.github.com', 'GitHub est injoignable pour le moment.'],
    ['net::ERR_INTERNET_DISCONNECTED', 'GitHub est injoignable pour le moment.'],
    ['something odd', 'La vérification des mises à jour a échoué.']
  ])('explains the error "%s" in French', async (message, expected) => {
    const controller = create()
    await controller.check()
    updater.emit('error', new Error(message))
    expect(controller.state).toMatchObject({ phase: 'error', error: expected })
  })

  it('never repeats the raw error, which could echo a header', async () => {
    const controller = create()
    await controller.check()
    updater.emit('error', new Error('request failed, Authorization: secret-value'))
    expect(JSON.stringify(controller.state)).not.toContain('secret-value')
  })

  it('handles a check that throws as an error state, not a crash', async () => {
    updater.checkForUpdates.mockRejectedValue(new Error('getaddrinfo ENOTFOUND github.com'))
    const controller = create()
    await expect(controller.check()).resolves.toBeUndefined()
    expect(controller.state).toMatchObject({
      phase: 'error',
      error: 'GitHub est injoignable pour le moment.'
    })
  })

  it('does not check again while an update is ready', async () => {
    const controller = create()
    await controller.check()
    updater.emit('update-downloaded', { version: '1.1.0' })
    updater.checkForUpdates.mockClear()

    await controller.check()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(controller.state.phase).toBe('ready')
  })
})

describe('UpdateController download()', () => {
  it('does nothing unless an update is waiting for the user', async () => {
    const controller = create()
    await controller.download()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(controller.state.phase).toBe('idle')
  })

  it('downloads only once when asked twice', async () => {
    let finish: () => void = () => {}
    updater.downloadUpdate.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    const controller = create()
    updater.emit('update-available', { version: '1.1.0' })

    const first = controller.download()
    const second = controller.download()
    finish()
    await Promise.all([first, second])
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
  })

  it('reports a failed download as a French error, without the raw message', async () => {
    updater.downloadUpdate.mockRejectedValue(new Error('getaddrinfo ENOTFOUND secret-host'))
    const controller = create()
    updater.emit('update-available', { version: '1.1.0' })

    await expect(controller.download()).resolves.toBeUndefined()
    expect(controller.state).toMatchObject({
      phase: 'error',
      error: 'GitHub est injoignable pour le moment.'
    })
    expect(JSON.stringify(controller.state)).not.toContain('secret-host')
  })

  it('does not check again while an update waits for the user', async () => {
    const controller = create()
    await controller.check()
    updater.emit('update-available', { version: '1.1.0' })
    updater.checkForUpdates.mockClear()

    await controller.check()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(controller.state).toMatchObject({ phase: 'available', version: '1.1.0' })
  })
})

describe('UpdateController install()', () => {
  it('installs only a downloaded update', async () => {
    const controller = create()
    controller.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    await controller.check()
    updater.emit('update-downloaded', { version: '1.1.0' })
    controller.install()
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
  })
})

describe('UpdateController schedule', () => {
  it('checks shortly after startup, then every few hours, until stopped', async () => {
    const controller = create()
    controller.start()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)

    controller.stop()
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('keeps its schedule after a failure instead of retrying in a loop', async () => {
    updater.checkForUpdates.mockRejectedValue(new Error('ENOTFOUND'))
    const controller = create()
    controller.start()

    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS)
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    controller.stop()
  })

  it('does not schedule anything in development', async () => {
    const controller = create({ isPackaged: false })
    controller.start()
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('UpdateController listeners', () => {
  it('notifies on each change and stops after unsubscribe', async () => {
    const controller = create()
    const listener = vi.fn<(state: UpdateState) => void>()
    const unsubscribe = controller.onState(listener)

    await controller.check()
    expect(listener).toHaveBeenCalled()
    const calls = listener.mock.calls.length
    unsubscribe()
    updater.emit('update-not-available')
    expect(listener).toHaveBeenCalledTimes(calls)
  })
})
