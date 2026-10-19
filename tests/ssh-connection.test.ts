import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CommandNotAllowedError,
  ConnectionManager,
  NotConnectedError,
  type SshSession
} from '../src/main/ssh/connection'
import { SNAPSHOT_COMMAND } from '../src/main/monitors/snapshot'
import { containerActionCommand } from '../src/main/ssh/commands'
import type { ConnectionState } from '@shared/monitors'

const RESTART_COMMAND = containerActionCommand('restart', 'jellyfin')!

function fakeSession(): SshSession & { drop: () => void } {
  let closeListener: (() => void) | undefined
  return {
    exec: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', code: 0 }),
    close: vi.fn(),
    onClose: (listener) => {
      closeListener = listener
    },
    drop: () => closeListener?.()
  }
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

describe('ConnectionManager connecting', () => {
  it('goes offline -> connecting -> online and reports each change', async () => {
    const connector = vi.fn().mockResolvedValue(fakeSession())
    const manager = new ConnectionManager(connector)
    const seen: ConnectionState[] = []
    manager.onStateChange((state) => seen.push(state))

    expect(manager.state).toBe('offline')
    manager.start()
    expect(manager.state).toBe('connecting')
    await flush()

    expect(manager.state).toBe('online')
    expect(seen).toEqual(['connecting', 'online'])
  })

  it('does not connect twice when started twice', async () => {
    const connector = vi.fn().mockResolvedValue(fakeSession())
    const manager = new ConnectionManager(connector)
    manager.start()
    manager.start()
    await flush()
    expect(connector).toHaveBeenCalledTimes(1)
  })

  it('stops listening after unsubscribe', async () => {
    const manager = new ConnectionManager(vi.fn().mockResolvedValue(fakeSession()))
    const listener = vi.fn()
    const unsubscribe = manager.onStateChange(listener)
    unsubscribe()
    manager.start()
    await flush()
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('ConnectionManager failures', () => {
  it('stays offline with the error, then retries after one second', async () => {
    const connector = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue(fakeSession())
    const manager = new ConnectionManager(connector)
    manager.start()
    await flush()

    expect(manager.state).toBe('offline')
    expect(manager.lastError).toBe('timeout')
    expect(connector).toHaveBeenCalledTimes(1)

    await flush(999)
    expect(connector).toHaveBeenCalledTimes(1)
    await flush(1)
    expect(connector).toHaveBeenCalledTimes(2)
    expect(manager.state).toBe('online')
    expect(manager.lastError).toBeNull()
  })

  it('backs off exponentially instead of looping on errors', async () => {
    const connector = vi.fn().mockRejectedValue(new Error('unreachable'))
    const manager = new ConnectionManager(connector)
    manager.start()
    await flush() // t=0: attempt 1
    expect(connector).toHaveBeenCalledTimes(1)
    await flush(1000) // t=1000: attempt 2
    expect(connector).toHaveBeenCalledTimes(2)
    await flush(2000) // t=3000: attempt 3
    expect(connector).toHaveBeenCalledTimes(3)
    await flush(3999) // t=6999: still waiting for the 4 s delay
    expect(connector).toHaveBeenCalledTimes(3)
    await flush(1) // t=7000: attempt 4
    expect(connector).toHaveBeenCalledTimes(4)
  })

  it('stringifies non-Error rejections', async () => {
    const manager = new ConnectionManager(vi.fn().mockRejectedValue('boom'))
    manager.start()
    await flush()
    expect(manager.lastError).toBe('boom')
  })
})

describe('ConnectionManager lost connection', () => {
  it('goes offline when the session closes and reconnects after one second', async () => {
    const first = fakeSession()
    const second = fakeSession()
    const connector = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const manager = new ConnectionManager(connector)
    manager.start()
    await flush()
    expect(manager.state).toBe('online')

    first.drop()
    expect(manager.state).toBe('offline')
    await flush(1000)
    expect(connector).toHaveBeenCalledTimes(2)
    expect(manager.state).toBe('online')
  })

  it('resets the backoff after a successful connection', async () => {
    const session = fakeSession()
    const connector = vi
      .fn()
      .mockRejectedValueOnce(new Error('a'))
      .mockRejectedValueOnce(new Error('b'))
      .mockResolvedValueOnce(session)
      .mockResolvedValue(fakeSession())
    const manager = new ConnectionManager(connector)
    manager.start()
    await flush() // attempt 1 fails
    await flush(1000) // attempt 2 fails
    await flush(2000) // attempt 3 succeeds
    expect(manager.state).toBe('online')

    session.drop()
    await flush(1000) // back to a one second delay, not four
    expect(connector).toHaveBeenCalledTimes(4)
  })

  it('ignores a stale close event from a replaced session', async () => {
    const first = fakeSession()
    const connector = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(fakeSession())
    const manager = new ConnectionManager(connector)
    manager.start()
    await flush()
    first.drop()
    await flush(1000)
    expect(manager.state).toBe('online')

    first.drop()
    expect(manager.state).toBe('online')
  })
})

describe('ConnectionManager.run', () => {
  it('rejects with NotConnectedError while offline', async () => {
    const manager = new ConnectionManager(vi.fn().mockRejectedValue(new Error('down')))
    await expect(manager.run(SNAPSHOT_COMMAND)).rejects.toBeInstanceOf(NotConnectedError)
    manager.start()
    await flush()
    await expect(manager.run(SNAPSHOT_COMMAND)).rejects.toBeInstanceOf(NotConnectedError)
  })

  it('runs the command on the live session', async () => {
    const session = fakeSession()
    const manager = new ConnectionManager(vi.fn().mockResolvedValue(session))
    manager.start()
    await flush()

    await expect(manager.run(SNAPSHOT_COMMAND)).resolves.toEqual({
      stdout: 'ok',
      stderr: '',
      code: 0
    })
    expect(session.exec).toHaveBeenCalledExactlyOnceWith(SNAPSHOT_COMMAND)
  })
})

describe('ConnectionManager.stop', () => {
  it('closes the session, goes offline and stops retrying', async () => {
    const session = fakeSession()
    const connector = vi.fn().mockResolvedValue(session)
    const manager = new ConnectionManager(connector)
    manager.start()
    await flush()

    manager.stop()
    expect(session.close).toHaveBeenCalledTimes(1)
    expect(manager.state).toBe('offline')
    session.drop()
    await flush(120000)
    expect(connector).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending retry', async () => {
    const connector = vi.fn().mockRejectedValue(new Error('down'))
    const manager = new ConnectionManager(connector)
    manager.start()
    await flush()
    manager.stop()
    await flush(120000)
    expect(connector).toHaveBeenCalledTimes(1)
  })

  it('closes a session that finishes connecting after stop', async () => {
    const session = fakeSession()
    let resolve!: (s: SshSession) => void
    const connector = vi.fn().mockReturnValue(new Promise<SshSession>((r) => (resolve = r)))
    const manager = new ConnectionManager(connector)
    manager.start()
    manager.stop()
    resolve(session)
    await flush()

    expect(session.close).toHaveBeenCalledTimes(1)
    expect(manager.state).toBe('offline')
  })

  it('can be started again after a stop', async () => {
    const connector = vi.fn().mockResolvedValue(fakeSession())
    const manager = new ConnectionManager(connector)
    manager.start()
    await flush()
    manager.stop()
    manager.start()
    await flush()
    expect(connector).toHaveBeenCalledTimes(2)
    expect(manager.state).toBe('online')
  })
})

describe('ConnectionManager.replaceConnector', () => {
  it('drops the current session and reconnects through the new connector when running', async () => {
    const first = fakeSession()
    const second = fakeSession()
    const oldConnector = vi.fn().mockResolvedValue(first)
    const newConnector = vi.fn().mockResolvedValue(second)
    const manager = new ConnectionManager(oldConnector)
    manager.start()
    await flush()

    manager.replaceConnector(newConnector)
    await flush()

    expect(first.close).toHaveBeenCalledTimes(1)
    expect(oldConnector).toHaveBeenCalledTimes(1)
    expect(newConnector).toHaveBeenCalledTimes(1)
    expect(manager.state).toBe('online')
  })

  it('only swaps the connector while stopped, without connecting', async () => {
    const oldConnector = vi.fn().mockResolvedValue(fakeSession())
    const newConnector = vi.fn().mockResolvedValue(fakeSession())
    const manager = new ConnectionManager(oldConnector)

    manager.replaceConnector(newConnector)
    await flush()
    expect(newConnector).not.toHaveBeenCalled()

    manager.start()
    await flush()
    expect(oldConnector).not.toHaveBeenCalled()
    expect(newConnector).toHaveBeenCalledTimes(1)
  })

  it('restarts the backoff from the first delay', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('down'))
    const manager = new ConnectionManager(failing)
    manager.start()
    await flush() // attempt 1 fails
    await flush(1000) // attempt 2 fails, next delay is 2 s

    const working = vi.fn().mockResolvedValue(fakeSession())
    manager.replaceConnector(working)
    await flush()
    expect(working).toHaveBeenCalledTimes(1)
    expect(manager.state).toBe('online')
  })
})

describe('ConnectionManager allow-list', () => {
  it('runs allowed commands', async () => {
    const session = fakeSession()
    const manager = new ConnectionManager(vi.fn().mockResolvedValue(session))
    manager.start()
    await flush()

    await manager.run(SNAPSHOT_COMMAND)
    await manager.run(RESTART_COMMAND)
    expect(session.exec).toHaveBeenCalledTimes(2)
  })

  it('passes the per-call options to the session', async () => {
    const session = fakeSession()
    const manager = new ConnectionManager(vi.fn().mockResolvedValue(session))
    manager.start()
    await flush()

    await manager.run(RESTART_COMMAND, { timeoutMs: 100_000 })
    expect(session.exec).toHaveBeenCalledWith(RESTART_COMMAND, { timeoutMs: 100_000 })
  })

  it('rejects any other command before sending anything', async () => {
    const session = fakeSession()
    const manager = new ConnectionManager(vi.fn().mockResolvedValue(session))
    manager.start()
    await flush()

    await expect(manager.run('reboot')).rejects.toBeInstanceOf(CommandNotAllowedError)
    await expect(manager.run(`${SNAPSHOT_COMMAND}; reboot`)).rejects.toBeInstanceOf(
      CommandNotAllowedError
    )
    expect(session.exec).not.toHaveBeenCalled()
  })

  it('rejects a forbidden command even when offline', async () => {
    const manager = new ConnectionManager(vi.fn())
    await expect(manager.run('reboot')).rejects.toBeInstanceOf(CommandNotAllowedError)
  })
})
