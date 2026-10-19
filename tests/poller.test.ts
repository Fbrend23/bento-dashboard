import { readFileSync } from 'fs'
import { resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import type { BentoStatus, ConnectionState } from '@shared/monitors'
import { NotConnectedError, type ExecResult } from '../src/main/ssh/connection'
import { SNAPSHOT_COMMAND } from '../src/main/monitors/snapshot'
import {
  CPU_BASELINE_DELAY_MS,
  StatusPoller,
  type PollerConnection
} from '../src/main/monitors/poller'
import { createRunningMemory } from '../src/main/monitors/running-memory'
import { snapshotOutput } from './helpers/snapshot-output'

const FINGERPRINT = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

function makeSettings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, host: 'bento.ts.net', hostFingerprint: FINGERPRINT, ...overrides }
}

type FakeConnection = Omit<PollerConnection, 'run'> & {
  run: Mock
  set(next: ConnectionState, error?: string | null): void
  listenerCount(): number
}

function fakeConnection(initial: ConnectionState = 'online'): FakeConnection {
  let state = initial
  let lastError: string | null = null
  const listeners = new Set<(s: ConnectionState) => void>()
  return {
    get state() {
      return state
    },
    get lastError() {
      return lastError
    },
    run: vi.fn(),
    onStateChange(listener: (s: ConnectionState) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next: ConnectionState, error: string | null = null) {
      state = next
      lastError = error
      listeners.forEach((l) => l(next))
    },
    listenerCount: () => listeners.size
  }
}

const result = (stdout: string): ExecResult => ({ stdout, stderr: '', code: 0 })
const flush = async (ms = 0): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function setup(opts: { settings?: Partial<Settings>; state?: ConnectionState } = {}): {
  settings: Settings
  connection: FakeConnection
  poller: StatusPoller
} {
  const settings = makeSettings(opts.settings)
  const connection = fakeConnection(opts.state ?? 'online')
  connection.run.mockResolvedValue(result(snapshotOutput()))
  const poller = new StatusPoller({
    connection,
    getSettings: () => settings,
    now: () => 1700000000000
  })
  return { settings, connection, poller }
}

describe('StatusPoller initial status', () => {
  it('is unconfigured until host and fingerprint are set', () => {
    const connection = fakeConnection('offline')
    const poller = new StatusPoller({ connection, getSettings: () => DEFAULT_SETTINGS })
    expect(poller.status).toMatchObject({
      connection: 'offline',
      configured: false,
      overall: 'unconfigured',
      services: [],
      metrics: null,
      updatedAt: null
    })
  })

  it('is offline when configured but not connected', () => {
    const { poller } = setup({ state: 'offline' })
    expect(poller.status).toMatchObject({ configured: true, overall: 'offline' })
  })
})

describe('StatusPoller polling', () => {
  it('polls the fixed snapshot command as soon as the connection is online', async () => {
    const { poller, connection } = setup()
    poller.start()
    await flush()

    expect(connection.run).toHaveBeenCalledExactlyOnceWith(SNAPSHOT_COMMAND)
    const status = poller.status
    expect(status.overall).toBe('degraded') // homepage is unhealthy in the recording
    expect(status.updatedAt).toBe(1700000000000)
    expect(status.services).toHaveLength(27)
    expect(status.services.at(-1)?.id).toBe('tailscaled')
    expect(status.metrics?.uptimeSeconds).toBe(365415.79)
  })

  it('does nothing until the connection comes online, then polls immediately', async () => {
    const { poller, connection } = setup({ state: 'connecting' })
    poller.start()
    await flush(60000)
    expect(connection.run).not.toHaveBeenCalled()

    connection.set('online')
    await flush()
    expect(connection.run).toHaveBeenCalledTimes(1)
  })

  it('repeats every refresh interval', async () => {
    const { poller, connection } = setup()
    poller.start()
    await flush()
    await flush(CPU_BASELINE_DELAY_MS) // the quick second sample, see the cpu tests below
    expect(connection.run).toHaveBeenCalledTimes(2)
    await flush(29999)
    expect(connection.run).toHaveBeenCalledTimes(2)
    await flush(1)
    expect(connection.run).toHaveBeenCalledTimes(3)
    await flush(30000)
    expect(connection.run).toHaveBeenCalledTimes(4)
  })

  it('computes cpu usage from the second cycle on', async () => {
    const { poller, connection } = setup()
    connection.run
      .mockResolvedValueOnce(result(snapshotOutput()))
      .mockResolvedValueOnce(
        result(
          snapshotOutput({ stat: 'cpu  4754339 12576 1950953 266389589 405921 0 325091 0 0 0\n' })
        )
      )
    poller.start()
    await flush()
    expect(poller.status.metrics?.cpuPercent).toBeNull()

    await flush(30000)
    expect(poller.status.metrics?.cpuPercent).toBe(25)
  })

  it('leaves out the hidden containers', async () => {
    const { poller } = setup({ settings: { hiddenContainers: ['homepage'] } })
    poller.start()
    await flush()
    expect(poller.status.services.some((s) => s.id === 'homepage')).toBe(false)
    expect(poller.status.overall).toBe('ok')
  })
})

