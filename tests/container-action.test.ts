import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTION_EXEC_TIMEOUT_MS,
  ACTION_QUIET_MS,
  describeActionFailure,
  runContainerAction,
  type ContainerActionDeps
} from '../src/main/actions/container-action'
import { CONTAINER_ACTION_TIMEOUT_S, containerActionCommand } from '../src/main/ssh/commands'
import { NotConnectedError } from '../src/main/ssh/connection'

let deps: ContainerActionDeps

beforeEach(() => {
  deps = {
    isOnline: vi.fn().mockReturnValue(true),
    knows: vi.fn().mockReturnValue(true),
    confirm: vi.fn().mockResolvedValue(true),
    run: vi.fn().mockResolvedValue({ stdout: 'jellyfin\n', stderr: '', code: 0 }),
    refresh: vi.fn().mockResolvedValue(undefined),
    quiet: vi.fn(),
    forget: vi.fn()
  }
})

const order = (fn: unknown): number => vi.mocked(fn as () => void).mock.invocationCallOrder[0]

describe('runContainerAction (what runs)', () => {
  it.each(['start', 'stop', 'restart'] as const)(
    'runs the fixed %s command for the container, then refreshes',
    async (action) => {
      await expect(runContainerAction(deps, action, 'jellyfin')).resolves.toEqual({ ok: true })
      expect(deps.run).toHaveBeenCalledExactlyOnceWith(containerActionCommand(action, 'jellyfin'), {
        timeoutMs: ACTION_EXEC_TIMEOUT_MS
      })
      expect(deps.refresh).toHaveBeenCalledOnce()
    }
  )

  it('works on any container the last poll listed, not only jellyfin', async () => {
    await runContainerAction(deps, 'restart', 'proxy-app-1')
    expect(deps.knows).toHaveBeenCalledWith('proxy-app-1')
    expect(vi.mocked(deps.run).mock.calls[0][0]).toBe(
      containerActionCommand('restart', 'proxy-app-1')
    )
  })

  it('keeps the client timeout above the remote one so the remote timeout answers first', () => {
    expect(ACTION_EXEC_TIMEOUT_MS).toBeGreaterThan(CONTAINER_ACTION_TIMEOUT_S * 1000)
    expect(ACTION_QUIET_MS).toBeGreaterThan(CONTAINER_ACTION_TIMEOUT_S * 1000)
  })
})

