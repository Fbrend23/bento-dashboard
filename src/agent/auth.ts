import { AGENT_HEADER, AGENT_HEADER_VALUE } from '@shared/agent'

type Headers = Record<string, string | string[] | undefined>

export interface AuthRequest {
  method: string
  /** Node's `req.headers`: lower-case names. */
  headers: Headers
}

export interface AuthOptions {
  /** Tailscale login allowed to use the agent (from the config on bento). */
  allowedLogin: string
  /** Origin the PWA is served from; when unset, derived from the Host header. */
  allowedOrigin?: string
}

export type AuthResult = { ok: true } | { ok: false; status: 403 | 415 }

const DENIED = { ok: false, status: 403 } as const

function single(headers: Headers, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function isJson(contentType: string | undefined): boolean {
  return contentType !== undefined && /^application\/json\s*(;|$)/i.test(contentType)
}

/** Same origin as the page: the configured one, else the Host header's host. */
function isOwnOrigin(
  origin: string | undefined,
  host: string | undefined,
  allowed?: string
): boolean {
  if (!origin) return false
  if (allowed) return origin === allowed
  if (!host) return false
  try {
    const url = new URL(origin)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.host === host
  } catch {
    return false
  }
}

/** A header value that is safe to put in a log line: short, printable, one line. */
function loggable(value: string | undefined): string {
  if (value === undefined) return '-'
  return /^[a-z0-9-]{1,20}$/.test(value) ? value : '?'
}

/**
 * One line telling why a request was refused, for the journal on bento. It names the headers
 * that decide the verdict, never the login or the origin themselves.
 */
export function describeRefusal(request: AuthRequest, path: string, options: AuthOptions): string {
  const { headers } = request
  const login = single(headers, 'tailscale-user-login')
  const origin = single(headers, 'origin')
  const loginState =
    login === undefined ? 'missing' : login === options.allowedLogin ? 'ok' : 'mismatch'
  const originState =
    origin === undefined
      ? 'absent'
      : isOwnOrigin(origin, single(headers, 'host'), options.allowedOrigin)
        ? 'match'
        : 'mismatch'
  const fields = [
    `login=${loginState}`,
    `site=${loggable(single(headers, 'sec-fetch-site'))}`,
    `mode=${loggable(single(headers, 'sec-fetch-mode'))}`,
    `dest=${loggable(single(headers, 'sec-fetch-dest'))}`,
    `origin=${originState}`
  ]
  return `refused ${loggable(request.method.toLowerCase()).toUpperCase()} ${path} ${fields.join(' ')}`
}

/**
 * Who may talk to the agent. It listens on loopback only, so the `Tailscale-User-Login` header can
 * only come from `tailscale serve`. Reads need that login; an action also has to prove it comes
 * from our own page (no CORS, JSON only, custom header, same origin), because the confirmation
 * now lives in the page and a foreign site must not be able to post to it.
 */
export function authorize(request: AuthRequest, options: AuthOptions): AuthResult {
  const { headers } = request
  const login = single(headers, 'tailscale-user-login')
  if (!options.allowedLogin || login !== options.allowedLogin) return DENIED

  const site = single(headers, 'sec-fetch-site')
  if (request.method !== 'POST') {
    // Absent on old browsers and tools: the login check above is the barrier for reads.
    if (site === undefined || site === 'same-origin' || site === 'none') return { ok: true }
    // Opening the page from a link or another app is a navigation from "another site". It is
    // harmless: the opener cannot read what a navigation loads, and the page itself talks to
    // the agent from its own origin. Only `dest: document` is checked, not the mode: our service
    // worker relays the launch of the installed app with `fetch(request)`, which turns the mode
    // from `navigate` into `same-origin` and keeps site and dest. A foreign fetch has
    // `dest: empty`, an iframe `dest: iframe`, and a web page cannot forge these headers.
    return single(headers, 'sec-fetch-dest') === 'document' ? { ok: true } : DENIED
  }

  if (site !== 'same-origin') return DENIED
  if (single(headers, AGENT_HEADER.toLowerCase()) !== AGENT_HEADER_VALUE) return DENIED
  if (!isOwnOrigin(single(headers, 'origin'), single(headers, 'host'), options.allowedOrigin)) {
    return DENIED
  }
  if (!isJson(single(headers, 'content-type'))) return { ok: false, status: 415 }
  return { ok: true }
}
