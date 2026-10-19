import { Client } from 'ssh2'
import type { Connector, ExecResult, SshSession } from './connection'
import { resolveAgentPath } from './agent'
import { isTrustedHostKey } from './hostkey'

export type SshAuth =
  | { kind: 'agent'; path?: string }
  | { kind: 'key'; privateKey: string | Buffer; passphrase?: string }

export interface SshConfig {
  host: string
  port: number
  username: string
  /** Pinned host key fingerprint ("SHA256:…"). Connections are refused without it. */
  hostFingerprint: string
  auth: SshAuth
  connectTimeoutMs?: number
  execTimeoutMs?: number
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10000
const DEFAULT_EXEC_TIMEOUT_MS = 20000

/** Wiring around ssh2: one connection, commands run through exec() only. */
export function createSsh2Connector(config: SshConfig): Connector {
  return () =>
    new Promise<SshSession>((resolve, reject) => {
      const execTimeoutMs = config.execTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS
      const client = new Client()
      const closeListeners: Array<() => void> = []
      let ready = false
      let closed = false

      const notifyClosed = (): void => {
        if (closed) return
        closed = true
        for (const listener of closeListeners) listener()
      }

      const session: SshSession = {
        exec: (command, options) =>
          new Promise<ExecResult>((resolveExec, rejectExec) => {
            const timeoutMs = options?.timeoutMs ?? execTimeoutMs
            client.exec(command, (error, stream) => {
              if (error) return rejectExec(error)
              let stdout = ''
              let stderr = ''
              const timer = setTimeout(() => {
                stream.close()
                rejectExec(new Error(`Command timed out after ${timeoutMs} ms`))
              }, timeoutMs)
              stream.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf-8')))
              stream.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf-8')))
              stream.on('close', (code: number | null | undefined) => {
                clearTimeout(timer)
                resolveExec({ stdout, stderr, code: code ?? null })
              })
            })
          }),
        close: () => client.end(),
        onClose: (listener) => {
          closeListeners.push(listener)
        }
      }

      client.on('ready', () => {
        ready = true
        resolve(session)
      })
      client.on('error', (error) => {
        if (ready) notifyClosed()
        else reject(error)
      })
      client.on('close', () => {
        if (ready) notifyClosed()
        else reject(new Error('Connection closed before it was ready'))
      })

      try {
        client.connect({
          host: config.host,
          port: config.port,
          username: config.username,
          readyTimeout: config.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
          keepaliveInterval: 15000,
          keepaliveCountMax: 3,
          hostVerifier: (key: Buffer | string) =>
            typeof key !== 'string' && isTrustedHostKey(key, config.hostFingerprint),
          ...(config.auth.kind === 'agent'
            ? { agent: resolveAgentPath(config.auth.path, process.env, process.platform) }
            : { privateKey: config.auth.privateKey, passphrase: config.auth.passphrase })
        })
      } catch (error) {
        reject(error)
      }
    })
}
