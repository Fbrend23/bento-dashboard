import type { ConnectionState } from '@shared/monitors'
import { reconnectDelay } from './backoff'
import { isAllowedCommand } from './commands'

export interface ExecResult {
  stdout: string
  stderr: string
  code: number | null
}

export interface ExecOptions {
  /** Overrides the session's default timeout for this one command. */
  timeoutMs?: number
}

export interface SshSession {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>
  close(): void
  onClose(listener: () => void): void
}

export type Connector = () => Promise<SshSession>

type StateListener = (state: ConnectionState) => void

export class NotConnectedError extends Error {
  constructor() {
    super('Not connected to bento')
    this.name = 'NotConnectedError'
  }
}

export class CommandNotAllowedError extends Error {
  constructor() {
    super('Command not in the allow-list')
    this.name = 'CommandNotAllowedError'
  }
}

/**
 * Keeps a single SSH session alive: reconnects with exponential backoff and treats
 * an unreachable server as a normal state (offline), never as a crash.
 */
export class ConnectionManager {
  private _state: ConnectionState = 'offline'
  private _lastError: string | null = null
  private session: SshSession | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private running = false
  /** Bumped on stop() so late results of an abandoned connection attempt are discarded. */
  private generation = 0
  private readonly listeners = new Set<StateListener>()

  constructor(private connector: Connector) {}

  get state(): ConnectionState {
    return this._state
  }

  get lastError(): string | null {
    return this._lastError
  }

  onStateChange(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.connect()
  }

  stop(): void {
    this.running = false
    this.generation++
    this.attempt = 0
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const session = this.session
    this.session = null
    session?.close()
    this.setState('offline')
  }

  /** Settings changed: drop the current session and, if running, reconnect with the new one. */
  replaceConnector(connector: Connector): void {
    const wasRunning = this.running
    this.stop()
    this.connector = connector
    if (wasRunning) this.start()
  }

  async run(command: string, options?: ExecOptions): Promise<ExecResult> {
    if (!isAllowedCommand(command)) throw new CommandNotAllowedError()
    if (this._state !== 'online' || !this.session) throw new NotConnectedError()
    return options ? this.session.exec(command, options) : this.session.exec(command)
  }

  private connect(): void {
    const generation = this.generation
    this.setState('connecting')
    this.connector().then(
      (session) => {
        if (generation !== this.generation || !this.running) {
          session.close()
          return
        }
        this.session = session
        this.attempt = 0
        this._lastError = null
        session.onClose(() => {
          if (this.session !== session) return
          this.session = null
          this.fail('Connection closed')
        })
        this.setState('online')
      },
      (error: unknown) => {
        if (generation !== this.generation || !this.running) return
        this.fail(error instanceof Error ? error.message : String(error))
      }
    )
  }

  private fail(message: string): void {
    this._lastError = message
    this.setState('offline')
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.running) this.connect()
    }, reconnectDelay(this.attempt++))
  }

  private setState(state: ConnectionState): void {
    if (state === this._state) return
    this._state = state
    for (const listener of this.listeners) listener(state)
  }
}
