import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import type { BentoStatus } from '@shared/monitors'
import { createBentoService } from '../src/main/service'
import { SettingsValidationError, type SettingsStore } from '../src/main/settings/store'
import { validateSettings } from '../src/main/settings/validate'
import { SNAPSHOT_COMMAND } from '../src/main/monitors/snapshot'
import {
  containerActionCommand,
  containerLogCommand,
  TAILSCALED_LOG_COMMAND
} from '../src/main/ssh/commands'
import type { Connector, SshSession } from '../src/main/ssh/connection'
import type { SshConfig } from '../src/main/ssh/ssh2-connector'
import { createRunningMemory } from '../src/main/monitors/running-memory'
import { snapshotOutput } from './helpers/snapshot-output'

const FINGERPRINT = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const configured: Settings = {
  ...DEFAULT_SETTINGS,
  host: 'bento.ts.net',
  hostFingerprint: FINGERPRINT,
  logContainers: ['jellyfin', 'proxy-app-1']
}

function memoryStore(initial: Settings): SettingsStore & { current: () => Settings } {
  let current = structuredClone(initial)
  return {
    current: () => current,
    load: async () => structuredClone(current),
    save: async (input) => {
      const { settings, errors } = validateSettings(input)
      if (Object.keys(errors).length > 0) throw new SettingsValidationError(errors)
      current = settings
    }
  }
}

interface FakeSession extends SshSession {
  exec: Mock
  close: Mock
}

function harness(initial: Settings): {
  store: ReturnType<typeof memoryStore>
  createConnector: Mock<(config: SshConfig) => Connector>
  sessions: FakeSession[]
} {
  const sessions: FakeSession[] = []
  const createConnector = vi.fn((): Connector => async () => {
    const session: FakeSession = {
      exec: vi.fn().mockResolvedValue({ stdout: snapshotOutput(), stderr: '', code: 0 }),
      close: vi.fn(),
      onClose: () => {}
    }
    sessions.push(session)
    return session
  })
  return { store: memoryStore(initial), createConnector, sessions }
}

const flush = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// The recorded docker output has one unhealthy container (homepage), hence "degraded" below.
describe('createBentoService startup', () => {
  it('stays idle and unconfigured on first run', async () => {
    const { store, createConnector } = harness(DEFAULT_SETTINGS)
    const service = await createBentoService({ store, createConnector })
    await flush()

    expect(createConnector).not.toHaveBeenCalled()
    expect(service.status).toMatchObject({ configured: false, overall: 'unconfigured' })
    expect(service.getSettings()).toEqual(DEFAULT_SETTINGS)
    service.dispose()
  })

  it('connects with the stored settings and publishes the first snapshot', async () => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()

    expect(createConnector).toHaveBeenCalledExactlyOnceWith({
      host: 'bento.ts.net',
      port: 22,
      username: 'bento-dash',
      hostFingerprint: FINGERPRINT,
      auth: { kind: 'agent' }
    })
    expect(sessions[0].exec).toHaveBeenCalledWith(SNAPSHOT_COMMAND)
    expect(service.status).toMatchObject({ connection: 'online', overall: 'degraded' })
    expect(service.status.services).toHaveLength(27)
    service.dispose()
  })

  it('treats an unreachable server as a normal offline state', async () => {
    const { store } = harness(configured)
    const createConnector = vi.fn((): Connector => () => Promise.reject(new Error('timeout')))
    const service = await createBentoService({ store, createConnector })
    await flush()

    expect(service.status).toMatchObject({
      connection: 'offline',
      overall: 'offline',
      lastError: 'timeout'
    })
    service.dispose()
  })
})

