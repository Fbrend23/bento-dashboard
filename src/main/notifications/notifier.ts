import { Notification } from 'electron'
import type { Settings } from '@shared/settings'
import type { BentoStatus } from '@shared/monitors'
import { NotificationTracker } from './tracker'

interface Deps {
  getSettings: () => Settings
  /** Called when the user clicks a notification. */
  onClick: () => void
}

export interface Notifier {
  check(status: BentoStatus): void
  /** Holds back the "down" notification of a service for `durationMs`. */
  suppress(serviceId: string, durationMs: number): void
}

/** Wiring only: which notifications to send is decided by the tested NotificationTracker. */
export function createNotifier(deps: Deps): Notifier {
  const tracker = new NotificationTracker()
  return {
    check(status) {
      if (!Notification.isSupported()) return
      for (const { title, body } of tracker.update(status, deps.getSettings(), Date.now())) {
        const toast = new Notification({ title, body })
        toast.on('click', deps.onClick)
        toast.show()
      }
    },
    suppress(serviceId, durationMs) {
      tracker.suppress(serviceId, Date.now() + durationMs)
    }
  }
}
