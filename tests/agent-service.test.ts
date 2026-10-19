import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ExecResult } from '../src/main/ssh/connection'
import { containerActionCommand } from '../src/main/ssh/commands'
import { SNAPSHOT_COMMAND } from '../src/main/monitors/snapshot'
import { CommandNotAllowedError } from '../src/main/ssh/connection'
import { isAgentCommand } from '../src/agent/commands'
import { createAgentService, guardExec, type AgentService, type Exec } from '../src/agent/service'
import { snapshotOutput } from './helpers/snapshot-output'

const NOW = 1_700_000_000_000

let run: Mock<Exec>
let clock: number
let service: AgentService

function build(overrides: Partial<Parameters<typeof createAgentService>[0]> = {}): void {
  service = createAgentService({
    exec: run,
    labels: { containerLabels: { jellyfin: 'Media server' }, stackLabels: { media: 'Médias' } },
    hiddenContainers: [],
    now: () => clock,
    cacheMs: 5000,
    ...overrides
  })
}

beforeEach(() => {
  clock = NOW
  run = vi.fn<Exec>(async (command: string) =>
    command === SNAPSHOT_COMMAND
      ? { stdout: snapshotOutput(), stderr: '', code: 0 }
      : { stdout: '', stderr: '', code: 0 }
  )
  build()
})

