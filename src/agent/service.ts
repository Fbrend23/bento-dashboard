import type { AgentStatus } from '@shared/agent'
import type { ContainerActionResult } from '@shared/actions'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { runContainerAction } from '../main/actions/container-action'
import { describeExecError } from '../main/monitors/logs'
import { createRunningMemory } from '../main/monitors/running-memory'
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
  now?: () => number
  /** How long a snapshot answers the requests that follow it. */
  cacheMs?: number
}

export interface AgentService {
  getStatus(): Promise<AgentStatus>
  runAction(action: unknown, container: unknown): Promise<ContainerActionResult>
}

const DEFAULT_CACHE_MS = 5000

/**
 * What the phone sees. There is no polling loop: bento is only read when the phone asks, and
 * a snapshot is shared for a few seconds between requests.
 */
export function createAgentService(deps: AgentServiceDeps): AgentService {
  const exec = guardExec(deps.exec)
  const now = deps.now ?? Date.now
  const cacheMs = deps.cacheMs ?? DEFAULT_CACHE_MS
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    containerLabels: deps.labels.containerLabels,
    stackLabels: deps.labels.stackLabels,
    hiddenContainers: deps.hiddenContainers
  }
  const memory = createRunningMemory()

  let cache: { status: AgentStatus; at: number } | null = null
  let inflight: Promise<AgentStatus> | null = null
  /** Containers docker listed at the last readable snapshot: the only names an action may target. */
  let present: ReadonlySet<string> | null = null

  async function read(): Promise<AgentStatus> {
    const result = await exec(SNAPSHOT_COMMAND)
    const snapshot = buildSnapshot(result.stdout, settings, null, memory.names())
    // An unreadable docker leaves the memory and the known names untouched.
    if (snapshot.docker) {
      memory.observe(snapshot.docker)
      present = new Set(snapshot.docker.present)
    }
    const at = now()
    const status: AgentStatus = {
      updatedAt: at,
      services: snapshot.services.map((service) => ({ ...service, ports: [] })),
      stackLabels: settings.stackLabels
    }
    cache = { status, at }
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
        // No notifications here, so nothing to hold back.
        quiet: () => {},
        forget: (name) => memory.forget(name)
      },
      action,
      container
    )
  }

  return { getStatus, runAction }
}
