// What the bento agent serves to the phone (src/agent -> src/mobile). Read-only status plus the
// result of the three container verbs; nothing here can name a command.

import type { Metrics, ServiceStatus } from './monitors'

/** The two request headers the phone must send; the agent refuses a POST without them. */
export const AGENT_HEADER = 'X-Bento-Agent'
export const AGENT_HEADER_VALUE = '1'

export const AGENT_STATUS_PATH = '/api/status'
export const AGENT_ACTION_PATH = '/api/containers/action'
/** Read-only: `?range=1h|24h|7d`, answered from the history the agent already keeps in memory. */
export const AGENT_HISTORY_PATH = '/api/history'

export interface AgentStatus {
  /** Server clock (ms since epoch) when the snapshot was read. */
  updatedAt: number
  /** Containers and Tailscale. Published ports are always empty: the phone does not open links. */
  services: ServiceStatus[]
  /** Display names by compose project, from the agent's own config. */
  stackLabels: Record<string, string>
  /** Processor, memory, disks, uptime and load: read by the same snapshot as the services. */
  metrics: Metrics
}

/** The body the phone sends: two strings, validated by the agent exactly as the desktop does. */
export interface AgentActionRequest {
  action: string
  container: string
}
