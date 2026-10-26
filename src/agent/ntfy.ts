import {
  notificationKind,
  type NotificationSender,
  type OutboundNotification
} from './notification'

const TITLE_MAX = 250
const MESSAGE_MAX = 3500
const TIMEOUT_MS = 10_000
const RETRY_CAP_MS = 10_000
export const DEFAULT_NTFY_URL = 'https://ntfy.sh'

// ntfy priorities: 1 min, 2 low, 3 default, 4 high, 5 max.
const PRIORITY = { low: 2, default: 3, high: 4 } as const

/** What ntfy publishes as JSON: the title keeps its accents, which a header could not carry. */
export interface NtfyPayload {
  topic: string
  title: string
  message: string
  priority: number
  tags: string[]
}

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`

/** The time of the event, in the time zone of the agent (the server's). */
const clock = (at: number): string =>
  new Date(at).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

/**
 * Docker words the age of the state relative to the moment it was read ("il y a 3 secondes"),
 * which means nothing once the push is read later: the time of the event replaces it.
 */
function withClockTime(text: string, at: number): string {
  return text
    .replace(/ il y a [^,.]+/, ` à ${clock(at)}`)
    .replace(/^Actif depuis [^,.]+/, `Revenu à ${clock(at)}`)
}

export function toNtfyPayload(
  notification: OutboundNotification,
  topic: string,
  at: number = Date.now()
): NtfyPayload {
  const kind = notificationKind(notification.id)
  const priority =
    notification.priority ?? (kind === 'problem' ? 'high' : kind === 'recovery' ? 'low' : 'default')
  const tags =
    notification.tags ??
    (kind === 'problem' ? ['rotating_light'] : kind === 'recovery' ? ['white_check_mark'] : [])
  return {
    topic,
    title: truncate(notification.title, TITLE_MAX),
    message: truncate(withClockTime(notification.body, at), MESSAGE_MAX),
    priority: PRIORITY[priority],
    tags
  }
}

export interface NtfySenderDeps {
  /** The topic is the only protection of a public server: it is a secret, used for the request only. */
  topic: string
  /** Base url of the ntfy server; the public one when absent. */
  url?: string
  /** Access token of a protected topic, sent as a bearer. */
  token?: string
  fetch?: typeof fetch
  now?: () => number
  log?: (line: string) => void
  sleep?: (ms: number) => Promise<void>
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** ntfy answers 429 with a `Retry-After` in seconds when it is not an HTTP date. */
function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('Retry-After'))
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, RETRY_CAP_MS) : 1000
}

export function createNtfySender(deps: NtfySenderDeps): NotificationSender {
  const doFetch = deps.fetch ?? fetch
  const log = deps.log ?? (() => {})
  const sleep = deps.sleep ?? wait
  const now = deps.now ?? Date.now
  const url = deps.url ?? DEFAULT_NTFY_URL
  let queue: Promise<void> = Promise.resolve()

  const post = (payload: NtfyPayload): Promise<Response> =>
    doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(deps.token ? { Authorization: `Bearer ${deps.token}` } : {})
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })

  async function deliver(notification: OutboundNotification, at: number): Promise<void> {
    const payload = toNtfyPayload(notification, deps.topic, at)
    try {
      let response = await post(payload)
      if (response.status === 429) {
        await sleep(retryAfterMs(response))
        response = await post(payload)
      }
      // Only the status is logged: never the topic, the token, nor an error message holding them.
      if (!response.ok) log(`ntfy: message not delivered (HTTP ${response.status})`)
    } catch {
      log('ntfy: message not delivered (network error)')
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
