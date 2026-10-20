import { describe, expect, it, vi } from 'vitest'
import type { AgentStatus } from '../src/shared/agent'
import { createAgentApi } from '../src/mobile/src/api'
import { metrics } from './helpers/status'

const STATUS: AgentStatus = { updatedAt: 1, services: [], stackLabels: {}, metrics: metrics() }

const reply = (status: number, body: unknown): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

const apiWith = (fetchFn: typeof fetch): ReturnType<typeof createAgentApi> =>
  createAgentApi(fetchFn)

describe('getStatus', () => {
  it('asks the status route without any cache and returns the parsed status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(200, STATUS))
    await expect(apiWith(fetchFn).getStatus()).resolves.toEqual({ ok: true, status: STATUS })
    expect(fetchFn).toHaveBeenCalledOnce()
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('/api/status')
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' })
  })

  it('says bento is unreachable when the network fails', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(apiWith(fetchFn).getStatus()).resolves.toEqual({
      ok: false,
      error: 'Bento est injoignable.'
    })
  })

  it('explains a refusal in French', async () => {
    const result = await apiWith(
      vi.fn().mockResolvedValue(reply(403, { error: 'Accès refusé.' }))
    ).getStatus()
    expect(result).toEqual({
      ok: false,
      error: "Ce téléphone n'est pas autorisé à utiliser l'agent."
    })
  })

  it("shows the agent's own message when it cannot read bento", async () => {
    const result = await apiWith(
      vi.fn().mockResolvedValue(reply(502, { error: 'Lecture de bento impossible.' }))
    ).getStatus()
    expect(result).toEqual({ ok: false, error: 'Lecture de bento impossible.' })
  })

  it('rejects an answer that is not a status', async () => {
    for (const body of [
      '<html>',
      '{}',
      '[]',
      'null',
      { updatedAt: 'x', services: [], stackLabels: {}, metrics: metrics() },
      { updatedAt: 1, services: [], stackLabels: {} }
    ]) {
      const result = await apiWith(vi.fn().mockResolvedValue(reply(200, body))).getStatus()
      expect(result).toEqual({ ok: false, error: "Réponse inattendue de l'agent." })
    }
  })
})

describe('runAction', () => {
  it('posts exactly the action and the container, with the headers the agent requires', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(200, { ok: true }))
    await expect(apiWith(fetchFn).runAction('restart', 'jellyfin')).resolves.toEqual({ ok: true })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('/api/containers/action')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Bento-Agent': '1'
    })
    expect(JSON.parse(init.body)).toEqual({ action: 'restart', container: 'jellyfin' })
    expect(init.credentials).toBe('same-origin')
  })

  it('relays a failure reported by the agent', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(reply(200, { ok: false, error: 'Conteneur inconnu.' }))
    await expect(apiWith(fetchFn).runAction('stop', 'x')).resolves.toEqual({
      ok: false,
      error: 'Conteneur inconnu.'
    })
  })

  it('says bento is unreachable when the network fails', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(apiWith(fetchFn).runAction('start', 'x')).resolves.toEqual({
      ok: false,
      error: 'Bento est injoignable.'
    })
  })

  it('turns a refusal or an odd answer into a French error', async () => {
    const forbidden = await apiWith(vi.fn().mockResolvedValue(reply(403, {}))).runAction(
      'stop',
      'x'
    )
    expect(forbidden).toEqual({
      ok: false,
      error: "Ce téléphone n'est pas autorisé à utiliser l'agent."
    })
    for (const response of [
      reply(400, {}),
      reply(500, 'oops'),
      reply(200, '{}'),
      reply(200, 'nope')
    ]) {
      const result = await apiWith(vi.fn().mockResolvedValue(response)).runAction('stop', 'x')
      expect(result.ok).toBe(false)
      expect('error' in result && result.error).toMatch(/\S/)
    }
  })
})

describe('getHistory', () => {
  const RESULT = {
    range: '24h',
    points: [
      {
        t: 1,
        cpu: 12,
        memory: 40,
        swap: null,
        down: 0,
        up: 0,
        temperature: null,
        disks: { '/': 50 }
      }
    ],
    incidents: [
      {
        key: 'service-down:app-1',
        kind: 'service-down',
        subject: 'App',
        startedAt: 1,
        endedAt: null
      }
    ],
    now: 2
  }

  it('asks the history route for one fixed range, without any cache', async () => {
    const fetchFn = vi.fn().mockResolvedValue(reply(200, RESULT))
    await expect(apiWith(fetchFn).getHistory('24h')).resolves.toEqual({ ok: true, result: RESULT })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('/api/history?range=24h')
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' })
  })

  it('says bento is unreachable when the network fails', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(apiWith(fetchFn).getHistory('1h')).resolves.toEqual({
      ok: false,
      error: 'Bento est injoignable.'
    })
  })

  it('explains a refusal in French', async () => {
    const result = await apiWith(
      vi.fn().mockResolvedValue(reply(403, { error: 'Accès refusé.' }))
    ).getHistory('1h')
    expect(result).toEqual({
      ok: false,
      error: "Ce téléphone n'est pas autorisé à utiliser l'agent."
    })
  })

  it("shows the agent's own message when the history is unavailable", async () => {
    const result = await apiWith(
      vi.fn().mockResolvedValue(reply(500, { error: "L'historique est indisponible." }))
    ).getHistory('1h')
    expect(result).toEqual({ ok: false, error: "L'historique est indisponible." })
  })

  it('rejects an answer that is not a history', async () => {
    for (const body of [
      '<html>',
      '{}',
      'null',
      { ...RESULT, range: '30d' },
      { ...RESULT, points: {} },
      { ...RESULT, points: [null] },
      { ...RESULT, points: [{ t: 'x' }] },
      { ...RESULT, incidents: [{ key: 1 }] },
      { ...RESULT, now: 'x' }
    ]) {
      const result = await apiWith(vi.fn().mockResolvedValue(reply(200, body))).getHistory('24h')
      expect(result).toEqual({ ok: false, error: "Réponse inattendue de l'agent." })
    }
  })
})