describe('BentoService.saveSettings', () => {
  it('rejects invalid settings without side effects', async () => {
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()

    const result = await service.saveSettings({ ...configured, port: 0 })
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && Object.keys(result.errors)).toEqual(['port'])
    expect(service.getSettings()).toEqual(configured)
    expect(store.current()).toEqual(configured)
    expect(createConnector).toHaveBeenCalledTimes(1)
    service.dispose()
  })

  it('starts connecting once host and fingerprint are provided', async () => {
    const { store, createConnector } = harness(DEFAULT_SETTINGS)
    const service = await createBentoService({ store, createConnector })

    const result = await service.saveSettings(configured)
    await flush()

    expect(result).toEqual({ ok: true, settings: configured })
    expect(createConnector).toHaveBeenCalledTimes(1)
    expect(service.status.overall).toBe('degraded')
    service.dispose()
  })

  it('reconnects with a new connector when a connection parameter changes', async () => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()

    await service.saveSettings({ ...configured, host: 'other.ts.net' })
    await flush()

    expect(sessions[0].close).toHaveBeenCalledTimes(1)
    expect(createConnector).toHaveBeenCalledTimes(2)
    expect(createConnector.mock.calls[1][0]).toMatchObject({ host: 'other.ts.net' })
    expect(service.status.connection).toBe('online')
    service.dispose()
  })

  it('keeps the connection and re-polls when only display settings change', async () => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()

    await service.saveSettings({ ...configured, diskThresholdPercent: 30 })
    await flush()

    expect(createConnector).toHaveBeenCalledTimes(1)
    expect(sessions[0].close).not.toHaveBeenCalled()
    expect(sessions[0].exec).toHaveBeenCalledTimes(2)
    expect(service.status.metrics?.disks.some((d) => d.overThreshold)).toBe(true)
    service.dispose()
  })

  it('disconnects when the host is cleared', async () => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()

    await service.saveSettings({ ...configured, host: '' })
    await flush(120000)

    expect(sessions[0].close).toHaveBeenCalledTimes(1)
    expect(createConnector).toHaveBeenCalledTimes(1)
    expect(service.status).toMatchObject({ connection: 'offline', overall: 'unconfigured' })
    service.dispose()
  })

  it('persists the sanitised settings', async () => {
    const { store, createConnector } = harness(DEFAULT_SETTINGS)
    const service = await createBentoService({ store, createConnector })

    await service.saveSettings({ ...configured, host: '  bento.ts.net  ', password: 'x' })
    expect(store.current()).toEqual(configured)
    service.dispose()
  })
})

describe('BentoService status and lifecycle', () => {
  it('relays status updates to listeners', async () => {
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    const seen: BentoStatus[] = []
    service.onStatus((s) => seen.push(s))
    await flush()

    expect(seen.at(-1)?.overall).toBe('degraded')
    service.dispose()
  })

  it('refresh() polls immediately', async () => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()

    await service.refresh()
    expect(sessions[0].exec).toHaveBeenCalledTimes(2)
    service.dispose()
  })

  it('dispose() closes the session and stops polling', async () => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()

    service.dispose()
    await flush(120000)
    expect(sessions[0].close).toHaveBeenCalledTimes(1)
    expect(sessions[0].exec).toHaveBeenCalledTimes(1)
  })
})

describe('BentoService settings hook', () => {
  it('reports the loaded settings once at startup', async () => {
    const { store, createConnector } = harness(configured)
    const onSettings = vi.fn()
    const service = await createBentoService({ store, createConnector, onSettings })

    expect(onSettings).toHaveBeenCalledExactlyOnceWith(configured)
    service.dispose()
  })

  it('reports the sanitised settings after a successful save', async () => {
    const { store, createConnector } = harness(configured)
    const onSettings = vi.fn()
    const service = await createBentoService({ store, createConnector, onSettings })
    onSettings.mockClear()

    await service.saveSettings({ ...configured, launchAtStartup: true })
    expect(onSettings).toHaveBeenCalledExactlyOnceWith({ ...configured, launchAtStartup: true })
    service.dispose()
  })

  it('does not report rejected settings', async () => {
    const { store, createConnector } = harness(configured)
    const onSettings = vi.fn()
    const service = await createBentoService({ store, createConnector, onSettings })
    onSettings.mockClear()

    await service.saveSettings({ ...configured, port: 0 })
    expect(onSettings).not.toHaveBeenCalled()
    service.dispose()
  })
})