describe('StatusPoller running memory', () => {
  const exited = (name: string): string =>
    snapshotOutput({
      docker: `${name}|exited|||Exited (1) 3 seconds ago\nseries|running||media|Up 2 days\n`
    })
  const levelOf = (poller: StatusPoller, id: string): string | undefined =>
    poller.status.services.find((s) => s.id === id)?.level

  it('treats a container seen running that then stops as down', async () => {
    const { poller, connection } = setup()
    connection.run
      .mockResolvedValueOnce(result(snapshotOutput()))
      .mockResolvedValueOnce(result(exited('jellyfin')))
    poller.start()
    await flush()
    expect(levelOf(poller, 'jellyfin')).toBe('ok')

    await flush(30000)
    expect(levelOf(poller, 'jellyfin')).toBe('down')
    expect(poller.status.overall).toBe('down')
  })

  it('keeps a container that was already stopped when first seen neutral', async () => {
    const { poller } = setup()
    poller.start()
    await flush()
    expect(levelOf(poller, 'stream')).toBe('stopped')
  })

  it('does not forget anything when docker cannot be read', async () => {
    const { poller, connection } = setup()
    connection.run
      .mockResolvedValueOnce(result(snapshotOutput()))
      .mockResolvedValueOnce(result(snapshotOutput({ docker: 'sudo: a password is required\n' })))
      .mockResolvedValueOnce(result(exited('jellyfin')))
    poller.start()
    await flush()
    await flush(30000)
    expect(levelOf(poller, 'docker')).toBe('unknown')

    await flush(30000)
    expect(levelOf(poller, 'jellyfin')).toBe('down')
  })

  it('uses the memory it is given and keeps it up to date', async () => {
    const runningMemory = createRunningMemory(['stream'])
    const connection = fakeConnection('online')
    connection.run.mockResolvedValue(result(snapshotOutput()))
    const poller = new StatusPoller({
      connection,
      getSettings: () => makeSettings(),
      runningMemory
    })
    poller.start()
    await flush()
    expect(levelOf(poller, 'stream')).toBe('down')
    expect(runningMemory.names().has('jellyfin')).toBe(true)
  })

  it('republishes after a container is forgotten', async () => {
    const runningMemory = createRunningMemory(['stream'])
    const connection = fakeConnection('online')
    connection.run.mockResolvedValue(result(snapshotOutput()))
    const poller = new StatusPoller({
      connection,
      getSettings: () => makeSettings(),
      runningMemory
    })
    poller.start()
    await flush()
    poller.forgetContainer('stream')
    await flush()
    expect(levelOf(poller, 'stream')).toBe('stopped')
  })

  it('ignores a request to forget a name docker does not list', async () => {
    const { poller } = setup()
    poller.start()
    await flush()
    const before = poller.status
    poller.forgetContainer('rm -rf /')
    expect(poller.status).toEqual(before)
  })
})

