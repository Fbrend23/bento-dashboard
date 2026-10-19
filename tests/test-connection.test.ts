import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { testConnection } from '../src/main/ssh/test-connection'
import { TEST_CONNECTION_COMMAND, isAllowedCommand } from '../src/main/ssh/commands'
import type { Connector, SshSession } from '../src/main/ssh/connection'
import type { SshConfig } from '../src/main/ssh/ssh2-connector'

const FINGERPRINT = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const draft = { ...DEFAULT_SETTINGS, host: 'bento.example.ts.net', hostFingerprint: FINGERPRINT }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function fakeSession(
  exec: Mock = vi.fn().mockResolvedValue({ stdout: '', stderr: '', code: 0 })
): SshSession & { exec: Mock; close: Mock } {
  return { exec, close: vi.fn(), onClose: () => {} }
}

function harness(connector: Connector): {
  createConnector: ReturnType<typeof vi.fn<(config: SshConfig) => Connector>>
  connector: ReturnType<typeof vi.fn>
} {
  const wrapped = vi.fn(connector)
  const createConnector = vi.fn((): Connector => wrapped)
  return { createConnector, connector: wrapped }
}

const run = async (
  input: unknown,
  deps: { createConnector: (config: SshConfig) => Connector },
  timeoutMs?: number
): Promise<Awaited<ReturnType<typeof testConnection>>> => {
  const promise = testConnection(input, { ...deps, timeoutMs })
  await vi.advanceTimersByTimeAsync(0)
  return promise
}

describe('TEST_CONNECTION_COMMAND', () => {
  it('is a fixed no-op that the allow-list accepts', () => {
    expect(TEST_CONNECTION_COMMAND).toBe('true')
    expect(isAllowedCommand(TEST_CONNECTION_COMMAND)).toBe(true)
  })
})

describe('testConnection (success)', () => {
  it('connects with the agent, runs the fixed command and closes', async () => {
    const session = fakeSession()
    const { createConnector } = harness(async () => session)
    await expect(run(draft, { createConnector })).resolves.toEqual({ ok: true })

    expect(createConnector).toHaveBeenCalledExactlyOnceWith({
      host: 'bento.example.ts.net',
      port: 22,
      username: 'bento-dash',
      hostFingerprint: FINGERPRINT,
      auth: { kind: 'agent' }
    })
    expect(session.exec).toHaveBeenCalledExactlyOnceWith(TEST_CONNECTION_COMMAND)
    expect(session.close).toHaveBeenCalled()
  })

  it('tests the values it was given, not the saved ones', async () => {
    const { createConnector } = harness(async () => fakeSession())
    await run({ ...draft, host: 'other.example.ts.net', port: 2222 }, { createConnector })
    expect(createConnector.mock.calls[0][0]).toMatchObject({
      host: 'other.example.ts.net',
      port: 2222
    })
  })
})

describe('testConnection (invalid draft)', () => {
  it.each([
    ['no host', { ...draft, host: '' }, "l'hôte et l'empreinte"],
    ['no fingerprint', { ...draft, hostFingerprint: '' }, "l'hôte et l'empreinte"],
    ['a bad fingerprint', { ...draft, hostFingerprint: 'SHA256:short' }, 'Empreinte invalide'],
    [
      'a host that looks like an option',
      { ...draft, host: '-oProxyCommand=calc' },
      'Hôte invalide'
    ],
    ['a bad port', { ...draft, port: 0 }, 'entier'],
    ['a bad user name', { ...draft, username: 'root;ls' }, "Nom d'utilisateur invalide"]
  ])('refuses %s without opening any connection', async (_label, input, expected) => {
    const { createConnector, connector } = harness(async () => fakeSession())
    const result = await run(input, { createConnector })
    expect(result).toMatchObject({ ok: false })
    expect((result as { message: string }).message).toContain(expected)
    expect(createConnector).not.toHaveBeenCalled()
    expect(connector).not.toHaveBeenCalled()
  })

  it.each([null, undefined, 'bento', 42, []])('refuses the input %j', async (input) => {
    const { createConnector } = harness(async () => fakeSession())
    await expect(run(input, { createConnector })).resolves.toMatchObject({ ok: false })
    expect(createConnector).not.toHaveBeenCalled()
  })
})

describe('testConnection (failures)', () => {
  it.each([
    ['Host denied (verification failed)', "L'empreinte du serveur ne correspond pas"],
    ['All configured authentication methods failed', 'a refusé la clé'],
    ['connect ECONNREFUSED 192.0.2.7:22', 'Connexion refusée'],
    ['getaddrinfo ENOTFOUND nowhere.example', "nom de l'hôte est introuvable"],
    ['connect EHOSTUNREACH 192.0.2.7:22', 'bento ne répond pas']
  ])('explains "%s"', async (raw, expected) => {
    const { createConnector } = harness(async () => {
      throw new Error(raw)
    })
    const result = await run(draft, { createConnector })
    expect(result).toMatchObject({ ok: false, technical: raw })
    expect((result as { message: string }).message).toContain(expected)
  })

  it('says so plainly when the cause is not a known one, keeping the raw text apart', async () => {
    const { createConnector } = harness(async () => {
      throw new Error('something odd')
    })
    await expect(run(draft, { createConnector })).resolves.toEqual({
      ok: false,
      message: 'La connexion a échoué.',
      technical: 'something odd'
    })
  })

  it('does not put the raw message, which may hold an address, in the main message', async () => {
    const { createConnector } = harness(async () => {
      throw new Error('connect EHOSTUNREACH 192.0.2.7:22')
    })
    const result = (await run(draft, { createConnector })) as { message: string }
    expect(result.message).not.toContain('192.0.2.7')
  })

  it('does not retry on its own after a failure', async () => {
    const { createConnector, connector } = harness(async () => {
      throw new Error('connect ECONNREFUSED 192.0.2.7:22')
    })
    await run(draft, { createConnector })
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(connector).toHaveBeenCalledTimes(1)
  })

  it('gives up with an explanation when the server never answers', async () => {
    const { createConnector } = harness(() => new Promise<SshSession>(() => {}))
    const promise = testConnection(draft, { createConnector, timeoutMs: 5000 })
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise
    expect(result).toMatchObject({ ok: false })
    expect((result as { message: string }).message).toContain('bento ne répond pas')
  })

  it('reports a command that fails after the connection worked, and still closes', async () => {
    const session = fakeSession(vi.fn().mockResolvedValue({ stdout: '', stderr: 'no', code: 1 }))
    const { createConnector } = harness(async () => session)
    const result = await run(draft, { createConnector })
    expect(result).toMatchObject({ ok: false })
    expect((result as { message: string }).message).toContain('connexion fonctionne')
    expect(session.close).toHaveBeenCalled()
  })

  it('reports a command that throws, and still closes', async () => {
    const session = fakeSession(
      vi.fn().mockRejectedValue(new Error('Command timed out after 20000 ms'))
    )
    const { createConnector } = harness(async () => session)
    const result = await run(draft, { createConnector })
    expect(result).toMatchObject({ ok: false, technical: 'Command timed out after 20000 ms' })
    expect(session.close).toHaveBeenCalled()
  })
})
