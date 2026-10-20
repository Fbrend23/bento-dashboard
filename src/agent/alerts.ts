import type { AgentStatus } from '@shared/agent'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { NotificationTracker, type AppNotification } from '../main/notifications/tracker'
import { toBentoStatus } from './history'

// Only the two things worth waking someone for: a container (or tailscaled) that goes down, and
// its return. Disks, health, cpu, memory and load stay in the app and the history.
const SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  notifyUnhealthy: false,
  notifyCpu: false,
  notifyMemory: false,
  notifyLoad: false,
  notifyRecovery: true,
  quietHoursEnabled: false
}

const isWanted = (n: AppNotification): boolean => n.id.startsWith('down:') || n.id.startsWith('up:')

export interface Alerts {
  /** What to announce after this reading. */
  update(status: AgentStatus): AppNotification[]
  /** Holds back the "down" message of a container we stop or restart ourselves. */
  suppress(container: string, durationMs: number): void
}

/** The desktop's own decider, fed with the agent's readings and trimmed to the wanted messages. */
export function createAlerts(deps: { now?: () => number } = {}): Alerts {
  const now = deps.now ?? Date.now
  const tracker = new NotificationTracker()
  return {
    update: (status) => tracker.update(toBentoStatus(status), SETTINGS, now()).filter(isWanted),
    suppress: (container, durationMs) => tracker.suppress(container, now() + durationMs)
  }
}
