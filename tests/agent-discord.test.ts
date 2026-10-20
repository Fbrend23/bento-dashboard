import { describe, expect, it, vi } from 'vitest'
import { createDiscordSender, toDiscordPayload } from '../src/agent/discord'

const URL = 'https://discord.com/api/webhooks/123456789/secret-token_1'
const down = { id: 'down:jellyfin', title: "Jellyfin est à l'arrêt", body: 'Exited (1).' }
const up = { id: 'up:jellyfin', title: 'Jellyfin est de nouveau actif', body: 'Up 3 seconds.' }

const ok = (): Response => new Response(null, { status: 204 })

describe('toDiscordPayload', () => {
  it('builds a red embed for a problem and a green one for a recovery', () => {
    const red = toDiscordPayload(down)
    const green = toDiscordPayload(up)
    expect(red.embeds[0].color).not.toBe(green.embeds[0].color)
    expect(red.embeds[0].title).toBe("Jellyfin est à l'arrêt")
    expect(red.embeds[0].description).toBe('Exited (1).')
  })

  it('never lets a message mention anyone', () => {
    const payload = toDiscordPayload({
      ...down,
      title: '@everyone <@123> @here',
      body: '@everyone'
    })
    expect(payload.allowed_mentions).toEqual({ parse: [] })
  })

  it('mentions the configured user on a problem only, and nobody else', () => {
    const id = '123456789012345678'
    const red = toDiscordPayload(down, id)
    expect(red.content).toBe(`<@${id}>`)
    expect(red.allowed_mentions).toEqual({ parse: [], users: [id] })
    const green = toDiscordPayload(up, id)
    expect(green.content).toBeUndefined()
    expect(green.allowed_mentions).toEqual({ parse: [] })
  })

  it('does not mention anyone without a configured user', () => {
    expect(toDiscordPayload(down).content).toBeUndefined()
  })

  it('replaces a relative duration by the time of the event, shown in the reader time zone', () => {
    const at = Date.UTC(2026, 9, 20, 13, 5, 7)
    const unix = Math.floor(at / 1000)
    const stopped = toDiscordPayload(
      { id: 'down:app-1', title: 'App est arrêtée', body: 'Arrêté (code 1) il y a 3 secondes.' },
      undefined,
      at
    )
    expect(stopped.embeds[0].description).toBe(`Arrêté (code 1) à <t:${unix}:T>.`)
    const looping = toDiscordPayload(
      {
        id: 'down:app-1',
        title: 'x',
        body: 'Redémarre en boucle (code 2) il y a environ 1 minute.'
      },
      undefined,
      at
    )
    expect(looping.embeds[0].description).toBe(`Redémarre en boucle (code 2) à <t:${unix}:T>.`)
    const back = toDiscordPayload(
      { id: 'up:app-1', title: 'x', body: 'Actif depuis 4 secondes, sain.' },
      undefined,
      at
    )
    expect(back.embeds[0].description).toBe(`Revenu à <t:${unix}:T>, sain.`)
  })

  it('always carries the event time in the embed timestamp', () => {
    const at = Date.UTC(2026, 9, 20, 13, 5, 7)
    const payload = toDiscordPayload(
      { id: 'down:tailscaled.service', title: 'x', body: 'inactif (arrêté).' },
      undefined,
      at
    )
    expect(payload.embeds[0].timestamp).toBe('2026-10-20T13:05:07.000Z')
    expect(payload.embeds[0].description).toBe('inactif (arrêté).')
  })

  it('escapes Markdown and truncates long text', () => {
    const payload = toDiscordPayload({
      id: 'down:x',
      title: 'a*b_c`d~e|f>g',
      body: 'x'.repeat(5000)
    })
    expect(payload.embeds[0].title).toBe('a\\*b\\_c\\`d\\~e\\|f\\>g')
    expect(payload.embeds[0].description.length).toBeLessThanOrEqual(2000)
    expect(payload.embeds[0].title.length).toBeLessThanOrEqual(256)
  })
})

describe('createDiscordSender', () => {
  it('posts JSON to the webhook with a timeout', async () => {
    const fetch = vi.fn().mockResolvedValue(ok())
    const sender = createDiscordSender({ url: URL, fetch, log: vi.fn() })
    await sender.send(down)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe(URL)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(init.body as string)).toMatchObject({ username: 'bento' })
  })

  it('sends the mention of the configured user', async () => {
    const fetch = vi.fn().mockResolvedValue(ok())
    const sender = createDiscordSender({
      url: URL,
      mentionUserId: '123456789012345678',
      fetch,
      log: vi.fn()
    })
    await sender.send(down)
    const body = JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).toMatchObject({ content: '<@123456789012345678>' })
  })

  it('stamps a message with the time it was handed over, not the time it was delivered', async () => {
    const fetch = vi.fn().mockResolvedValue(ok())
    const sender = createDiscordSender({
      url: URL,
      fetch,
      log: vi.fn(),
      now: () => 1_800_000_000_000
    })
    await sender.send(down)
    const body = JSON.parse((fetch.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body.embeds[0].timestamp).toBe(new Date(1_800_000_000_000).toISOString())
  })

  it('sends messages one after the other, in order', async () => {
    const order: string[] = []
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const title = (JSON.parse(init?.body as string) as { embeds: { title: string }[] }).embeds[0]
        .title
      order.push(`start:${title}`)
      await new Promise((r) => setTimeout(r, 5))
      order.push(`end:${title}`)
      return ok()
    })
    const sender = createDiscordSender({ url: URL, fetch, log: vi.fn() })
    await Promise.all([sender.send(down), sender.send(up)])
    expect(order[1]).toMatch(/^end:/)
    expect(order).toHaveLength(4)
  })

  it('retries once after a 429, waiting retry_after (capped)', async () => {
    const waits: number[] = []
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 }))
      .mockResolvedValueOnce(ok())
    const sender = createDiscordSender({
      url: URL,
      fetch,
      log: vi.fn(),
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      }
    })
    await sender.send(down)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(waits).toEqual([1500])
  })

  it('caps a very long retry_after and gives up after one retry', async () => {
    const waits: number[] = []
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ retry_after: 9999 }), { status: 429 }))
    const sender = createDiscordSender({
      url: URL,
      fetch,
      log: vi.fn(),
      sleep: (ms) => {
        waits.push(ms)
        return Promise.resolve()
      }
    })
    await sender.send(down)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(waits[0]).toBeLessThanOrEqual(10_000)
  })

  it('never throws and never logs the url, on a network error or a refusal', async () => {
    const log = vi.fn()
    const failing = createDiscordSender({
      url: URL,
      fetch: vi.fn().mockRejectedValue(new Error(`connect failed to ${URL}`)),
      log
    })
    await expect(failing.send(down)).resolves.toBeUndefined()
    const refused = createDiscordSender({
      url: URL,
      fetch: vi.fn().mockResolvedValue(new Response('nope', { status: 401 })),
      log
    })
    await expect(refused.send(down)).resolves.toBeUndefined()
    expect(log).toHaveBeenCalled()
    for (const call of log.mock.calls) {
      expect(String(call[0])).not.toContain('secret-token')
      expect(String(call[0])).not.toContain(URL)
    }
  })

  it('keeps sending after a failure', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(ok())
    const sender = createDiscordSender({ url: URL, fetch, log: vi.fn() })
    await sender.send(down)
    await sender.send(up)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
