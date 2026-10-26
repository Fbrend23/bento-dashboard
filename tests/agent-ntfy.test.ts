import { describe, expect, it, vi } from 'vitest'
import { createNtfySender, toNtfyPayload } from '../src/agent/ntfy'

const TOPIC = 'homelab-3f9a1c7e5b2d40f6a8c1'
const down = { id: 'down:jellyfin', title: "Jellyfin est à l'arrêt", body: 'Exited (1).' }
const up = { id: 'up:jellyfin', title: 'Jellyfin est de nouveau actif', body: 'Up 3 seconds.' }

const ok = (): Response => new Response(null, { status: 200 })

describe('toNtfyPayload', () => {
  it('makes a problem urgent and a recovery quiet', () => {
    const problem = toNtfyPayload(down, TOPIC)
    const recovery = toNtfyPayload(up, TOPIC)
    expect(problem.priority).toBe(4)
    expect(problem.tags).toEqual(['rotating_light'])
    expect(recovery.priority).toBe(2)
    expect(recovery.tags).toEqual(['white_check_mark'])
  })

  it('treats healthy and disk-ok as recoveries, and a report as neither', () => {
    expect(toNtfyPayload({ id: 'healthy:radarr', title: 't', body: 'b' }, TOPIC).priority).toBe(2)
    expect(toNtfyPayload({ id: 'disk-ok:/', title: 't', body: 'b' }, TOPIC).priority).toBe(2)
    expect(toNtfyPayload({ id: 'info:radarr', title: 't', body: 'b' }, TOPIC).priority).toBe(3)
  })

  it('lets the notification choose its own priority and tags', () => {
    const payload = toNtfyPayload(
      { id: 'info:script', title: 't', body: 'b', priority: 'high', tags: ['floppy_disk'] },
      TOPIC
    )
    expect(payload.priority).toBe(4)
    expect(payload.tags).toEqual(['floppy_disk'])
  })

  it('keeps the accents of the title, which the JSON body carries', () => {
    expect(toNtfyPayload(down, TOPIC).title).toBe("Jellyfin est à l'arrêt")
  })

  it('replaces a relative duration by the time of the event', () => {
    const at = new Date(2026, 9, 20, 13, 5, 7).getTime()
    const stopped = toNtfyPayload(
      { id: 'down:app-1', title: 'x', body: 'Arrêté (code 1) il y a 3 secondes.' },
      TOPIC,
      at
    )
    expect(stopped.message).toBe('Arrêté (code 1) à 13:05:07.')
    const back = toNtfyPayload(
      { id: 'up:app-1', title: 'x', body: 'Actif depuis 4 secondes.' },
      TOPIC,
      at
    )
    expect(back.message).toBe('Revenu à 13:05:07.')
  })

  it('cuts a message that is too long', () => {
    const payload = toNtfyPayload(
      { id: 'down:a', title: 'x'.repeat(500), body: 'y'.repeat(9000) },
      TOPIC
    )
    expect(payload.title.length).toBeLessThanOrEqual(250)
    expect(payload.message.length).toBeLessThanOrEqual(3500)
  })
})

describe('createNtfySender', () => {
  it('posts the JSON to the public server by default', async () => {
    const fetch = vi.fn().mockResolvedValue(ok())
    await createNtfySender({ topic: TOPIC, fetch }).send(down)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ntfy.sh')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({ topic: TOPIC, priority: 4 })
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('uses the configured server and sends the token as a bearer', async () => {
    const fetch = vi.fn().mockResolvedValue(ok())
    await createNtfySender({
      topic: TOPIC,
      url: 'https://ntfy.example.com',
      token: 'tk_abcdefgh12',
      fetch
    }).send(down)
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://ntfy.example.com')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tk_abcdefgh12')
  })

  it('waits as told and retries once when rate limited', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(ok())
    const sleep = vi.fn().mockResolvedValue(undefined)
    const log = vi.fn()
    await createNtfySender({ topic: TOPIC, fetch, sleep, log }).send(down)
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(log).not.toHaveBeenCalled()
  })

  it('does not retry a second time', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 429 }))
    const log = vi.fn()
    await createNtfySender({ topic: TOPIC, fetch, sleep: async () => {}, log }).send(down)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith('ntfy: message not delivered (HTTP 429)')
  })

  it('never rejects and never logs the topic or the token', async () => {
    const log = vi.fn()
    const failing = vi.fn().mockRejectedValue(new Error(`boom ${TOPIC} tk_abcdefgh12`))
    await expect(
      createNtfySender({ topic: TOPIC, token: 'tk_abcdefgh12', fetch: failing, log }).send(down)
    ).resolves.toBeUndefined()
    const refused = vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
    await createNtfySender({ topic: TOPIC, token: 'tk_abcdefgh12', fetch: refused, log }).send(down)
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).toContain('network error')
    expect(logged).toContain('HTTP 403')
    expect(logged).not.toContain(TOPIC)
    expect(logged).not.toContain('tk_abcdefgh12')
  })

  it('delivers in order', async () => {
    const seen: string[] = []
    const fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      seen.push((JSON.parse(init.body as string) as { title: string }).title)
      return ok()
    })
    const sender = createNtfySender({ topic: TOPIC, fetch })
    void sender.send({ id: 'down:a', title: 'first', body: '.' })
    await sender.send({ id: 'down:b', title: 'second', body: '.' })
    expect(seen).toEqual(['first', 'second'])
  })
})