describe('StatusPoller cpu baseline', () => {
  const second = (): string =>
    snapshotOutput({ stat: 'cpu  4754339 12576 1950953 266389589 405921 0 325091 0 0 0\n' })

  it('takes a second sample shortly after the first, so the cpu shows without a long wait', async () => {
    const { poller, connection } = setup()
    connection.run
      .mockResolvedValueOnce(result(snapshotOutput()))
      .mockResolvedValueOnce(result(second()))
    poller.start()
    await flush()
    expect(poller.status.metrics?.cpuPercent).toBeNull()

    await flush(CPU_BASELINE_DELAY_MS - 1)
    expect(connection.run).toHaveBeenCalledTimes(1)
    await flush(1)
    expect(connection.run).toHaveBeenCalledTimes(2)
    expect(poller.status.metrics?.cpuPercent).toBe(25)
  })

  it('goes back to the normal interval once the cpu is known', async () => {
    const { poller, connection } = setup()
    poller.start()
    await flush()
    await flush(CPU_BASELINE_DELAY_MS)
    expect(connection.run).toHaveBeenCalledTimes(2)
    await flush(29999)
    expect(connection.run).toHaveBeenCalledTimes(2)
    await flush(1)
    expect(connection.run).toHaveBeenCalledTimes(3)
  })

  it('does not hurry when the cpu line cannot be read', async () => {
    const { poller, connection } = setup()
    connection.run.mockResolvedValue(result(snapshotOutput({ stat: '' })))
    poller.start()
    await flush()
    await flush(CPU_BASELINE_DELAY_MS * 5)
    expect(connection.run).toHaveBeenCalledTimes(1)
    await flush(30000)
    expect(connection.run).toHaveBeenCalledTimes(2)
  })

  it('takes a new quick sample after a reconnection', async () => {
    const { poller, connection } = setup()
    poller.start()
    await flush()
    await flush(CPU_BASELINE_DELAY_MS)
    connection.run.mockClear()

    connection.set('offline')
    connection.set('online')
    await flush()
    expect(connection.run).toHaveBeenCalledTimes(1)
    await flush(CPU_BASELINE_DELAY_MS)
    expect(connection.run).toHaveBeenCalledTimes(2)
  })
})

describe('StatusPoller network rate', () => {
  // 20 000 more bytes received two seconds later, on the server clock.
  const later = (): string =>
    snapshotOutput({
      uptime: '365417.79 2829679.00\n',
      net: readFileSync(resolve('tests/fixtures/net-dev.txt'), 'utf-8').replace(
        '44015946651',
        '44015966651'
      )
    })

  it('has no rate on the first cycle and computes it on the second', async () => {
    const { poller, connection } = setup()
    connection.run
      .mockResolvedValueOnce(result(snapshotOutput()))
      .mockResolvedValueOnce(result(later()))
    poller.start()
    await flush()
    expect(poller.status.metrics?.network).toBeNull()

    await flush(CPU_BASELINE_DELAY_MS)
    expect(poller.status.metrics?.network).toEqual({ downBytesPerSec: 10000, upBytesPerSec: 0 })
  })

  it('starts again after a reconnection: counters of another session are not comparable', async () => {
    const { poller, connection } = setup()
    connection.run
      .mockResolvedValueOnce(result(snapshotOutput()))
      .mockResolvedValueOnce(result(later()))
      .mockResolvedValue(result(snapshotOutput()))
    poller.start()
    await flush()
    await flush(CPU_BASELINE_DELAY_MS)
    expect(poller.status.metrics?.network).not.toBeNull()

    connection.set('offline')
    connection.set('online')
    await flush()
    expect(poller.status.metrics?.network).toBeNull()
  })
})

describe('StatusPoller knowsContainer', () => {
  it('knows nothing before the first poll', () => {
    const { poller } = setup()
    expect(poller.knowsContainer('jellyfin')).toBe(false)
  })

  it('knows every container listed by the last readable poll, hidden ones included', async () => {
    const { poller } = setup({ settings: { hiddenContainers: ['homepage'] } })
    poller.start()
    await flush()
    expect(poller.knowsContainer('jellyfin')).toBe(true)
    expect(poller.knowsContainer('stream')).toBe(true)
    expect(poller.knowsContainer('homepage')).toBe(true)
  })

  it('does not know a container docker did not list, nor the systemd unit', async () => {
    const { poller } = setup()
    poller.start()
    await flush()
    expect(poller.knowsContainer('nope')).toBe(false)
    expect(poller.knowsContainer('tailscaled')).toBe(false)
    expect(poller.knowsContainer('')).toBe(false)
  })

  it('keeps the last list when docker cannot be read', async () => {
    const { poller, connection } = setup()
    connection.run
      .mockResolvedValueOnce(result(snapshotOutput()))
      .mockResolvedValue(result(snapshotOutput({ docker: 'sudo: a password is required' })))
    poller.start()
    await flush()
    await flush(CPU_BASELINE_DELAY_MS)
    expect(poller.knowsContainer('jellyfin')).toBe(true)
  })
})

