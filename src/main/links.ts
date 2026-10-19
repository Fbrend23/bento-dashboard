// The only URLs the app ever opens in the browser: a port published by a container on bento,
// reached through the host configured in the settings. Never built from anything the renderer sends.

/** Ports that serve https; every other published port is opened over http. */
const HTTPS_PORTS: ReadonlySet<number> = new Set([443, 8443, 9443])

// Same shape as the host setting: letters, digits, dots, hyphens and colons (IPv6).
const HOST = /^[A-Za-z0-9][A-Za-z0-9.:-]*$/

/** `http(s)://<host>:<port>/`, or null when the host or the port is not acceptable. */
export function buildServiceUrl(host: string, port: number): string | null {
  if (typeof host !== 'string' || host.length > 253 || !HOST.test(host)) return null
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null

  const scheme = HTTPS_PORTS.has(port) ? 'https' : 'http'
  const authority = host.includes(':') ? `[${host}]` : host
  const candidate = `${scheme}://${authority}:${port}/`

  // Parse the result back: it must point exactly at the host and port asked for, nothing else.
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const same = hostname === host.toLowerCase() || (host.includes(':') && hostname.length > 0) // IPv6 is normalised
  const clean = url.username === '' && url.password === '' && url.search === '' && url.hash === ''
  const portMatches = url.port === String(port) || (url.port === '' && port === defaultPort(scheme))
  return same && clean && portMatches && url.pathname === '/' ? candidate : null
}

const defaultPort = (scheme: 'http' | 'https'): number => (scheme === 'https' ? 443 : 80)