describe('BentoService.getLogs', () => {
  it('runs the fixed command of the requested source and returns its lines', async () => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()
    sessions[0].exec.mockResolvedValue({ stdout: 'one\ntwo\n', stderr: '', code: 0 })

    const result = await service.getLogs('container:proxy-app-1')
    expect(result).toMatchObject({ ok: true, lines: ['one', 'two'] })
    expect(sessions[0].exec).toHaveBeenLastCalledWith(containerLogCommand('proxy-app-1'))
    service.dispose()
  })

  it.each([
    undefined,
    null,
    42,
    {},
    'jellyfin',
    'sshd',
    'jellyfin; reboot',
    '__proto__',
    'constructor',
    'container:',
    'container:-f',
    'container:--help',
    'container:a;id',
    'container:$(id)',
    'container:jellyfin; reboot',
    'container:jellyfin extra',
    'container:../jellyfin',
    'container:container:jellyfin'
  ])('refuses the unknown source %j without sending anything', async (source) => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()
    sessions[0].exec.mockClear()

    await expect(service.getLogs(source)).resolves.toEqual({
      ok: false,
      error: 'Source de journaux inconnue.'
    })
    expect(sessions[0].exec).not.toHaveBeenCalled()
    service.dispose()
  })

  it('refuses a well-formed container that is not chosen in the settings', async () => {
    const { store, createConnector, sessions } = harness({ ...configured, logContainers: [] })
    const service = await createBentoService({ store, createConnector })
    await flush()
    sessions[0].exec.mockClear()

    await expect(service.getLogs('container:jellyfin')).resolves.toEqual({
      ok: false,
      error: 'Source de journaux inconnue.'
    })
    expect(sessions[0].exec).not.toHaveBeenCalled()
    service.dispose()
  })

  it('refuses a container chosen in the settings that the last poll did not list', async () => {
    const { store, createConnector, sessions } = harness({
      ...configured,
      logContainers: ['jellyfin', 'ghost']
    })
    const service = await createBentoService({ store, createConnector })
    await flush()
    sessions[0].exec.mockClear()

    await expect(service.getLogs('container:ghost')).resolves.toEqual({
      ok: false,
      error: 'Source de journaux inconnue.'
    })
    expect(sessions[0].exec).not.toHaveBeenCalled()
    service.dispose()
  })

  it('reads tailscaled without any container setting', async () => {
    const { store, createConnector, sessions } = harness({ ...configured, logContainers: [] })
    const service = await createBentoService({ store, createConnector })
    await flush()
    sessions[0].exec.mockResolvedValue({ stdout: 'up\n', stderr: '', code: 0 })

    await expect(service.getLogs('tailscaled')).resolves.toMatchObject({ ok: true, lines: ['up'] })
    expect(sessions[0].exec).toHaveBeenLastCalledWith(TAILSCALED_LOG_COMMAND)
    service.dispose()
  })

  it('follows the settings: a container added later can be read, one removed cannot', async () => {
    const { store, createConnector, sessions } = harness({ ...configured, logContainers: [] })
    const service = await createBentoService({ store, createConnector })
    await flush()
    sessions[0].exec.mockResolvedValue({ stdout: 'x\n', stderr: '', code: 0 })

    await service.saveSettings({ ...configured, logContainers: ['jellyfin'] })
    await flush()
    await expect(service.getLogs('container:jellyfin')).resolves.toMatchObject({ ok: true })
    await service.saveSettings({ ...configured, logContainers: [] })
    await flush()
    await expect(service.getLogs('container:jellyfin')).resolves.toEqual({
      ok: false,
      error: 'Source de journaux inconnue.'
    })
    service.dispose()
  })

  it('tells the user a container has no sudoers rule on bento', async () => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()
    sessions[0].exec.mockResolvedValue({
      stdout: '',
      stderr: 'sudo: a password is required',
      code: 1
    })

    await expect(service.getLogs('container:jellyfin')).resolves.toEqual({
      ok: false,
      error: "Ce conteneur n'a pas de règle sudoers sur bento (voir le README)."
    })
    service.dispose()
  })

  it('answers with a clear error when bento is offline', async () => {
    const { store } = harness(configured)
    const createConnector = vi.fn((): Connector => () => Promise.reject(new Error('timeout')))
    const service = await createBentoService({ store, createConnector })
    await flush()

    await expect(service.getLogs('container:jellyfin')).resolves.toEqual({
      ok: false,
      error: 'Bento est injoignable.'
    })
    service.dispose()
  })

  it('turns a failing command into a readable error', async () => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()
    sessions[0].exec.mockResolvedValue({
      stdout: '',
      stderr: 'sudo: a password is required',
      code: 1
    })

    await expect(service.getLogs('tailscaled')).resolves.toEqual({
      ok: false,
      error: 'Règle sudoers manquante pour bento-dash.'
    })
    service.dispose()
  })
})

