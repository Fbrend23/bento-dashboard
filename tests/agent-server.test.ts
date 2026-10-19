import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import type { AddressInfo } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatus } from '../src/shared/agent'
import { createAgentServer } from '../src/agent/server'
import type { AgentService } from '../src/agent/service'

const LOGIN = 'owner@example.com'
const ORIGIN = 'https://bento.example.ts.net'

const STATUS: AgentStatus = {
  updatedAt: 1_700_000_000_000,
  services: [
    {
      id: 'jellyfin',
      label: 'Jellyfin',
      kind: 'container',
      level: 'ok',
      detail: 'Up 2 days',
      state: 'running',
      project: 'media',
      ports: []
    }
  ],
  stackLabels: { media: 'Médias' }
}

let service: AgentService
let staticDir: string
let close: () => Promise<void>
let base: string

beforeEach(async () => {
  service = {
    getStatus: vi.fn().mockResolvedValue(STATUS),
    runAction: vi.fn().mockResolvedValue({ ok: true })
  }
  staticDir = mkdtempSync(join(tmpdir(), 'bento-agent-'))
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Bento</title>')
  writeFileSync(join(staticDir, 'app.js'), 'console.log(1)')
  mkdirSync(join(staticDir, 'assets'))
  writeFileSync(join(staticDir, 'assets', 'style.css'), 'body{}')
  writeFileSync(join(tmpdir(), 'bento-agent-secret.txt'), 'secret')

  const server = createAgentServer({
    service,
    auth: { allowedLogin: LOGIN },
    staticDir
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => new Promise((resolve) => server.close(() => resolve()))
})

afterEach(async () => {
  await close()
  rmSync(staticDir, { recursive: true, force: true })
  rmSync(join(tmpdir(), 'bento-agent-secret.txt'), { force: true })
})

const authed = { 'tailscale-user-login': LOGIN }
const actionHeaders = {
  ...authed,
  host: 'bento.example.ts.net',
  origin: ORIGIN,
  'sec-fetch-site': 'same-origin',
  'content-type': 'application/json',
  'x-bento-agent': '1'
}

// `fetch` forbids setting Host, Origin and Sec-Fetch-*: use the raw client.
async function request(
  method: string,
  path: string,
  headers: Record<string, string | undefined>,
  body?: string
): Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  text: string
}> {
  const { request: send } = await import('http')
  return new Promise((resolve, reject) => {
    const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined))
    const req = send(
      `${base}${path}`,
      { method, headers: clean as Record<string, string> },
      (res) => {
        let text = ''
        res.on('data', (chunk: Buffer) => (text += chunk.toString('utf-8')))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }))
      }
    )
    req.on('error', reject)
    req.end(body)
  })
}

describe('access', () => {
  it('answers 403 without the Tailscale login, on every route', async () => {
    for (const [method, path] of [
      ['GET', '/api/status'],
      ['GET', '/'],
      ['POST', '/api/containers/action'],
      ['GET', '/nothing']
    ]) {
      const res = await request(method, path, {})
      expect(res.status).toBe(403)
    }
    expect(service.getStatus).not.toHaveBeenCalled()
    expect(service.runAction).not.toHaveBeenCalled()
  })
})

describe('GET /api/status', () => {
  it('returns the status as JSON, never cached', async () => {
    const res = await request('GET', '/api/status', authed)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(JSON.parse(res.text)).toEqual(STATUS)
  })

  it('answers 502 with a French message when bento cannot be read', async () => {
    vi.mocked(service.getStatus).mockRejectedValue(new Error('boom: internal detail'))
    const res = await request('GET', '/api/status', authed)
    expect(res.status).toBe(502)
    expect(JSON.parse(res.text)).toEqual({ error: 'Lecture de bento impossible.' })
    expect(res.text).not.toContain('boom')
  })
})

