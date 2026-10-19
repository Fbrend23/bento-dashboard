import { readFile, stat } from 'fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { extname, resolve, sep } from 'path'
import { AGENT_ACTION_PATH, AGENT_STATUS_PATH } from '@shared/agent'
import { authorize, type AuthOptions } from './auth'
import type { AgentService } from './service'

export interface AgentServerOptions {
  service: AgentService
  auth: AuthOptions
  /** Folder of the built PWA; without it only the API answers. */
  staticDir?: string
}

/** An action body is two short strings: anything bigger is not ours. */
export const MAX_BODY_BYTES = 1024
/** Past this, the connection is dropped instead of being read to the end. */
const ABORT_BODY_BYTES = 64 * 1024

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
}

const COMMON_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    ...COMMON_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(JSON.stringify(body))
}

const sendError = (res: ServerResponse, status: number, error: string): void =>
  sendJson(res, status, { error })

/** The body, or `null` when it is above the limit (the request is still read to its end). */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > ABORT_BODY_BYTES) {
        req.destroy()
        reject(new Error('Body too large'))
      } else if (size <= MAX_BODY_BYTES) {
        chunks.push(chunk)
      }
    })
    req.on('end', () =>
      resolveBody(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString())
    )
    req.on('error', reject)
  })
}

/** `{action, container}` as two strings and nothing else; `null` for any other shape. */
function parseActionBody(text: string): { action: string; container: string } | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const keys = Object.keys(value).sort()
  if (keys.length !== 2 || keys[0] !== 'action' || keys[1] !== 'container') return null
  const { action, container } = value as Record<string, unknown>
  return typeof action === 'string' && typeof container === 'string' ? { action, container } : null
}

async function handleAction(
  req: IncomingMessage,
  res: ServerResponse,
  service: AgentService
): Promise<void> {
  const text = await readBody(req)
  if (text === null) return sendError(res, 413, 'Requête trop grande.')
  const body = parseActionBody(text)
  if (!body) return sendError(res, 400, 'Requête invalide.')
  try {
    sendJson(res, 200, await service.runAction(body.action, body.container))
  } catch {
    sendError(res, 500, "L'action a échoué.")
  }
}

async function handleStatus(res: ServerResponse, service: AgentService): Promise<void> {
  try {
    sendJson(res, 200, await service.getStatus())
  } catch {
    // Never the raw error: it may carry paths or command output.
    sendError(res, 502, 'Lecture de bento impossible.')
  }
}

/** A file of the build, found only inside `root`. */
async function serveStatic(res: ServerResponse, root: string, rawPath: string): Promise<void> {
  let path: string
  try {
    path = decodeURIComponent(rawPath)
  } catch {
    return sendError(res, 400, 'Requête invalide.')
  }
  if (path.includes('\0') || path.includes('\\')) return sendError(res, 404, 'Introuvable.')
  const file = resolve(root, `.${path === '/' ? '/index.html' : path}`)
  if (!file.startsWith(root + sep)) return sendError(res, 404, 'Introuvable.')
  const type = TYPES[extname(file).toLowerCase()]
  try {
    if (!type || !(await stat(file)).isFile()) return sendError(res, 404, 'Introuvable.')
    const content = await readFile(file)
    res.writeHead(200, {
      ...COMMON_HEADERS,
      'Content-Type': type,
      'Cache-Control': 'no-cache',
      ...(type.startsWith('text/html') ? { 'Content-Security-Policy': CSP } : {})
    })
    res.end(content)
  } catch {
    sendError(res, 404, 'Introuvable.')
  }
}

/**
 * The agent's whole HTTP surface: two API routes and the built page. Everything is checked by
 * `authorize` first, so an unknown caller learns nothing, not even which routes exist.
 */
export function createAgentServer(options: AgentServerOptions): Server {
  const root = options.staticDir ? resolve(options.staticDir) : null

  return createServer((req, res) => {
    const method = req.method ?? 'GET'
    const verdict = authorize({ method, headers: req.headers }, options.auth)
    if (!verdict.ok) {
      req.resume()
      return sendError(res, verdict.status, 'Accès refusé.')
    }

    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://agent.invalid').pathname
    } catch {
      req.resume()
      return sendError(res, 400, 'Requête invalide.')
    }

    const fail = (): void => {
      if (!res.headersSent) sendError(res, 500, 'Erreur interne.')
      else res.end()
    }

    if (method === 'POST' && pathname === AGENT_ACTION_PATH) {
      handleAction(req, res, options.service).catch(fail)
    } else if (method === 'GET' && pathname === AGENT_STATUS_PATH) {
      handleStatus(res, options.service).catch(fail)
    } else if (method === 'GET' && root) {
      serveStatic(res, root, pathname).catch(fail)
    } else if (method === 'GET' || method === 'POST') {
      req.resume()
      sendError(res, 404, 'Introuvable.')
    } else {
      req.resume()
      res.setHeader('Allow', 'GET, POST')
      sendError(res, 405, 'Méthode non autorisée.')
    }
  })
}