describe('BentoService.exportLogs', () => {
  async function ready(saveLogsFile?: Mock): Promise<{
    service: Awaited<ReturnType<typeof createBentoService>>
    sessions: FakeSession[]
  }> {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector, saveLogsFile })
    await flush()
    return { service, sessions }
  }

  it('saves the last lines read for that source under a fixed file name', async () => {
    const saveLogsFile = vi.fn().mockResolvedValue(true)
    const { service, sessions } = await ready(saveLogsFile)
    sessions[0].exec.mockResolvedValue({ stdout: 'one\ntwo\n', stderr: '', code: 0 })
    await service.getLogs('container:jellyfin')

    await expect(service.exportLogs('container:jellyfin')).resolves.toEqual({ ok: true })
    expect(saveLogsFile).toHaveBeenCalledExactlyOnceWith('jellyfin.log', 'one\ntwo\n')
    service.dispose()
  })

  it('keeps the cache per source and ignores failed reads', async () => {
    const saveLogsFile = vi.fn().mockResolvedValue(true)
    const { service, sessions } = await ready(saveLogsFile)
    sessions[0].exec.mockResolvedValueOnce({ stdout: 'good\n', stderr: '', code: 0 })
    await service.getLogs('container:jellyfin')
    sessions[0].exec.mockResolvedValueOnce({ stdout: '', stderr: 'boom', code: 1 })
    await service.getLogs('container:jellyfin')

    await service.exportLogs('container:jellyfin')
    expect(saveLogsFile).toHaveBeenCalledWith('jellyfin.log', 'good\n')
    await expect(service.exportLogs('tailscaled')).resolves.toEqual({
      ok: false,
      error: "Aucun journal n'a encore été lu."
    })
    service.dispose()
  })

  it('reports that nothing was loaded yet without opening the dialog', async () => {
    const saveLogsFile = vi.fn()
    const { service } = await ready(saveLogsFile)
    await expect(service.exportLogs('container:jellyfin')).resolves.toEqual({
      ok: false,
      error: "Aucun journal n'a encore été lu."
    })
    expect(saveLogsFile).not.toHaveBeenCalled()
    service.dispose()
  })

  it('treats a cancelled dialog as a normal answer', async () => {
    const { service, sessions } = await ready(vi.fn().mockResolvedValue(false))
    sessions[0].exec.mockResolvedValue({ stdout: 'x\n', stderr: '', code: 0 })
    await service.getLogs('container:jellyfin')
    await expect(service.exportLogs('container:jellyfin')).resolves.toEqual({
      ok: false,
      cancelled: true
    })
    service.dispose()
  })

  it('reports a write failure instead of throwing', async () => {
    const { service, sessions } = await ready(vi.fn().mockRejectedValue(new Error('EPERM')))
    sessions[0].exec.mockResolvedValue({ stdout: 'x\n', stderr: '', code: 0 })
    await service.getLogs('container:jellyfin')
    await expect(service.exportLogs('container:jellyfin')).resolves.toEqual({
      ok: false,
      error: "Impossible d'enregistrer le fichier."
    })
    service.dispose()
  })

  it.each([undefined, null, {}, '../x', 'sshd', '__proto__'])(
    'refuses the unknown source %j',
    async (source) => {
      const saveLogsFile = vi.fn()
      const { service } = await ready(saveLogsFile)
      await expect(service.exportLogs(source)).resolves.toEqual({
        ok: false,
        error: 'Source de journaux inconnue.'
      })
      expect(saveLogsFile).not.toHaveBeenCalled()
      service.dispose()
    }
  )

  it('proposes a file name without the source prefix', async () => {
    const saveLogsFile = vi.fn().mockResolvedValue(true)
    const { service, sessions } = await ready(saveLogsFile)
    sessions[0].exec.mockResolvedValue({ stdout: 'up\n', stderr: '', code: 0 })
    await service.getLogs('tailscaled')
    await service.exportLogs('tailscaled')
    expect(saveLogsFile).toHaveBeenCalledExactlyOnceWith('tailscaled.log', 'up\n')
    service.dispose()
  })

  it('cannot save when no file writer is wired', async () => {
    const { service, sessions } = await ready()
    sessions[0].exec.mockResolvedValue({ stdout: 'x\n', stderr: '', code: 0 })
    await service.getLogs('container:jellyfin')
    await expect(service.exportLogs('container:jellyfin')).resolves.toEqual({
      ok: false,
      cancelled: true
    })
    service.dispose()
  })
})