describe('POST /api/containers/action', () => {
  const send = (
    body: string,
    headers: Record<string, string | undefined> = actionHeaders
  ): ReturnType<typeof request> => request('POST', '/api/containers/action', headers, body)

  it('passes the two strings to the service and returns its result', async () => {
    vi.mocked(service.runAction).mockResolvedValue({ ok: false, error: 'Conteneur inconnu.' })
    const res = await send(JSON.stringify({ action: 'restart', container: 'jellyfin' }))
    expect(res.status).toBe(200)
    expect(JSON.parse(res.text)).toEqual({ ok: false, error: 'Conteneur inconnu.' })
    expect(service.runAction).toHaveBeenCalledExactlyOnceWith('restart', 'jellyfin')
  })

  it('refuses a request that does not come from our page, before reading the body', async () => {
    const body = JSON.stringify({ action: 'restart', container: 'jellyfin' })
    for (const headers of [
      { ...actionHeaders, 'x-bento-agent': undefined },
      { ...actionHeaders, 'sec-fetch-site': 'cross-site' },
      { ...actionHeaders, origin: 'https://evil.example' },
      { ...actionHeaders, 'content-type': 'text/plain' }
    ]) {
      const res = await send(body, headers)
      expect([403, 415]).toContain(res.status)
    }
    expect(service.runAction).not.toHaveBeenCalled()
  })

  it('answers 400 for anything but exactly {action, container} as strings', async () => {
    for (const body of [
      '',
      'not json',
      '[]',
      'null',
      '"restart"',
      '{}',
      JSON.stringify({ action: 'restart' }),
      JSON.stringify({ action: 1, container: 'jellyfin' }),
      JSON.stringify({ action: 'restart', container: 'jellyfin', command: 'reboot' })
    ]) {
      const res = await send(body)
      expect(res.status).toBe(400)
    }
    expect(service.runAction).not.toHaveBeenCalled()
  })

  it('answers 413 for a body above 1 KB', async () => {
    const res = await send(JSON.stringify({ action: 'restart', container: 'a'.repeat(2000) }))
    expect(res.status).toBe(413)
    expect(service.runAction).not.toHaveBeenCalled()
  })

  it('answers 500 with a generic message if the service throws', async () => {
    vi.mocked(service.runAction).mockRejectedValue(new Error('internal detail'))
    const res = await send(JSON.stringify({ action: 'restart', container: 'jellyfin' }))
    expect(res.status).toBe(500)
    expect(res.text).not.toContain('internal detail')
  })
})

describe('the page', () => {
  it('serves index.html at / with a strict CSP and no sniffing', async () => {
    const res = await request('GET', '/', authed)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/html/)
    expect(res.text).toContain('<title>Bento</title>')
    const csp = String(res.headers['content-security-policy'])
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).not.toMatch(/https?:|unsafe-eval|\*/)
    expect(res.headers['x-content-type-options']).toBe('nosniff')
  })

  it('serves files from the build with the right type', async () => {
    const js = await request('GET', '/app.js', authed)
    expect(js.status).toBe(200)
    expect(js.headers['content-type']).toMatch(/^text\/javascript/)
    const css = await request('GET', '/assets/style.css', authed)
    expect(css.headers['content-type']).toMatch(/^text\/css/)
  })

  it('answers 404 for unknown paths and never leaves the folder', async () => {
    for (const path of [
      '/missing',
      '/assets',
      '/../bento-agent-secret.txt',
      '/%2e%2e/bento-agent-secret.txt',
      '/..%2fbento-agent-secret.txt',
      '/assets/..%2f..%2fbento-agent-secret.txt',
      '/%00',
      '/%zz'
    ]) {
      const res = await request('GET', path, authed)
      expect([400, 404]).toContain(res.status)
      expect(res.text).not.toContain('secret')
    }
  })

  it('answers 405 for other methods', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      expect((await request(method, '/api/status', actionHeaders)).status).toBe(405)
    }
  })
})