describe('StatusPoller failures', () => {
  it('keeps the last data, records the error and retries only at the next interval', async () => {
    const { poller, connection } = setup()
    connection.run
      .mockResolvedValueOnce(result(snapshotOutput()))
      .mockRejectedValueOnce(new Error('Command timed out'))
      .mockResolvedValue(result(snapshotOutput()))
    poller.start()
    await flush()
    await flush(CPU_BASELINE_DELAY_MS) // the quick second cpu sample is the one that fails

    expect(poller.status.lastError).toBe('Command timed out')
    expect(poller.status.services).toHaveLength(27)
    expect(connection.run).toHaveBeenCalledTimes(2)

    await flush(29999)
    expect(connection.run).toHaveBeenCalledTimes(2)
    await flush(1)
    expect(connection.run).toHaveBeenCalledTimes(3)
    expect(poller.status.lastError).toBeNull()
  })

  it('ignores NotConnectedError and waits for the connection to come back', async () => {
    const { poller, connection } = setup()
    connection.run.mockRejectedValue(new NotConnectedError())
    poller.start()
    await flush(120000)

    expect(connection.run).toHaveBeenCalledTimes(1)
    expect(poller.status.lastError).toBeNull()
  })
})

describe('StatusPoller connection changes', () => {
  it('goes offline, keeps the last data and stops polling', async () => {
    const { poller, connection } = setup()
    poller.start()
    await flush()

    connection.set('offline', 'Connection closed')
    expect(poller.status).toMatchObject({
      connection: 'offline',
      overall: 'offline',
      lastError: 'Connection closed'
    })
    expect(poller.status.services).toHaveLength(27)

    await flush(120000)
    expect(connection.run).toHaveBeenCalledTimes(1)
  })

  it('polls again on reconnection with a fresh cpu baseline', async () => {
    const { poller, connection } = setup()
    poller.start()
    await flush()
    connection.set('offline')
    connection.set('online')
    await flush()

    expect(connection.run).toHaveBeenCalledTimes(2)
    expect(poller.status.metrics?.cpuPercent).toBeNull()
    expect(poller.status.overall).toBe('degraded') // homepage is unhealthy in the recording
  })
})

describe('StatusPoller refresh, reconfigure, stop', () => {
  it('refresh() polls immediately and coalesces concurrent calls', async () => {
    const { poller, connection } = setup()
    poller.start()
    await flush()
    connection.run.mockClear()

    let release!: (v: ReturnType<typeof result>) => void
    connection.run.mockReturnValue(new Promise((r) => (release = r)))
    const a = poller.refresh()
    const b = poller.refresh()
    release(result(snapshotOutput()))
    await Promise.all([a, b])

    expect(connection.run).toHaveBeenCalledTimes(1)
  })

  it('reconfigure() applies new settings, polls now and uses the new interval', async () => {
    const { poller, connection, settings } = setup()
    poller.start()
    await flush()

    settings.refreshIntervalSec = 60
    poller.reconfigure()
    await flush()
    expect(connection.run).toHaveBeenCalledTimes(2)

    await flush(59999)
    expect(connection.run).toHaveBeenCalledTimes(2)
    await flush(1)
    expect(connection.run).toHaveBeenCalledTimes(3)
  })

  it('reconfigure() updates the configured flag without a connection', () => {
    const connection = fakeConnection('offline')
    let settings = DEFAULT_SETTINGS
    const poller = new StatusPoller({ connection, getSettings: () => settings })
    expect(poller.status.overall).toBe('unconfigured')

    settings = makeSettings()
    poller.reconfigure()
    expect(poller.status).toMatchObject({ configured: true, overall: 'offline' })
  })

  it('notifies status listeners until they unsubscribe', async () => {
    const { poller, connection } = setup()
    const seen: BentoStatus[] = []
    const unsubscribe = poller.onStatus((s) => seen.push(s))
    poller.start()
    await flush()
    expect(seen.at(-1)).toEqual(poller.status)

    unsubscribe()
    const count = seen.length
    connection.set('offline')
    expect(seen).toHaveLength(count)
  })

  it('stop() ends polling and unsubscribes from the connection', async () => {
    const { poller, connection } = setup()
    poller.start()
    await flush()
    poller.stop()

    expect(connection.listenerCount()).toBe(0)
    await flush(120000)
    expect(connection.run).toHaveBeenCalledTimes(1)
  })

  it('ignores a poll result that arrives after stop()', async () => {
    const { poller, connection } = setup()
    let release!: (v: ReturnType<typeof result>) => void
    connection.run.mockReturnValue(new Promise((r) => (release = r)))
    poller.start()
    poller.stop()
    release(result(snapshotOutput()))
    await flush()

    expect(poller.status.services).toEqual([])
  })
})
