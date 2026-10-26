import { createHash, timingSafeEqual } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import {
  fromJellyseerr,
  fromNotifyBody,
  fromRadarr,
  fromSonarr,
  type HookResult
} from './notify-hooks'
import type { OutboundNotification } from './notification'

// The entry for pushes that do not come from bento itself: a cron script, Sonarr, Radarr,
// Jellyseerr. It is a second server on purpose, apart from the one `tailscale serve` forwards to:
// that one trusts a Tailscale login header, this one trusts a secret, and neither can be mistaken
// for the other.

/** A webhook of Sonarr or Jellyseerr is a few KB at most. */
export const MAX_NOTIFY_BODY_BYTES = 16 * 1024

export const NOTIFY_PATHS = {
  notify: '/notify',
  sonarr: '/hooks/sonarr',
  radarr: '/hooks/radarr',
  jellyseerr: '/hooks/jellyseerr'
} as const

const PARSERS: Record<string, (value: unknown) => HookResult> = {
  [NOTIFY_PATHS.notify]: fromNotifyBody,
  [NOTIFY_PATHS.sonarr]: fromSonarr,
  [NOTIFY_PATHS.radarr]: fromRadarr,
  [NOTIFY_PATHS.jellyseerr]: fromJellyseerr
}

export interface NotifyServerOptions {
  /** The bearer secret of the config. */
  token: string
  /** Hands the message to the senders; the senders queue it and swallow their own failures. */
  send: (notification: OutboundNotification) => void
  /** One line per refused request, no secret. */
  log?: (line: string) => void
}

function reply(res: ServerResponse, status: number, body?: unknown): void {
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }
  if (body === undefined) {
    res.writeHead(status, headers)
    res.end()
    return
  }
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Compares digests, so neither the length nor the content of the secret leaks through timing. */
function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

function bearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization
  const match = typeof header === 'string' ? /^Bearer (\S+)$/.exec(header) : null
  return match ? match[1] : null
}

/** Past this, the connection is dropped instead of being read to the end. */
const ABORT_BODY_BYTES = 64 * 1024

/** The body, or `null` above the limit (the request is still read to its end, up to a point). */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > ABORT_BODY_BYTES) {
        req.destroy()
        reject(new Error('Body too large'))
      } else if (size <= MAX_NOTIFY_BODY_BYTES) {
        chunks.push(chunk)
      }
    })
    req.on('end', () =>
      resolve(size > MAX_NOTIFY_BODY_BYTES ? null : Buffer.concat(chunks).toString())
    )
    req.on('error', reject)
  })
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  options: NotifyServerOptions
): Promise<void> {
  const log = options.log ?? (() => {})
  const path = new URL(req.url ?? '/', 'http://notify.invalid').pathname

  // A request that went through `tailscale serve` is not meant for this port.
  if (Object.keys(req.headers).some((name) => name.startsWith('tailscale-'))) {
    log('notify: refused (tailscale headers)')
    req.resume()
    return reply(res, 403, { error: 'Accès refusé.' })
  }
  const given = bearer(req)
  if (given === null || !sameSecret(given, options.token)) {
    log('notify: refused (token)')
    req.resume()
    return reply(res, 401, { error: 'Jeton invalide.' })
  }
  const parse = PARSERS[path]
  if (!parse) {
    req.resume()
    return reply(res, 404, { error: 'Introuvable.' })
  }
  if (req.method !== 'POST') {
    req.resume()
    res.setHeader('Allow', 'POST')
    return reply(res, 405, { error: 'Méthode non autorisée.' })
  }

  const raw = await readBody(req)
  if (raw === null) return reply(res, 413, { error: 'Requête trop grande.' })
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return reply(res, 400, { error: 'Requête invalide.' })
  }
  const result = parse(value)
  if (result === null) return reply(res, 400, { error: 'Requête invalide.' })
  if (result !== 'ignore') options.send(result)
  reply(res, 204)
}

export function createNotifyServer(options: NotifyServerOptions): Server {
  return createServer((req, res) => {
    handle(req, res, options).catch(() => {
      if (!res.headersSent) reply(res, 500, { error: 'Erreur interne.' })
      else res.end()
    })
  })
}

/**
 * Listens on `ip:port`. The address can be one that does not exist yet at boot (the docker
 * bridge): the agent must not fall over for it, so it logs and tries again later.
 */
export function listenWithRetry(
  server: Server,
  listen: string,
  log: (line: string) => void,
  retryMs = 15_000
): void {
  const [host, port] = listen.split(':')
  const attempt = (): void => {
    const onError = (error: NodeJS.ErrnoException): void => {
      log(`notify: cannot listen on ${listen} (${error.code ?? 'error'}), retrying`)
      setTimeout(attempt, retryMs).unref()
    }
    server.once('error', onError)
    server.listen(Number(port), host, () => {
      server.off('error', onError)
      // A later error is logged: an unhandled one would stop the whole agent.
      server.on('error', (error: NodeJS.ErrnoException) => log(`notify: ${error.code ?? 'error'}`))
      log(`notify: listening on ${listen}`)
    })
  }
  attempt()
}