describe('BentoService.containerAction', () => {
  const start = async (
    extra: Partial<Parameters<typeof createBentoService>[0]> = {}
  ): Promise<{
    service: Awaited<ReturnType<typeof createBentoService>>
    sessions: ReturnType<typeof harness>['sessions']
  }> => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector, ...extra })
    await flush()
    sessions[0].exec.mockClear()
    return { service, sessions }
  }

  it('denies by default when no confirmation is wired', async () => {
    const { service, sessions } = await start()
    await expect(service.containerAction('restart', 'jellyfin')).resolves.toEqual({
      ok: false,
      cancelled: true
    })
    expect(sessions[0].exec).not.toHaveBeenCalled()
    service.dispose()
  })

  it('restarts after confirmation, holds back the notification and refreshes', async () => {
    const confirmAction = vi.fn().mockResolvedValue(true)
    const quietNotifications = vi.fn()
    const { service, sessions } = await start({ confirmAction, quietNotifications })

    await expect(service.containerAction('restart', 'jellyfin')).resolves.toEqual({ ok: true })
    expect(confirmAction).toHaveBeenCalledExactlyOnceWith('restart', 'Jellyfin')
    expect(quietNotifications).toHaveBeenCalledExactlyOnceWith('jellyfin', expect.any(Number))
    const commands = sessions[0].exec.mock.calls.map((call) => call[0])
    expect(commands).toEqual([containerActionCommand('restart', 'jellyfin'), SNAPSHOT_COMMAND])
    expect(sessions[0].exec.mock.calls[0][1]).toEqual({ timeoutMs: expect.any(Number) })
    service.dispose()
  })

  it('acts on any container the last poll listed', async () => {
    const { service, sessions } = await start({ confirmAction: vi.fn().mockResolvedValue(true) })
    await expect(service.containerAction('restart', 'series')).resolves.toEqual({ ok: true })
    expect(sessions[0].exec.mock.calls[0][0]).toBe(containerActionCommand('restart', 'series'))
    service.dispose()
  })

  it('starts without any confirmation', async () => {
    const confirmAction = vi.fn()
    const { service, sessions } = await start({ confirmAction })
    await expect(service.containerAction('start', 'stream')).resolves.toEqual({ ok: true })
    expect(confirmAction).not.toHaveBeenCalled()
    expect(sessions[0].exec.mock.calls[0][0]).toBe(containerActionCommand('start', 'stream'))
    service.dispose()
  })

  it('does not run anything when the confirmation is declined', async () => {
    const { service, sessions } = await start({ confirmAction: vi.fn().mockResolvedValue(false) })
    await expect(service.containerAction('stop', 'jellyfin')).resolves.toEqual({
      ok: false,
      cancelled: true
    })
    expect(sessions[0].exec).not.toHaveBeenCalled()
    service.dispose()
  })

  it('shows a container stopped on purpose as inactive, not as an incident', async () => {
    const { store, createConnector, sessions } = harness(configured)
    const memory = createRunningMemory(['jellyfin'])
    const service = await createBentoService({
      store,
      createConnector,
      runningMemory: memory,
      confirmAction: vi.fn().mockResolvedValue(true)
    })
    await flush()
    // After the stop, docker reports jellyfin as exited.
    sessions[0].exec.mockImplementation(async (command: string) =>
      command === SNAPSHOT_COMMAND
        ? {
            stdout: snapshotOutput({
              docker: 'jellyfin|exited|||Exited (0) 2 seconds ago\njellyfin2|running|||Up 1 hour\n'
            }),
            stderr: '',
            code: 0
          }
        : { stdout: '', stderr: '', code: 0 }
    )
    await service.refresh()
    expect(service.status.services.find((s) => s.id === 'jellyfin')?.level).toBe('down')

    await service.containerAction('stop', 'jellyfin')
    expect(memory.names().has('jellyfin')).toBe(false)
    expect(service.status.services.find((s) => s.id === 'jellyfin')?.level).toBe('stopped')
    service.dispose()
  })

  it.each([
    ['an unknown action', 'rm', 'jellyfin'],
    ['an unlisted container', 'restart', 'not-a-container'],
    ['a malformed name', 'restart', 'a;b'],
    ['a name that starts like an option', 'restart', '--help'],
    ['a systemd unit', 'restart', 'tailscaled']
  ])('refuses %s without running anything', async (_label, action, container) => {
    const confirmAction = vi.fn().mockResolvedValue(true)
    const { service, sessions } = await start({ confirmAction })
    const result = await service.containerAction(action, container)
    expect(result).toMatchObject({ ok: false })
    expect(confirmAction).not.toHaveBeenCalled()
    expect(sessions[0].exec).not.toHaveBeenCalled()
    service.dispose()
  })

  it('refuses untrusted values of the wrong type', async () => {
    const { service, sessions } = await start({ confirmAction: vi.fn().mockResolvedValue(true) })
    for (const [action, container] of [
      [undefined, undefined],
      [{ evil: true }, 'jellyfin'],
      ['restart', 42],
      ['restart', { name: 'jellyfin' }]
    ]) {
      await expect(service.containerAction(action, container)).resolves.toMatchObject({ ok: false })
    }
    expect(sessions[0].exec).not.toHaveBeenCalled()
    service.dispose()
  })

  it('refuses before any data has been read', async () => {
    const { store, createConnector } = harness(DEFAULT_SETTINGS)
    const service = await createBentoService({
      store,
      createConnector,
      confirmAction: vi.fn().mockResolvedValue(true)
    })
    await expect(service.containerAction('restart', 'jellyfin')).resolves.toMatchObject({
      ok: false
    })
    service.dispose()
  })
})

