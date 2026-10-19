import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Server, utils, type Connection } from 'ssh2'
import { createSsh2Connector, type SshConfig } from '../src/main/ssh/ssh2-connector'
import { fingerprintOf } from '../src/main/ssh/hostkey'
import type { SshSession } from '../src/main/ssh/connection'

// Integration tests against an in-process SSH server (no network, no bento).

const hostKey = utils.generateKeyPairSync('ed25519')
const clientKey = utils.generateKeyPairSync('ed25519')

function publicBlob(publicKey: string): Buffer {
  const parsed = utils.parseKey(publicKey)
  if (parsed instanceof Error) throw parsed
  return (Array.isArray(parsed) ? parsed[0] : parsed).getPublicSSH()
}

const hostFingerprint = fingerprintOf(publicBlob(hostKey.public))

let server: Server
let port = 0
const clients: Connection[] = []
const sessions: SshSession[] = []

beforeAll(async () => {
  server = new Server({ hostKeys: [hostKey.private] }, (client) => {
    clients.push(client)
    client.on('authentication', (ctx) => {
      if (ctx.method === 'publickey' && ctx.username === 'bento-dash') ctx.accept()
      else ctx.reject(['publickey'])
    })
    client.on('error', () => {})
    client.on('ready', () => {
      client.on('session', (accept) => {
        accept().on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec()
          if (info.command === 'echo hi') {
            stream.write('hi\n')
            stream.exit(0)
            stream.end()
          } else if (info.command === 'fail') {
            stream.stderr.write('bad\n')
            stream.exit(3)
            stream.end()
          } else if (info.command === 'slow') {
            setTimeout(() => {
              stream.write('late\n')
              stream.exit(0)
              stream.end()
            }, 500)
          }
          // any other command ("hang") never answers
        })
      })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  port = typeof address === 'object' && address ? address.port : 0
})

afterEach(() => {
  for (const session of sessions.splice(0)) session.close()
  clients.splice(0)
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

function config(overrides: Partial<SshConfig> = {}): SshConfig {
  return {
    host: '127.0.0.1',
    port,
    username: 'bento-dash',
    hostFingerprint,
    auth: { kind: 'key', privateKey: clientKey.private },
    connectTimeoutMs: 3000,
    execTimeoutMs: 300,
    ...overrides
  }
}

async function connect(overrides: Partial<SshConfig> = {}): Promise<SshSession> {
  const session = await createSsh2Connector(config(overrides))()
  sessions.push(session)
  return session
}

describe('createSsh2Connector', () => {
  it('runs a command and returns stdout and the exit code', async () => {
    const session = await connect()
    await expect(session.exec('echo hi')).resolves.toEqual({ stdout: 'hi\n', stderr: '', code: 0 })
  })

  it('returns stderr and a non-zero exit code without throwing', async () => {
    const session = await connect()
    await expect(session.exec('fail')).resolves.toEqual({ stdout: '', stderr: 'bad\n', code: 3 })
  })

  it('rejects a command that never answers once the timeout expires', async () => {
    const session = await connect()
    await expect(session.exec('hang')).rejects.toThrow(/timed out/i)
  })

  it('lets one call wait longer than the default timeout', async () => {
    const session = await connect()
    await expect(session.exec('slow')).rejects.toThrow(/timed out/i)
    await expect(session.exec('slow', { timeoutMs: 3000 })).resolves.toEqual({
      stdout: 'late\n',
      stderr: '',
      code: 0
    })
  })

  it('refuses a server whose host key does not match the pinned fingerprint', async () => {
    await expect(connect({ hostFingerprint: 'SHA256:wrong' })).rejects.toThrow()
  })

  it('refuses every server when no fingerprint is pinned', async () => {
    await expect(connect({ hostFingerprint: '' })).rejects.toThrow()
  })

  it('rejects when nothing listens on the port', async () => {
    await expect(connect({ port: 1 })).rejects.toThrow()
  })

  it('notifies listeners when the server drops the connection', async () => {
    const session = await connect()
    const closed = new Promise<void>((resolve) => session.onClose(resolve))
    clients[0].end()
    await expect(closed).resolves.toBeUndefined()
  })
})