describe('getStatus', () => {
  it('builds the services from the snapshot, with labels from the config', async () => {
    const status = await service.getStatus()
    expect(status.updatedAt).toBe(NOW)
    expect(status.stackLabels).toEqual({ media: 'Médias' })
    const jellyfin = status.services.find((s) => s.id === 'jellyfin')
    expect(jellyfin).toMatchObject({ label: 'Media server', state: 'running', project: 'media' })
    expect(status.services.at(-1)).toMatchObject({ id: 'tailscaled', kind: 'systemd' })
  })

  it('sends the system figures read by the same snapshot', async () => {
    const { metrics } = await service.getStatus()
    expect(metrics.memoryUsedPercent).not.toBeNull()
    expect(metrics.uptimeSeconds).not.toBeNull()
    expect(metrics.load).not.toBeNull()
    expect(metrics.disks.length).toBeGreaterThan(0)
    // No earlier sample on the first read: the processor load is not known yet.
    expect(metrics.cpuPercent).toBeNull()
  })

  it('keeps the processor sample between reads to compute its load', async () => {
    await service.getStatus()
    clock += 6000
    run.mockResolvedValueOnce({
      stdout: snapshotOutput({
        stat: 'cpu  4754239 12576 1951953 266389789 405921 0 325091 0 0 0\n'
      }),
      stderr: '',
      code: 0
    })
    const { metrics } = await service.getStatus()
    // 1000 busy ticks and 500 idle ticks since the first read.
    expect(metrics.cpuPercent).toBeCloseTo(66.7, 0)
  })

  it('never sends published ports to the phone', async () => {
    const status = await service.getStatus()
    expect(status.services.every((s) => s.ports.length === 0)).toBe(true)
  })

  it('leaves out hidden containers', async () => {
    build({ hiddenContainers: ['jellyfin'] })
    const status = await service.getStatus()
    expect(status.services.some((s) => s.id === 'jellyfin')).toBe(false)
  })

  it('only ever runs the snapshot', async () => {
    await service.getStatus()
    expect(run.mock.calls.map((call) => call[0])).toEqual([SNAPSHOT_COMMAND])
  })

  it('reuses the last snapshot for a few seconds, then reads again', async () => {
    await service.getStatus()
    clock += 4000
    await service.getStatus()
    expect(run).toHaveBeenCalledTimes(1)
    clock += 2000
    await service.getStatus()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('shares one snapshot between simultaneous requests', async () => {
    await Promise.all([service.getStatus(), service.getStatus(), service.getStatus()])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('rejects, and retries next time, when bento cannot be read', async () => {
    run.mockRejectedValueOnce(new Error('Command timed out after 20000 ms'))
    await expect(service.getStatus()).rejects.toThrow(/timed out/)
    await expect(service.getStatus()).resolves.toMatchObject({ updatedAt: NOW })
  })
})

describe('runAction', () => {
  it('runs the fixed command of a listed container and reports success', async () => {
    await service.getStatus()
    await expect(service.runAction('restart', 'jellyfin')).resolves.toEqual({ ok: true })
    expect(run.mock.calls.map((call) => call[0])).toContain(
      containerActionCommand('restart', 'jellyfin')
    )
  })

  it('reads the list itself when no status was asked for yet', async () => {
    await expect(service.runAction('start', 'jellyfin')).resolves.toEqual({ ok: true })
  })

  it('reads again after an action, ignoring the cache', async () => {
    await service.getStatus()
    await service.runAction('restart', 'jellyfin')
    expect(run.mock.calls.filter((call) => call[0] === SNAPSHOT_COMMAND)).toHaveLength(2)
  })

  it('does not alert for a container stopped on purpose', async () => {
    await service.getStatus()
    run.mockImplementation(async (command: string) =>
      command === SNAPSHOT_COMMAND
        ? {
            stdout: snapshotOutput({ docker: 'jellyfin|exited||media|Exited (0) 1 second ago\n' }),
            stderr: '',
            code: 0
          }
        : { stdout: '', stderr: '', code: 0 }
    )
    await service.runAction('stop', 'jellyfin')
    const status = await service.getStatus()
    expect(status.services.find((s) => s.id === 'jellyfin')?.level).toBe('stopped')
  })

  it.each([
    ['rm', 'jellyfin'],
    ['restart', 'unknown-container'],
    ['restart', 'jellyfin; reboot'],
    ['restart', '--all'],
    [undefined, undefined]
  ])('refuses %j on %j without running anything', async (action, container) => {
    await service.getStatus()
    run.mockClear()
    const result = await service.runAction(action, container)
    expect(result.ok).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('explains a failure in French', async () => {
    await service.getStatus()
    run.mockImplementation(async (command: string) =>
      command === SNAPSHOT_COMMAND
        ? { stdout: snapshotOutput(), stderr: '', code: 0 }
        : { stdout: '', stderr: '', code: 65 }
    )
    await expect(service.runAction('restart', 'jellyfin')).resolves.toEqual({
      ok: false,
      error: 'Conteneur introuvable sur bento.'
    })
  })

  it('refuses a second action while one is running', async () => {
    await service.getStatus()
    let release: () => void = () => {}
    run.mockImplementation(
      (command: string) =>
        new Promise<ExecResult>((resolve) => {
          const done = (): void =>
            resolve({
              stdout: command === SNAPSHOT_COMMAND ? snapshotOutput() : '',
              stderr: '',
              code: 0
            })
          if (command === SNAPSHOT_COMMAND) done()
          else release = done
        })
    )
    const first = service.runAction('restart', 'jellyfin')
    await new Promise((resolve) => setImmediate(resolve))
    await expect(service.runAction('stop', 'jellyfin')).resolves.toEqual({
      ok: false,
      error: 'Une action est déjà en cours.'
    })
    release()
    await expect(first).resolves.toEqual({ ok: true })
  })
})

describe('guardExec', () => {
  it('refuses any command outside the agent allow-list before it reaches exec', async () => {
    const guarded = guardExec(run)
    for (const command of ['reboot', 'true', `${SNAPSHOT_COMMAND}; reboot`]) {
      await expect(guarded(command)).rejects.toBeInstanceOf(CommandNotAllowedError)
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('passes the allowed commands and their options through', async () => {
    const guarded = guardExec(run)
    await guarded(SNAPSHOT_COMMAND)
    await guarded(containerActionCommand('stop', 'jellyfin')!, { timeoutMs: 100 })
    expect(run).toHaveBeenNthCalledWith(1, SNAPSHOT_COMMAND, undefined)
    expect(run).toHaveBeenNthCalledWith(2, containerActionCommand('stop', 'jellyfin'), {
      timeoutMs: 100
    })
  })

  it('is applied to everything the service runs', async () => {
    // A service wired to a spy never sees a command the guard would refuse.
    await service.getStatus()
    await service.runAction('restart', 'jellyfin')
    for (const [command] of run.mock.calls) {
      expect(isAgentCommand(command as string)).toBe(true)
    }
  })
})
