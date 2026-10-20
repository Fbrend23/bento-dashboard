import type { AppNotification } from '../main/notifications/tracker'

const RED = 0xe5484d
const GREEN = 0x30a46c
const TITLE_MAX = 256
const DESCRIPTION_MAX = 2000
const TIMEOUT_MS = 10_000
const RETRY_CAP_MS = 10_000

export interface DiscordPayload {
  username: string
  /** The ping of the configured user, on a problem only. */
  content?: string
  embeds: { title: string; description: string; color: number; timestamp: string }[]
  /** Nobody can be pinged but the configured user: a container name never pings anyone. */
  allowed_mentions: { parse: never[]; users?: string[] }
}

const escapeMarkdown = (text: string): string => text.replace(/([\\*_`~|>])/g, '\\$1')

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

/**
 * Docker words the age of the state relative to the moment it was read ("il y a 3 secondes"), which
 * means nothing once the message is read later. The time of the event replaces it; Discord shows
 * `<t:…:T>` in the time zone of whoever reads.
 */
function withClockTime(text: string, at: number): string {
  const clock = `<t:${Math.floor(at / 1000)}:T>`
  return text
    .replace(/ il y a [^,.]+/, ` à ${clock}`)
    .replace(/^Actif depuis [^,.]+/, `Revenu à ${clock}`)
}

export function toDiscordPayload(
  notification: AppNotification,
  mentionUserId?: string,
  at: number = Date.now()
): DiscordPayload {
  const ping = mentionUserId !== undefined && !notification.id.startsWith('up:')
  return {
    username: 'bento',
    ...(ping ? { content: `<@${mentionUserId}>` } : {}),
    embeds: [
      {
        title: truncate(escapeMarkdown(notification.title), TITLE_MAX),
        description: truncate(
          withClockTime(escapeMarkdown(notification.body), at),
          DESCRIPTION_MAX
        ),
        color: notification.id.startsWith('up:') ? GREEN : RED,
        timestamp: new Date(at).toISOString()
      }
    ],
    allowed_mentions: ping ? { parse: [], users: [mentionUserId] } : { parse: [] }
  }
}

export interface DiscordSender {
  /** Never rejects: a message that cannot be delivered is logged and dropped. */
  send(notification: AppNotification): Promise<void>
}

export interface DiscordSenderDeps {
  /** The webhook url is a secret: it is used for the request and appears nowhere else. */
  url: string
  /** Numeric id of the user to ping on a problem. */
  mentionUserId?: string
  fetch?: typeof fetch
  now?: () => number
  log?: (line: string) => void
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function retryAfterMs(response: Response): Promise<number> {
  try {
    const body = (await response.json()) as { retry_after?: unknown }
    const seconds = typeof body.retry_after === 'number' ? body.retry_after : 1
    return Math.min(Math.max(seconds * 1000, 0), RETRY_CAP_MS)
  } catch {
    return 1000
  }
}

export function createDiscordSender(deps: DiscordSenderDeps): DiscordSender {
  const doFetch = deps.fetch ?? fetch
  const log = deps.log ?? (() => {})
  const sleep = deps.sleep ?? wait
  const now = deps.now ?? Date.now
  let queue: Promise<void> = Promise.resolve()

  const post = (payload: DiscordPayload): Promise<Response> =>
    doFetch(deps.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })

  async function deliver(notification: AppNotification, at: number): Promise<void> {
    const payload = toDiscordPayload(notification, deps.mentionUserId, at)
    try {
      let response = await post(payload)
      if (response.status === 429) {
        await sleep(await retryAfterMs(response))
        response = await post(payload)
      }
      // Only the status is logged: never the url, never an error message that could contain it.
      if (!response.ok) log(`discord: message not delivered (HTTP ${response.status})`)
    } catch {
      log('discord: message not delivered (network error)')
    }
  }

  return {
    send(notification) {
      // The time is the one of the event, taken now: the queue may delay the delivery.
      const at = now()
      queue = queue.then(() => deliver(notification, at))
      return queue
    }
  }
}