describe('BentoService.openContainerPort', () => {
  const start = async (
    openExternal: Mock<(url: string) => Promise<void>> | undefined = vi
      .fn()
      .mockResolvedValue(undefined)
  ): Promise<{
    service: Awaited<ReturnType<typeof createBentoService>>
    open: typeof openExternal
  }> => {
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({ store, createConnector, openExternal })
    await flush()
    return { service, open: openExternal }
  }

  it('opens a port published by a listed container on the configured host', async () => {
    const { service, open } = await start()
    await expect(service.openContainerPort('jellyfin', 8096)).resolves.toEqual({ ok: true })
    expect(open).toHaveBeenCalledExactlyOnceWith('http://bento.ts.net:8096/')
    service.dispose()
  })

  it('opens the ports that a container behind vpn exposes on vpn', async () => {
    const { service, open } = await start()
    await service.openContainerPort('vpn', 8989)
    expect(open).toHaveBeenCalledExactlyOnceWith('http://bento.ts.net:8989/')
    service.dispose()
  })

  it('uses https for the https ports', async () => {
    const { service, open } = await start()
    await service.openContainerPort('docker-ui', 9443)
    expect(open).toHaveBeenCalledExactlyOnceWith('https://bento.ts.net:9443/')
    service.dispose()
  })

  it.each([
    ['an unknown container', 'nope', 8096],
    ['a port the container does not publish', 'jellyfin', 22],
    ['a port published by another container', 'jellyfin', 8989],
    ['an exposed but unpublished port', 'jellyfin', 8920],
    ['a udp port', 'game_container', 24454],
    ['a systemd unit', 'tailscaled', 22]
  ])('refuses %s', async (_label, container, port) => {
    const { service, open } = await start()
    const result = await service.openContainerPort(container, port)
    expect(result).toMatchObject({ ok: false })
    expect(open).not.toHaveBeenCalled()
    service.dispose()
  })

  it.each([
    [42, 8096],
    ['jellyfin', '8096'],
    ['jellyfin', 8096.5],
    [{ evil: true }, 8096],
    ['jellyfin', null],
    [undefined, undefined]
  ])('refuses untrusted values %j / %j', async (container, port) => {
    const { service, open } = await start()
    await expect(service.openContainerPort(container, port)).resolves.toMatchObject({ ok: false })
    expect(open).not.toHaveBeenCalled()
    service.dispose()
  })

  it('refuses before any data has been read', async () => {
    const { store, createConnector } = harness(DEFAULT_SETTINGS)
    const open = vi.fn()
    const service = await createBentoService({ store, createConnector, openExternal: open })
    await expect(service.openContainerPort('jellyfin', 8096)).resolves.toMatchObject({ ok: false })
    expect(open).not.toHaveBeenCalled()
    service.dispose()
  })

  it('is declined when nothing can open links', async () => {
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()
    await expect(service.openContainerPort('jellyfin', 8096)).resolves.toMatchObject({ ok: false })
    service.dispose()
  })

  it('reports a failure to open the browser as a normal result', async () => {
    const { service } = await start(vi.fn().mockRejectedValue(new Error('no browser')))
    await expect(service.openContainerPort('jellyfin', 8096)).resolves.toMatchObject({ ok: false })
    service.dispose()
  })
})

