import type { Settings } from '@shared/settings'
import type {
  BentoStatus,
  ConnectionState,
  CpuSample,
  Metrics,
  NetSample,
  ServiceStatus
} from '@shared/monitors'
import { isConfigured } from '../settings/validate'
import { NotConnectedError, type ExecResult } from '../ssh/connection'
import { createRunningMemory, type RunningMemory } from './running-memory'
import { buildSnapshot, overallLevel, SNAPSHOT_COMMAND } from './snapshot'

export interface PollerConnection {
  readonly state: ConnectionState
  readonly lastError: string | null
  run(command: string): Promise<ExecResult>
  onStateChange(listener: (state: ConnectionState) => void): () => void
}

interface Deps {
  connection: PollerConnection
  getSettings: () => Settings
  now?: () => number
  /** Which containers were seen running; defaults to a memory that lasts as long as the poller. */
  runningMemory?: RunningMemory
}

interface Data {
  services: ServiceStatus[]
  metrics: Metrics
  updatedAt: number
}

type StatusListener = (status: BentoStatus) => void

/**
 * The cpu needs two samples. Right after a (re)connection the first one has nothing to compare
 * with, so a second one is taken this soon instead of leaving "—" on screen for a whole interval.
 */
export const CPU_BASELINE_DELAY_MS = 2000

/**
 * One polling loop: asks bento for a snapshot every `refreshIntervalSec` while the connection is
 * online, keeps the last data when the server goes away, and never loops faster than the interval.
 */
export class StatusPoller {
  private data: Data | null = null
  private previousCpu: CpuSample | null = null
  private previousNet: NetSample | null = null
  private pollError: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private inflight: Promise<void> | null = null
  private unsubscribe: (() => void) | null = null
  private running = false
  /** Bumped when polling must be abandoned (stop, connection lost) to discard late results. */
  private generation = 0
  private readonly listeners = new Set<StatusListener>()
  private readonly now: () => number
  private readonly runningMemory: RunningMemory
  /** Containers docker listed at the last readable poll: the only names that may be forgotten. */
  private presentContainers = new Set<string>()

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? Date.now
    this.runningMemory = deps.runningMemory ?? createRunningMemory()
  }

  /** True for a container docker listed at the last readable poll (hidden ones included). */
  knowsContainer(name: string): boolean {
    return this.presentContainers.has(name)
  }

  /**
   * "Ignore this stop": a stopped container no longer raises an alert until it runs again.
   * Only a container docker listed at the last poll is accepted; the name is never sent anywhere.
   */
  forgetContainer(name: string): void {
    if (!this.presentContainers.has(name) || !this.data) return
    this.runningMemory.forget(name)
    this.data = {
      ...this.data,
      services: this.data.services.map((s) =>
        s.id === name && s.level === 'down' ? { ...s, level: 'stopped' } : s
      )
    }
    this.publish()
  }

  get status(): BentoStatus {
    const { connection } = this.deps
    const configured = isConfigured(this.deps.getSettings())
    const services = this.data?.services ?? []
    const metrics = this.data?.metrics ?? null
    return {
      connection: connection.state,
      configured,
      lastError: connection.state === 'online' ? this.pollError : connection.lastError,
      updatedAt: this.data?.updatedAt ?? null,
      overall: overallLevel({ connection: connection.state, configured, services, metrics }),
      services,
      metrics
    }
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.unsubscribe = this.deps.connection.onStateChange((state) => {
      if (state === 'online') {
        void this.poll()
      } else {
        this.abandon()
        this.previousCpu = null
        this.previousNet = null
        this.publish()
      }
    })
    if (this.deps.connection.state === 'online') void this.poll()
  }

  stop(): void {
    this.running = false
    this.abandon()
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  /** Manual refresh; a no-op unless online. Concurrent calls share the same poll. */
  refresh(): Promise<void> {
    return this.running && this.deps.connection.state === 'online' ? this.poll() : Promise.resolve()
  }

  /** Settings changed: republish the status and, if online, poll now with the new interval. */
  reconfigure(): void {
    this.clearTimer()
    this.publish()
    if (this.running && this.deps.connection.state === 'online') void this.poll()
  }

  private poll(): Promise<void> {
    if (this.inflight) return this.inflight
    this.clearTimer()
    const generation = this.generation
    const promise: Promise<void> = this.runPoll(generation).finally(() => {
      if (this.inflight === promise) this.inflight = null
    })
    this.inflight = promise
    return promise
  }

  private async runPoll(generation: number): Promise<void> {
    let needsCpuBaseline = false
    try {
      const result = await this.deps.connection.run(SNAPSHOT_COMMAND)
      if (generation !== this.generation) return
      const snapshot = buildSnapshot(
        result.stdout,
        this.deps.getSettings(),
        this.previousCpu,
        this.runningMemory.names(),
        this.previousNet
      )
      needsCpuBaseline = this.previousCpu === null && snapshot.cpuSample !== null
      this.previousCpu = snapshot.cpuSample
      this.previousNet = snapshot.netSample
      // An unreadable docker leaves the memory untouched: it must never wipe what was seen running.
      if (snapshot.docker) {
        this.runningMemory.observe(snapshot.docker)
        this.presentContainers = new Set(snapshot.docker.present)
      }
      this.data = {
        services: snapshot.services,
        metrics: snapshot.metrics,
        updatedAt: this.now()
      }
      this.pollError = null
    } catch (error) {
      if (generation !== this.generation) return
      // Connection lost mid-poll: the connection's own state change takes over.
      if (error instanceof NotConnectedError) return
      this.pollError = error instanceof Error ? error.message : String(error)
    }
    this.publish()
    this.schedule(generation, needsCpuBaseline)
  }

  private schedule(generation: number, quick = false): void {
    const delay = quick ? CPU_BASELINE_DELAY_MS : this.deps.getSettings().refreshIntervalSec * 1000
    this.timer = setTimeout(() => {
      this.timer = null
      if (
        this.running &&
        generation === this.generation &&
        this.deps.connection.state === 'online'
      ) {
        void this.poll()
      }
    }, delay)
  }

  private abandon(): void {
    this.generation++
    this.clearTimer()
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private publish(): void {
    const status = this.status
    for (const listener of this.listeners) listener(status)
  }
}
