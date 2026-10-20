import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { BentoApi } from '@shared/ipc'
import type { BentoStatus } from '@shared/monitors'
import type { HistoryResult } from '@shared/history'
import { useActionsStore } from '../src/renderer/src/stores/actions'
import { useHistoryStore } from '../src/renderer/src/stores/history'
import { useLogsStore } from '../src/renderer/src/stores/logs'
import { useSettingsStore } from '../src/renderer/src/stores/settings'
import { useUpdatesStore } from '../src/renderer/src/stores/updates'
import type { UpdateState } from '@shared/updates'
import { useStatusStore } from '../src/renderer/src/stores/status'
import { toForm } from '../src/renderer/src/settings-form'

const statusA = { connection: 'online', overall: 'ok' } as BentoStatus
const statusB = { connection: 'offline', overall: 'offline' } as BentoStatus

const updateIdle: UpdateState = {
  phase: 'idle',
  currentVersion: '1.0.0',
  version: null,
  percent: null,
  error: null,
  checkedAt: null
}

interface FakeBento extends BentoApi {
  getStatus: Mock
  refresh: Mock
  onStatus: Mock
  getSettings: Mock
  saveSettings: Mock
  testConnection: Mock
  getHistory: Mock
  getLogs: Mock
  containerAction: Mock
  forgetContainer: Mock
  openContainerPort: Mock
  getUpdateState: Mock
  onUpdate: Mock
  checkForUpdate: Mock
  downloadUpdate: Mock
  installUpdate: Mock
  pushUpdate(state: UpdateState): void
  push(status: BentoStatus): void
  unsubscribe: Mock
}

function installBento(): FakeBento {
  let listener: ((s: BentoStatus) => void) | undefined
  let updateListener: ((s: UpdateState) => void) | undefined
  const unsubscribe = vi.fn()
  const bento = {
    getAppInfo: vi.fn(),
    getStatus: vi.fn().mockResolvedValue(statusA),
    refresh: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn((l: (s: BentoStatus) => void) => {
      listener = l
      return unsubscribe
    }),
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    saveSettings: vi.fn(),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    getHistory: vi.fn().mockResolvedValue(null),
    getLogs: vi.fn().mockResolvedValue({ ok: true, lines: ['a'], fetchedAt: 1 }),
    containerAction: vi.fn().mockResolvedValue({ ok: true }),
    forgetContainer: vi.fn().mockResolvedValue(undefined),
    openContainerPort: vi.fn().mockResolvedValue({ ok: true }),
    getUpdateState: vi.fn().mockResolvedValue(updateIdle),
    onUpdate: vi.fn((l: (s: UpdateState) => void) => {
      updateListener = l
      return unsubscribe
    }),
    checkForUpdate: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    pushUpdate: (s: UpdateState) => updateListener?.(s),
    push: (s: BentoStatus) => listener?.(s),
    unsubscribe
  } as unknown as FakeBento
  vi.stubGlobal('window', { bento })
  return bento
}

let bento: FakeBento