describe('BentoService.forgetContainer', () => {
  it('stops alerting for a container that was running and is now stopped', async () => {
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({
      store,
      createConnector,
      runningMemory: createRunningMemory(['stream'])
    })
    await flush()
    const level = (): string | undefined =>
      service.status.services.find((s) => s.id === 'stream')?.level
    expect(level()).toBe('down')

    service.forgetContainer('stream')
    expect(level()).toBe('stopped')
    service.dispose()
  })

  it('ignores untrusted values', async () => {
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()
    const before = service.status
    expect(() => service.forgetContainer({ evil: true })).not.toThrow()
    expect(() => service.forgetContainer(42)).not.toThrow()
    expect(service.status).toEqual(before)
    service.dispose()
  })
})

describe('BentoService.testConnection', () => {
  const draftOf = (host = 'other.ts.net'): Settings => ({
    ...DEFAULT_SETTINGS,
    host,
    hostFingerprint: FINGERPRINT
  })

  it('tries the draft with a connector of its own, and leaves the running connection alone', async () => {
    const { store, createConnector, sessions } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()
    const before = createConnector.mock.calls.length
    sessions[0].exec.mockClear()

    const promise = service.testConnection(draftOf())
    await flush()
    await expect(promise).resolves.toEqual({ ok: true })

    expect(createConnector.mock.calls.length).toBe(before + 1)
    expect(createConnector.mock.calls.at(-1)?.[0]).toMatchObject({ host: 'other.ts.net' })
    expect(sessions[0].exec).not.toHaveBeenCalled()
    expect(service.status.connection).toBe('online')
    expect(service.getSettings().host).toBe('bento.ts.net')
    service.dispose()
  })

  it('does not save the draft', async () => {
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()
    const promise = service.testConnection(draftOf())
    await flush()
    await promise
    expect(store.current().host).toBe('bento.ts.net')
    service.dispose()
  })

  it('refuses an invalid draft without opening anything', async () => {
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()
    const before = createConnector.mock.calls.length
    await expect(service.testConnection({ ...draftOf(), port: 0 })).resolves.toMatchObject({
      ok: false
    })
    await expect(service.testConnection('bento')).resolves.toMatchObject({ ok: false })
    expect(createConnector.mock.calls.length).toBe(before)
    service.dispose()
  })

  it('runs one test at a time', async () => {
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    await flush()
    const first = service.testConnection(draftOf())
    await expect(service.testConnection(draftOf())).resolves.toEqual({
      ok: false,
      message: 'Un test est déjà en cours.',
      technical: null
    })
    await flush()
    await expect(first).resolves.toEqual({ ok: true })
    const next = service.testConnection(draftOf())
    await flush()
    await expect(next).resolves.toEqual({ ok: true })
    service.dispose()
  })
})

describe('BentoService.getHistory', () => {
  const result = { range: '24h' as const, points: [], incidents: [], now: 1 }

  it('has no history without one, and says so rather than failing', async () => {
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({ store, createConnector })
    expect(service.getHistory('24h')).toBeNull()
    service.dispose()
  })

  it('feeds the history with every status the poller publishes', async () => {
    const history = { observe: vi.fn(), query: vi.fn().mockReturnValue(result) }
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({ store, createConnector, history })
    await flush()
    expect(history.observe).toHaveBeenCalled()
    const last = history.observe.mock.calls.at(-1)?.[0] as BentoStatus
    expect(last.connection).toBe('online')
    expect(last.metrics).not.toBeNull()
    service.dispose()
  })

  it('forwards the untrusted range to the history, which validates it', async () => {
    const history = { observe: vi.fn(), query: vi.fn().mockReturnValue(result) }
    const { store, createConnector } = harness(configured)
    const service = await createBentoService({ store, createConnector, history })
    expect(service.getHistory('24h')).toBe(result)
    expect(history.query).toHaveBeenCalledExactlyOnceWith('24h')
    service.getHistory({ evil: true })
    expect(history.query).toHaveBeenLastCalledWith({ evil: true })
    service.dispose()
  })
})
