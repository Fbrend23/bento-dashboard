import type { AppNotification } from '../main/notifications/tracker'

/** A message plus what only some channels use. The tracker's own notifications have neither. */
export interface OutboundNotification extends AppNotification {
  priority?: 'low' | 'default' | 'high'
  tags?: string[]
}

/** Where a notification is announced (Discord, ntfy). */
export interface NotificationSender {
  /** Never rejects: a message that cannot be delivered is logged and dropped. */
  send(notification: OutboundNotification): Promise<void>
}

export type NotificationKind = 'problem' | 'recovery' | 'info'

const RECOVERY_PREFIXES = ['up:', 'healthy:', 'disk-ok:']
/** Messages that are neither a problem nor its end: a film that arrived, a script's report. */
export const INFO_PREFIX = 'info:'

export function notificationKind(id: string): NotificationKind {
  if (RECOVERY_PREFIXES.some((prefix) => id.startsWith(prefix))) return 'recovery'
  if (id.startsWith(INFO_PREFIX)) return 'info'
  return 'problem'
}
