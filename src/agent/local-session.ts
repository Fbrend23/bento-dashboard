import { spawn } from 'child_process'
import type { ExecOptions, ExecResult, SshSession } from '../main/ssh/connection'

export interface LocalSessionOptions {
  /** Program and leading arguments; the command string is appended as the last argument. */
  shell?: readonly [string, ...string[]]
  /** Default limit of a command, overridable per call. */
  timeoutMs?: number
}

const DEFAULT_SHELL = ['/bin/sh', '-c'] as const
const DEFAULT_TIMEOUT_MS = 20000

/**
 * Runs commands on this machine instead of over SSH, as the user the agent runs as. It only
 * replaces the transport: `ConnectionManager.run` still applies the allow-list before this.
 */
export function createLocalSession(options: LocalSessionOptions = {}): SshSession {
  const [file, ...args] = options.shell ?? DEFAULT_SHELL
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    exec: (command: string, execOptions?: ExecOptions) =>
      new Promise<ExecResult>((resolve, reject) => {
        const timeoutMs = execOptions?.timeoutMs ?? defaultTimeoutMs
        const child = spawn(file, [...args, command], { stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          child.kill('SIGKILL')
          reject(new Error(`Command timed out after ${timeoutMs} ms`))
        }, timeoutMs)
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf-8')))
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf-8')))
        child.on('error', (error) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(error)
        })
        child.on('close', (code) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ stdout, stderr, code })
        })
      }),
    close: () => {},
    // A local session cannot be lost: there is no connection to drop.
    onClose: () => {}
  }
}
