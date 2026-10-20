import type { AgentStatus } from '@shared/agent'
import type { ContainerActionResult } from '@shared/actions'
import type { CpuSample, NetSample } from '@shared/monitors'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { runContainerAction } from '../main/actions/container-action'
import { describeExecError } from '../main/monitors/logs'
import { createRunningMemory, type RunningMemory } from '../main/monitors/running-memory'
import { buildSnapshot, SNAPSHOT_COMMAND } from '../main/monitors/snapshot'
import { CommandNotAllowedError, type ExecOptions, type ExecResult } from '../main/ssh/connection'
import { isAgentCommand } from './commands'

export type Exec = (command: string, options?: ExecOptions) => Promise<ExecResult>

/** Every command goes through the agent allow-list on its way to the shell, whoever built it. */
export function guardExec(exec: Exec): Exec {
  return (command, options) => {
    if (!isAgentCommand(command)) return Promise.reject(new CommandNotAllowedError())
    return exec(command, options)
  }
}

export interface AgentServiceDeps {
  /** Runs a command on this machine; the service puts the allow-list in front of it. */
  exec: Exec
  labels: Pick<Settings, 'containerLabels' | 'stackLabels'>
  hiddenContainers: string[]
  /** Disk alert threshold; the desktop default when absent. */
  diskThresholdPercent?: number
  /** Told about every snapshot that was read, by the loop or for a request. Never for a failure. */
  onStatus?: (status: AgentStatus) => void
  /** The "was running" memory; in-memory when absent. The agent gives a file one to survive restarts. */
  memory?: RunningMemory
  /** Told when a container is about to be stopped or restarted from the phone (name, hold in ms). */
  quiet?: (container: string, durationMs: number) => void
  /** Delay between two reads of the loop. */
  pollMs?: number
  now?: () => number
  /** How long a snapshot answers the requests that follow it. */
  cacheMs?: number
}

export interface AgentService {
  /** Starts reading bento on its own (now, then every interval), so the history has no hole. */
  start(): void
  stop(): void
  getStatus(): Promise<AgentStatus>
  runAction(action: unknown, container: unknown): Promise<ContainerActionResult>
}

const DEFAULT_CACHE_MS = 5000
const DEFAULT_POLL_MS = 30_000

/**
 * What the phone sees, and what the history records. Bento is read by the loop (`start`) and
 * whenever the phone asks; a snapshot is shared for a few seconds between those, and
 * simultaneous readers share one read.
 */
export function createAgentService(deps: AgentServiceDeps): AgentService {
  const exec = guardExec(deps.exec)
  const now = deps.now ?? Date.now
  const cacheMs = deps.cacheMs ?? DEFAULT_CACHE_MS
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    diskThresholdPercent: deps.diskThresholdPercent ?? DEFAULT_SETTINGS.diskThresholdPercent,
    containerLabels: deps.labels.containerLabels,
    stackLabels: deps.labels.stackLabels,
    hiddenContainers: deps.hiddenContainers
  }
  const memory = deps.memory ?? createRunningMemory()
  // The baselines the next read measures cpu and network rates against.
  let cpuSample: CpuSample | null = null
  let netSample: NetSample | null = null

  let cache: { status: AgentStatus; at: number } | null = null
  let inflight: Promise<AgentStatus> | null = null
  /** Containers docker listed at the last readable snapshot: the only names an action may target. */
  let present: ReadonlySet<string> | null = null

  async function read(): Promise<AgentStatus> {
    const result = await exec(SNAPSHOT_COMMAND)
    const snapshot = buildSnapshot(result.stdout, settings, cpuSample, memory.names(), netSample)
    cpuSample = snapshot.cpuSample
    netSample = snapshot.netSample
    // An unreadable docker leaves the memory and the known names untouched.
    if (snapshot.docker) {
      memory.observe(snapshot.docker)
      present = new Set(snapshot.docker.present)
    }
    const at = now()
    const status: AgentStatus = {
      updatedAt: at,
      services: snapshot.services.map((service) => ({ ...service, ports: [] })),
      stackLabels: settings.stackLabels,
      metrics: snapshot.metrics
    }
    cache = { status, at }
    try {
      deps.onStatus?.(status)
    } catch {
      // The listener (the history) must not make a read fail.
    }
    return status
  }

  /** Reads bento now; simultaneous callers share the same read. */
  function refresh(): Promise<AgentStatus> {
    cache = null
    if (inflight) return inflight
    const promise: Promise<AgentStatus> = read().finally(() => {
      if (inflight === promise) inflight = null
    })
    inflight = promise
    return promise
  }

  function getStatus(): Promise<AgentStatus> {
    if (cache && now() - cache.at < cacheMs) return Promise.resolve(cache.status)
    return refresh()
  }

  async function runAction(action: unknown, container: unknown): Promise<ContainerActionResult> {
    if (present === null) {
      try {
        await getStatus()
      } catch (error) {
        return { ok: false, error: describeExecError(error, 'Lecture de bento impossible.') }
      }
    }
    return runContainerAction(
      {
        isOnline: () => true,
        knows: (name) => present?.has(name) ?? false,
        // The confirmation was given in the page; the agent only enforces the request rules.
        confirm: () => Promise.resolve(true),
        run: exec,
        refresh: () => refresh().then(() => {}),
        quiet: (name, durationMs) => deps.quiet?.(name, durationMs),
        forget: (name) => memory.forget(name)
      },
      action,
      container
    )
  }

  let timer: ReturnType<typeof setInterval> | null = null

  function start(): void {
    if (timer) return
    const poll = (): void => {
      // A failed read is not an event: the next one tries again, and the history shows a hole.
      refresh().catch(() => {})
    }
    poll()
    timer = setInterval(poll, pollMs)
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { start, stop, getStatus, runAction }
}