beforeEach(() => {
  setActivePinia(createPinia())
  bento = installBento()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('status store', () => {
  it('loads the current status and follows pushed updates', async () => {
    const store = useStatusStore()
    expect(store.status).toBeNull()

    await store.init()
    expect(store.status).toEqual(statusA)

    bento.push(statusB)
    expect(store.status).toEqual(statusB)
  })

  it('subscribes only once', async () => {
    const store = useStatusStore()
    await store.init()
    await store.init()
    expect(bento.onStatus).toHaveBeenCalledTimes(1)
  })

  it('asks main to refresh', async () => {
    const store = useStatusStore()
    await store.refresh()
    expect(bento.refresh).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes on dispose', async () => {
    const store = useStatusStore()
    await store.init()
    store.dispose()
    expect(bento.unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('settings store', () => {
  it('loads the settings', async () => {
    const store = useSettingsStore()
    await store.load()
    expect(store.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('saves valid settings built from the form', async () => {
    const saved = { ...DEFAULT_SETTINGS, host: 'bento.ts.net' }
    bento.saveSettings.mockResolvedValue({ ok: true, settings: saved })
    const store = useSettingsStore()
    await store.load()

    const form = { ...toForm(DEFAULT_SETTINGS), host: 'bento.ts.net' }
    await expect(store.save(form)).resolves.toBe(true)

    expect(bento.saveSettings).toHaveBeenCalledExactlyOnceWith(saved)
    expect(store.settings).toEqual(saved)
    expect(store.errors).toEqual({})
  })

  it('keeps the previous settings and exposes the errors when validation fails', async () => {
    bento.saveSettings.mockResolvedValue({ ok: false, errors: { port: 'Port invalide' } })
    const store = useSettingsStore()
    await store.load()

    await expect(store.save({ ...toForm(DEFAULT_SETTINGS), port: 0 })).resolves.toBe(false)
    expect(store.settings).toEqual(DEFAULT_SETTINGS)
    expect(store.errors).toEqual({ port: 'Port invalide' })
  })

  it('reports an unexpected IPC failure as a form-level error', async () => {
    bento.saveSettings.mockRejectedValue(new Error('Untrusted IPC sender'))
    const store = useSettingsStore()
    await store.load()

    await expect(store.save(toForm(DEFAULT_SETTINGS))).resolves.toBe(false)
    expect(store.errors.settings).toBeTypeOf('string')
  })

  it('tests the settings as typed in the form, without saving them', async () => {
    const store = useSettingsStore()
    await store.load()
    const form = { ...toForm(DEFAULT_SETTINGS), host: 'other.ts.net' }

    await store.testConnection(form)

    expect(bento.testConnection).toHaveBeenCalledExactlyOnceWith({
      ...DEFAULT_SETTINGS,
      host: 'other.ts.net'
    })
    expect(bento.saveSettings).not.toHaveBeenCalled()
    expect(store.settings).toEqual(DEFAULT_SETTINGS)
    expect(store.testResult).toEqual({ ok: true })
    expect(store.testing).toBe(false)
  })

  it('is busy while a test runs and ignores a second click', async () => {
    let answer: (value: unknown) => void = () => {}
    bento.testConnection.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const store = useSettingsStore()

    const first = store.testConnection(toForm(DEFAULT_SETTINGS))
    expect(store.testing).toBe(true)
    expect(store.testResult).toBeNull()
    await store.testConnection(toForm(DEFAULT_SETTINGS))
    expect(bento.testConnection).toHaveBeenCalledOnce()

    answer({ ok: true })
    await first
    expect(store.testing).toBe(false)
  })

  it('keeps the explanation of a failed test, and clears it on the next attempt', async () => {
    bento.testConnection.mockResolvedValue({
      ok: false,
      message: 'bento ne répond pas.',
      technical: 'connect EHOSTUNREACH'
    })
    const store = useSettingsStore()
    await store.testConnection(toForm(DEFAULT_SETTINGS))
    expect(store.testResult).toEqual({
      ok: false,
      message: 'bento ne répond pas.',
      technical: 'connect EHOSTUNREACH'
    })

    let answer: (value: unknown) => void = () => {}
    bento.testConnection.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const next = store.testConnection(toForm(DEFAULT_SETTINGS))
    expect(store.testResult).toBeNull()
    answer({ ok: true })
    await next
    expect(store.testResult).toEqual({ ok: true })
  })

  it('turns a failing call into a readable result', async () => {
    bento.testConnection.mockRejectedValue(new Error('Untrusted IPC sender'))
    const store = useSettingsStore()
    await store.testConnection(toForm(DEFAULT_SETTINGS))
    expect(store.testResult).toEqual({
      ok: false,
      message: "Le test a échoué. Réessayez ou relancez l'application.",
      technical: null
    })
    expect(store.testing).toBe(false)
  })

  it('forgets the last test result when the settings are saved', async () => {
    const store = useSettingsStore()
    await store.load()
    await store.testConnection(toForm(DEFAULT_SETTINGS))
    bento.saveSettings.mockResolvedValue({ ok: true, settings: DEFAULT_SETTINGS })
    await store.save(toForm(DEFAULT_SETTINGS))
    expect(store.testResult).toBeNull()
  })

  it('clears old errors after a successful save', async () => {
    const store = useSettingsStore()
    await store.load()
    bento.saveSettings.mockResolvedValueOnce({ ok: false, errors: { port: 'x' } })
    await store.save(toForm(DEFAULT_SETTINGS))
    bento.saveSettings.mockResolvedValueOnce({ ok: true, settings: DEFAULT_SETTINGS })
    await store.save(toForm(DEFAULT_SETTINGS))
    expect(store.errors).toEqual({})
  })
})

describe('logs store', () => {
  it('starts on the tailscaled journal and loads its lines', async () => {
    const store = useLogsStore()
    expect(store.source).toBe('tailscaled')
    expect(store.result).toBeNull()

    await store.load()
    expect(bento.getLogs).toHaveBeenCalledExactlyOnceWith('tailscaled')
    expect(store.result).toEqual({ ok: true, lines: ['a'], fetchedAt: 1 })
    expect(store.loading).toBe(false)
  })

  it('is loading while the request is pending', async () => {
    let answer: (value: unknown) => void = () => {}
    bento.getLogs.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const store = useLogsStore()

    const pending = store.load()
    expect(store.loading).toBe(true)
    answer({ ok: true, lines: [], fetchedAt: 2 })
    await pending
    expect(store.loading).toBe(false)
  })

  it('select() switches the source, drops the old lines and reloads', async () => {
    const store = useLogsStore()
    await store.load()
    bento.getLogs.mockResolvedValue({ ok: true, lines: ['t'], fetchedAt: 3 })

    await store.select('tailscaled')
    expect(store.source).toBe('tailscaled')
    expect(bento.getLogs).toHaveBeenLastCalledWith('tailscaled')
    expect(store.result).toEqual({ ok: true, lines: ['t'], fetchedAt: 3 })
  })

  it('ignores a late answer for a source that is no longer selected', async () => {
    let answerSlow: (value: unknown) => void = () => {}
    bento.getLogs.mockReturnValueOnce(new Promise((resolve) => (answerSlow = resolve)))
    const store = useLogsStore()

    const slow = store.load()
    bento.getLogs.mockResolvedValueOnce({ ok: true, lines: ['fast'], fetchedAt: 5 })
    await store.select('tailscaled')
    answerSlow({ ok: true, lines: ['slow'], fetchedAt: 4 })
    await slow

    expect(store.result).toEqual({ ok: true, lines: ['fast'], fetchedAt: 5 })
    expect(store.loading).toBe(false)
  })

  it('shows a readable error when the call itself fails', async () => {
    bento.getLogs.mockRejectedValue(new Error('ipc'))
    const store = useLogsStore()
    await store.load()
    expect(store.result).toEqual({ ok: false, error: 'Lecture des journaux impossible.' })
  })
})

describe('actions store (container actions)', () => {
  it('runs an action on a container and reports no error', async () => {
    const store = useActionsStore()
    await store.runAction('restart', 'jellyfin')
    expect(bento.containerAction).toHaveBeenCalledExactlyOnceWith('restart', 'jellyfin')
    expect(store.actionError).toBeNull()
    expect(store.busy).toBeNull()
  })

  it('is busy on that container and action while it runs, and ignores a second click', async () => {
    let answer: (value: unknown) => void = () => {}
    bento.containerAction.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const store = useActionsStore()

    const first = store.runAction('stop', 'series')
    expect(store.busy).toEqual({ action: 'stop', container: 'series' })
    await store.runAction('restart', 'movies')
    expect(bento.containerAction).toHaveBeenCalledOnce()

    answer({ ok: true })
    await first
    expect(store.busy).toBeNull()
  })

  it('stays silent when the user cancels in the native box', async () => {
    bento.containerAction.mockResolvedValue({ ok: false, cancelled: true })
    const store = useActionsStore()
    await store.runAction('stop', 'jellyfin')
    expect(store.actionError).toBeNull()
    expect(store.busy).toBeNull()
  })

  it('keeps the error of a failed action with its container, and clears it on the next attempt', async () => {
    bento.containerAction.mockResolvedValue({ ok: false, error: 'Bento est injoignable.' })
    const store = useActionsStore()
    await store.runAction('restart', 'series')
    expect(store.actionError).toEqual({ container: 'series', message: 'Bento est injoignable.' })

    bento.containerAction.mockResolvedValue({ ok: true })
    await store.runAction('restart', 'series')
    expect(store.actionError).toBeNull()
  })

  it.each([
    ['start', 'Le démarrage a échoué.'],
    ['stop', "L'arrêt a échoué."],
    ['restart', 'Le redémarrage a échoué.']
  ] as const)('turns a failing %s call into a readable error', async (action, message) => {
    bento.containerAction.mockRejectedValue(new Error('ipc'))
    const store = useActionsStore()
    await store.runAction(action, 'series')
    expect(store.actionError).toEqual({ container: 'series', message })
    expect(store.busy).toBeNull()
  })
})

describe('actions store (container links and stops)', () => {
  it('opens a published port of a container', async () => {
    const store = useActionsStore()
    await store.openPort('jellyfin', 8096)
    expect(bento.openContainerPort).toHaveBeenCalledExactlyOnceWith('jellyfin', 8096)
    expect(store.portError).toBeNull()
  })

  it('keeps the error of a link that could not be opened, and clears it on the next success', async () => {
    bento.openContainerPort.mockResolvedValue({ ok: false, error: "Impossible d'ouvrir ce lien." })
    const store = useActionsStore()
    await store.openPort('jellyfin', 8096)
    expect(store.portError).toBe("Impossible d'ouvrir ce lien.")

    bento.openContainerPort.mockResolvedValue({ ok: true })
    await store.openPort('jellyfin', 8096)
    expect(store.portError).toBeNull()
  })

  it('turns a failing call into a readable error', async () => {
    bento.openContainerPort.mockRejectedValue(new Error('ipc'))
    const store = useActionsStore()
    await store.openPort('jellyfin', 8096)
    expect(store.portError).toBe("Impossible d'ouvrir ce lien.")
  })

  it('asks main to stop alerting for a stopped container', async () => {
    const store = useActionsStore()
    await store.forgetContainer('stream')
    expect(bento.forgetContainer).toHaveBeenCalledExactlyOnceWith('stream')
  })

  it('does not throw when forgetting fails', async () => {
    bento.forgetContainer.mockRejectedValue(new Error('ipc'))
    const store = useActionsStore()
    await expect(store.forgetContainer('stream')).resolves.toBeUndefined()
  })
})

describe('updates store', () => {
  const ready: UpdateState = { ...updateIdle, phase: 'ready', version: '1.1.0' }

  it('loads the current state and follows pushed updates', async () => {
    const store = useUpdatesStore()
    expect(store.state).toBeNull()

    await store.init()
    expect(store.state).toEqual(updateIdle)
    bento.pushUpdate(ready)
    expect(store.state).toEqual(ready)
  })

  it('prefers a pushed state over the one it asked for', async () => {
    let answer: (value: UpdateState) => void = () => {}
    bento.getUpdateState.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const store = useUpdatesStore()

    const init = store.init()
    bento.pushUpdate(ready)
    answer(updateIdle)
    await init
    expect(store.state).toEqual(ready)
  })

  it('subscribes once and unsubscribes on dispose', async () => {
    const store = useUpdatesStore()
    await store.init()
    await store.init()
    expect(bento.onUpdate).toHaveBeenCalledOnce()
    store.dispose()
    expect(bento.unsubscribe).toHaveBeenCalledOnce()
  })

  it('checks, downloads and installs through the main process', async () => {
    const store = useUpdatesStore()
    await store.check()
    await store.download()
    await store.install()
    expect(bento.checkForUpdate).toHaveBeenCalledOnce()
    expect(bento.downloadUpdate).toHaveBeenCalledOnce()
    expect(bento.installUpdate).toHaveBeenCalledOnce()
  })
})

describe('history store', () => {
  const answer = (range: HistoryResult['range'], now = 1): HistoryResult => ({
    range,
    points: [],
    incidents: [],
    now
  })

  it('starts on the last 24 hours, with nothing loaded', () => {
    const store = useHistoryStore()
    expect(store.range).toBe('24h')
    expect(store.result).toBeNull()
    expect(store.loading).toBe(false)
  })

  it('loads the history of the current range', async () => {
    bento.getHistory.mockResolvedValue(answer('24h'))
    const store = useHistoryStore()
    await store.load()
    expect(bento.getHistory).toHaveBeenCalledExactlyOnceWith('24h')
    expect(store.result).toEqual(answer('24h'))
    expect(store.failed).toBe(false)
    expect(store.loading).toBe(false)
  })

  it('changes the range and loads it', async () => {
    bento.getHistory.mockResolvedValue(answer('7d'))
    const store = useHistoryStore()
    await store.setRange('7d')
    expect(store.range).toBe('7d')
    expect(bento.getHistory).toHaveBeenCalledExactlyOnceWith('7d')
    expect(store.result?.range).toBe('7d')
  })

  it('keeps the previous charts on screen while a new load is running', async () => {
    bento.getHistory.mockResolvedValueOnce(answer('24h', 1))
    const store = useHistoryStore()
    await store.load()

    let finish: (value: unknown) => void = () => {}
    bento.getHistory.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const next = store.load()
    expect(store.loading).toBe(true)
    expect(store.result?.now).toBe(1)

    finish(answer('24h', 2))
    await next
    expect(store.result?.now).toBe(2)
    expect(store.loading).toBe(false)
  })

  it('discards a late answer for a range that is no longer the one shown', async () => {
    let finishSlow: (value: unknown) => void = () => {}
    bento.getHistory.mockReturnValueOnce(new Promise((resolve) => (finishSlow = resolve)))
    const store = useHistoryStore()
    const slow = store.setRange('7d')

    bento.getHistory.mockResolvedValueOnce(answer('1h'))
    await store.setRange('1h')
    expect(store.result?.range).toBe('1h')

    finishSlow(answer('7d'))
    await slow
    expect(store.range).toBe('1h')
    expect(store.result?.range).toBe('1h')
    expect(store.loading).toBe(false)
  })

  it('has nothing to show when main has no history, without calling it an error', async () => {
    bento.getHistory.mockResolvedValue(null)
    const store = useHistoryStore()
    await store.load()
    expect(store.result).toBeNull()
    expect(store.failed).toBe(false)
  })

  it('flags a failed call and keeps what was shown before', async () => {
    bento.getHistory.mockResolvedValueOnce(answer('24h', 1))
    const store = useHistoryStore()
    await store.load()

    bento.getHistory.mockRejectedValue(new Error('ipc'))
    await store.load()
    expect(store.failed).toBe(true)
    expect(store.result?.now).toBe(1)
    expect(store.loading).toBe(false)

    bento.getHistory.mockResolvedValue(answer('24h', 3))
    await store.load()
    expect(store.failed).toBe(false)
  })
})