describe('runContainerAction (untrusted input)', () => {
  it.each([
    ['rm', 'jellyfin'],
    ['Restart', 'jellyfin'],
    [undefined, 'jellyfin'],
    [{ evil: true }, 'jellyfin']
  ])('refuses the action %j without asking or running anything', async (action, container) => {
    const result = await runContainerAction(deps, action, container)
    expect(result).toEqual({ ok: false, error: 'Action inconnue.' })
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it.each(['', '-rf', '--help', 'a b', 'a;b', '$(id)', 'a/b', 'x'.repeat(129), 42, null, {}])(
    'refuses the container %j without asking or running anything',
    async (container) => {
      const result = await runContainerAction(deps, 'restart', container)
      expect(result).toEqual({ ok: false, error: 'Conteneur inconnu.' })
      expect(deps.confirm).not.toHaveBeenCalled()
      expect(deps.run).not.toHaveBeenCalled()
    }
  )

  it('refuses a well-formed name that the last poll did not list', async () => {
    vi.mocked(deps.knows).mockReturnValue(false)
    await expect(runContainerAction(deps, 'stop', 'nope')).resolves.toEqual({
      ok: false,
      error: 'Conteneur inconnu.'
    })
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('refuses without asking when bento is offline', async () => {
    vi.mocked(deps.isOnline).mockReturnValue(false)
    await expect(runContainerAction(deps, 'restart', 'jellyfin')).resolves.toEqual({
      ok: false,
      error: 'Bento est injoignable.'
    })
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.run).not.toHaveBeenCalled()
  })
})

describe('runContainerAction (confirmation)', () => {
  it('asks before stopping and before restarting, naming the action and the container', async () => {
    await runContainerAction(deps, 'stop', 'jellyfin')
    await runContainerAction(deps, 'restart', 'series')
    expect(deps.confirm).toHaveBeenNthCalledWith(1, 'stop', 'jellyfin')
    expect(deps.confirm).toHaveBeenNthCalledWith(2, 'restart', 'series')
  })

  it('does not ask before starting', async () => {
    await runContainerAction(deps, 'start', 'jellyfin')
    expect(deps.confirm).not.toHaveBeenCalled()
    expect(deps.run).toHaveBeenCalledOnce()
  })

  it.each(['stop', 'restart'] as const)(
    'does nothing at all when %s is cancelled',
    async (action) => {
      vi.mocked(deps.confirm).mockResolvedValue(false)
      await expect(runContainerAction(deps, action, 'jellyfin')).resolves.toEqual({
        ok: false,
        cancelled: true
      })
      expect(deps.run).not.toHaveBeenCalled()
      expect(deps.quiet).not.toHaveBeenCalled()
      expect(deps.forget).not.toHaveBeenCalled()
      expect(deps.refresh).not.toHaveBeenCalled()
    }
  )
})

describe('runContainerAction (notifications and memory)', () => {
  it.each(['stop', 'restart'] as const)(
    'silences the "down" notification of that container before running %s',
    async (action) => {
      await runContainerAction(deps, action, 'series')
      expect(deps.quiet).toHaveBeenCalledExactlyOnceWith('series', ACTION_QUIET_MS)
      expect(order(deps.quiet)).toBeLessThan(order(deps.run))
    }
  )

  it('does not silence anything for a start', async () => {
    await runContainerAction(deps, 'start', 'series')
    expect(deps.quiet).not.toHaveBeenCalled()
  })

  it('forgets a container once it was stopped on purpose, before the next refresh', async () => {
    await runContainerAction(deps, 'stop', 'series')
    expect(deps.forget).toHaveBeenCalledExactlyOnceWith('series')
    expect(order(deps.forget)).toBeGreaterThan(order(deps.run))
    expect(order(deps.forget)).toBeLessThan(order(deps.refresh))
  })

  it('keeps remembering a container that is restarted or started', async () => {
    await runContainerAction(deps, 'restart', 'series')
    await runContainerAction(deps, 'start', 'series')
    expect(deps.forget).not.toHaveBeenCalled()
  })

  it('does not forget a container whose stop failed', async () => {
    vi.mocked(deps.run).mockResolvedValue({ stdout: '', stderr: 'boom', code: 1 })
    await runContainerAction(deps, 'stop', 'series')
    expect(deps.forget).not.toHaveBeenCalled()
  })

  it('does not forget a container when the connection is lost during the stop', async () => {
    vi.mocked(deps.run).mockRejectedValue(new NotConnectedError())
    await runContainerAction(deps, 'stop', 'series')
    expect(deps.forget).not.toHaveBeenCalled()
  })
})

describe('runContainerAction (one at a time)', () => {
  it('refuses a second action while one is running', async () => {
    let release: (value: { stdout: string; stderr: string; code: number }) => void = () => {}
    vi.mocked(deps.run).mockReturnValue(new Promise((resolve) => (release = resolve)))

    const first = runContainerAction(deps, 'restart', 'jellyfin')
    await vi.waitFor(() => expect(deps.run).toHaveBeenCalled())
    const second = await runContainerAction(deps, 'stop', 'series')
    expect(second).toEqual({ ok: false, error: 'Une action est déjà en cours.' })
    expect(deps.confirm).toHaveBeenCalledOnce()

    release({ stdout: '', stderr: '', code: 0 })
    await expect(first).resolves.toEqual({ ok: true })
  })

  it('allows a new action once the previous one has ended', async () => {
    await runContainerAction(deps, 'restart', 'jellyfin')
    await expect(runContainerAction(deps, 'start', 'series')).resolves.toEqual({ ok: true })
    expect(deps.run).toHaveBeenCalledTimes(2)
  })

  it('also refuses a second request while the confirmation box is open', async () => {
    let answer: (value: boolean) => void = () => {}
    vi.mocked(deps.confirm).mockReturnValue(new Promise((resolve) => (answer = resolve)))

    const first = runContainerAction(deps, 'stop', 'jellyfin')
    const second = await runContainerAction(deps, 'restart', 'series')
    expect(second).toEqual({ ok: false, error: 'Une action est déjà en cours.' })

    answer(false)
    await expect(first).resolves.toEqual({ ok: false, cancelled: true })
  })

  it('is free again after a refusal for bad input', async () => {
    await runContainerAction(deps, 'rm', 'jellyfin')
    await expect(runContainerAction(deps, 'start', 'jellyfin')).resolves.toEqual({ ok: true })
  })
})

describe('runContainerAction (failures)', () => {
  it('reports a failed command in French and still refreshes', async () => {
    vi.mocked(deps.run).mockResolvedValue({
      stdout: '',
      stderr: 'sudo: a password is required',
      code: 1
    })
    await expect(runContainerAction(deps, 'restart', 'jellyfin')).resolves.toEqual({
      ok: false,
      error: 'Règle sudoers manquante pour bento-dash.'
    })
    expect(deps.refresh).toHaveBeenCalledOnce()
  })

  it('reports a connection lost during the action without throwing', async () => {
    vi.mocked(deps.run).mockRejectedValue(new NotConnectedError())
    await expect(runContainerAction(deps, 'restart', 'jellyfin')).resolves.toEqual({
      ok: false,
      error: 'Bento est injoignable.'
    })
  })

  it('never leaks a raw error message, and names the action in the fallback', async () => {
    vi.mocked(deps.run).mockRejectedValue(new Error('Command timed out after 100000 ms'))
    await expect(runContainerAction(deps, 'restart', 'jellyfin')).resolves.toEqual({
      ok: false,
      error: 'Bento a mis trop de temps à répondre.'
    })
    vi.mocked(deps.run).mockRejectedValue(new Error('something internal'))
    await expect(runContainerAction(deps, 'start', 'jellyfin')).resolves.toEqual({
      ok: false,
      error: 'Le démarrage a échoué.'
    })
    await expect(runContainerAction(deps, 'stop', 'jellyfin')).resolves.toEqual({
      ok: false,
      error: "L'arrêt a échoué."
    })
    await expect(runContainerAction(deps, 'restart', 'jellyfin')).resolves.toEqual({
      ok: false,
      error: 'Le redémarrage a échoué.'
    })
  })

  it('does not fail when the refresh itself fails', async () => {
    vi.mocked(deps.refresh).mockRejectedValue(new Error('offline'))
    await expect(runContainerAction(deps, 'start', 'jellyfin')).resolves.toEqual({ ok: true })
  })
})

describe('describeActionFailure', () => {
  const failure = (
    code: number | null,
    stderr = ''
  ): Parameters<typeof describeActionFailure>[0] => ({
    stdout: '',
    stderr,
    code
  })

  it('translates the exit codes of the script on bento', () => {
    expect(describeActionFailure(failure(64))).toBe('Action refusée par bento.')
    expect(describeActionFailure(failure(65))).toBe('Conteneur introuvable sur bento.')
    expect(describeActionFailure(failure(66))).toBe('Docker est indisponible sur bento.')
  })

  it('falls back to the generic messages', () => {
    expect(describeActionFailure(failure(1, 'sudo: a password is required'))).toBe(
      'Règle sudoers manquante pour bento-dash.'
    )
    expect(describeActionFailure(failure(124))).toBe('Bento a mis trop de temps à répondre.')
    expect(describeActionFailure(failure(2))).toBe('La commande a échoué (code 2).')
  })

  it('never includes what the script or docker printed', () => {
    expect(describeActionFailure(failure(65, 'unknown container'))).not.toContain('unknown')
  })
})
