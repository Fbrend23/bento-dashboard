import type { AgentStatus } from '@shared/agent'
import type { BentoStatus } from '@shared/monitors'
import { overallLevel } from '../main/monitors/snapshot'

/**
 * A read of the agent, in the shape the history takes. The agent runs on bento: when it can read,
 * the server is online by definition. A failed read produces no status at all, so it can never be
 * mistaken for an outage of bento (outages are deduced from the holes in the data instead).
 */
export function toBentoStatus(status: AgentStatus): BentoStatus {
  return {
    connection: 'online',
    configured: true,
    lastError: null,
    updatedAt: status.updatedAt,
    overall: overallLevel({
      connection: 'online',
      configured: true,
      services: status.services,
      metrics: status.metrics
    }),
    services: status.services,
    metrics: status.metrics
  }
}

/**
 * What the agent does with each reading. The first one also closes the hole left by the time the
 * agent was not running (restart, update, bento powered off): nothing was watching during it.
 */
export function createHistoryFeed(history: {
  noteGap(): void
  observe(status: BentoStatus): void
}): (status: AgentStatus) => void {
  let first = true
  return (status) => {
    if (first) {
      first = false
      history.noteGap()
    }
    history.observe(toBentoStatus(status))
  }
}
