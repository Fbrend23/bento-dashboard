import { readFileSync } from 'fs'
import type { AddressInfo } from 'net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fromJellyseerr, fromNotifyBody, fromRadarr, fromSonarr } from '../src/agent/notify-hooks'
import { createNotifyServer, MAX_NOTIFY_BODY_BYTES, NOTIFY_PATHS } from '../src/agent/notify-server'
import type { OutboundNotification } from '../src/agent/notification'

const TOKEN = 'a1b2c3d4'.repeat(4)
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(`tests/fixtures/${name}`, 'utf-8')) as unknown

describe('the hook parsers', () => {
  it('turns a script body into an info message', () => {
    expect(fromNotifyBody({ title: 'Backup', body: 'fait' })).toMatchObject({
      id: 'info:script',
      title: 'Backup',
      body: 'fait',
      priority: 'default'
    })
  })

  it('makes a failure marked with a cross urgent', () => {
    expect(fromNotifyBody({ title: '❌ Backup raté', body: 'ligne 12' })).toMatchObject({
      priority: 'high',
      tags: ['rotating_light']
    })
  })

  it('refuses a script body that is not a title, a body and a known priority', () => {
    for (const value of [
      null,
      [],
      'text',
      {},
      { title: 'x' },
      { title: '', body: 'x' },
      { title: 'x', body: 'y', priority: 'urgent' },
      { title: 3, body: 'y' }
    ]) {
      expect(fromNotifyBody(value)).toBeNull()
    }
  })

  it('announces the episodes Sonarr imported', () => {
    const out = fromSonarr(fixture('hook-sonarr-download.json')) as OutboundNotification
    expect(out.title).toBe('📺 Severance est disponible')
    expect(out.body).toBe("S02E03 · Who Is Alive?\nS02E04 · Woe's Hollow")
  })

  it('announces the film Radarr imported, and says when it is a better version', () => {
    const payload = fixture('hook-radarr-download.json') as Record<string, unknown>
    expect((fromRadarr(payload) as OutboundNotification).title).toBe(
      '🎬 Dune: Part Two (2024) est disponible'
    )
    expect((fromRadarr({ ...payload, isUpgrade: true }) as OutboundNotification).title).toBe(
      '🎬 Dune: Part Two (2024) : meilleure version'
    )
  })

  it('names who asked for what Jellyseerr made available', () => {
    const out = fromJellyseerr(fixture('hook-jellyseerr-available.json')) as OutboundNotification
    expect(out.title).toBe('🍿 Dune: Part Two (2024) est disponible')
    expect(out.body).toContain('pour Tessie')
  })

  it('answers the test button of each app, and ignores the other events', () => {
    for (const result of [
      fromSonarr({ eventType: 'Test' }),
      fromRadarr({ eventType: 'Test' }),
      fromJellyseerr({ notification_type: 'TEST_NOTIFICATION' })
    ]) {
      expect(result).toMatchObject({ title: 'Test réussi' })
    }
    expect(fromSonarr({ eventType: 'Grab' })).toBe('ignore')
    expect(fromRadarr({ eventType: 'Rename' })).toBe('ignore')
    expect(fromJellyseerr({ notification_type: 'MEDIA_PENDING' })).toBe('ignore')
  })

  it('refuses a payload that is not the shape of the app', () => {
    for (const parse of [fromSonarr, fromRadarr, fromJellyseerr]) {
      expect(parse(null)).toBeNull()
      expect(parse('x')).toBeNull()
      expect(parse({})).toBeNull()
    }
    expect(fromSonarr({ eventType: 'Download', series: {} })).toBeNull()
    expect(fromRadarr({ eventType: 'Download' })).toBeNull()
  })
})

describe('the notify server', () => {
  const open: { close: () => void }[] = []
  afterEach(() => {
    while (open.length > 0) open.pop()?.close()
  })

  async function start(): Promise<{
    url: string
    send: ReturnType<typeof vi.fn>
    log: ReturnType<typeof vi.fn>
  }> {
    const send = vi.fn()
    const log = vi.fn()
    const server = createNotifyServer({ token: TOKEN, send, log })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    open.push(server)
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, send, log }
  }

  const post = (
    url: string,
    path: string,
    body: unknown,
    headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` }
  ): Promise<Response> =>
    fetch(url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body)
    })

  it('sends a script message to the senders', async () => {
    const { url, send } = await start()
    const response = await post(url, NOTIFY_PATHS.notify, { title: 'Backup', body: 'fait' })
    expect(response.status).toBe(204)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0]).toMatchObject({ title: 'Backup', body: 'fait' })
  })

  it('sends what Sonarr, Radarr and Jellyseerr post', async () => {
    const { url, send } = await start()
    expect(
      (await post(url, NOTIFY_PATHS.sonarr, fixture('hook-sonarr-download.json'))).status
    ).toBe(204)
    expect(
      (await post(url, NOTIFY_PATHS.radarr, fixture('hook-radarr-download.json'))).status
    ).toBe(204)
    expect(
      (await post(url, NOTIFY_PATHS.jellyseerr, fixture('hook-jellyseerr-available.json'))).status
    ).toBe(204)
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('answers 204 to an event it ignores, without sending anything', async () => {
    const { url, send } = await start()
    expect((await post(url, NOTIFY_PATHS.sonarr, { eventType: 'Grab' })).status).toBe(204)
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a missing, wrong or malformed token with 401, and says so in the log without it', async () => {
    const { url, send, log } = await start()
    const body = { title: 'x', body: 'y' }
    expect((await post(url, NOTIFY_PATHS.notify, body, {})).status).toBe(401)
    expect(
      (await post(url, NOTIFY_PATHS.notify, body, { Authorization: 'Bearer nope' })).status
    ).toBe(401)
    expect((await post(url, NOTIFY_PATHS.notify, body, { Authorization: TOKEN })).status).toBe(401)
    expect(
      (await post(url, NOTIFY_PATHS.notify, body, { Authorization: `Basic ${TOKEN}` })).status
    ).toBe(401)
    expect(send).not.toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN)
  })

  it('refuses a request that came through tailscale serve, even with the token', async () => {
    const { url, send } = await start()
    const response = await post(
      url,
      NOTIFY_PATHS.notify,
      { title: 'x', body: 'y' },
      { Authorization: `Bearer ${TOKEN}`, 'Tailscale-User-Login': 'owner@example.com' }
    )
    expect(response.status).toBe(403)
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a body above the limit with 413', async () => {
    const { url, send } = await start()
    const big = JSON.stringify({ title: 'x', body: 'y'.repeat(MAX_NOTIFY_BODY_BYTES) })
    const response = await post(url, NOTIFY_PATHS.notify, big)
    expect(response.status).toBe(413)
    expect(send).not.toHaveBeenCalled()
  })

  it('answers 400 to invalid JSON or an unknown shape, 404 to another path, 405 to a GET', async () => {
    const { url, send } = await start()
    expect((await post(url, NOTIFY_PATHS.notify, '{not json')).status).toBe(400)
    expect((await post(url, NOTIFY_PATHS.notify, { title: 'x' })).status).toBe(400)
    expect((await post(url, '/api/status', {})).status).toBe(404)
    const get = await fetch(url + NOTIFY_PATHS.notify, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    })
    expect(get.status).toBe(405)
    expect(get.headers.get('Allow')).toBe('POST')
    expect(send).not.toHaveBeenCalled()
  })
})
