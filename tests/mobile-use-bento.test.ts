import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatus } from '../src/shared/agent'
import type { ContainerActionResult } from '../src/shared/actions'
import type { AgentApi, StatusResult } from '../src/mobile/src/api'
import { REFRESH_INTERVAL_MS, useBento } from '../src/mobile/src/use-bento'
import { metrics } from './helpers/status'

const status = (updatedAt: number): AgentStatus => ({
  updatedAt,
  services: [],
  stackLabels: {},
  metrics: metrics()
})

let api: AgentApi
let getStatus: ReturnType<typeof vi.fn<() => Promise<StatusResult>>>
let runAction: ReturnType<typeof vi.fn<AgentApi['runAction']>>

beforeEach(() => {
  vi.useFakeTimers()
  getStatus = vi
    .fn<() => Promise<StatusResult>>()
    .mockResolvedValue({ ok: true, status: status(1) })
  runAction = vi.fn<AgentApi['runAction']>().mockResolvedValue({ ok: true })
  api = { getStatus, runAction }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('refresh', () => {
  it('stores the status and clears the error', async () => {
    const bento = useBento(api)
    await bento.refresh()
    expect(bento.status.value).toEqual(status(1))
    expect(bento.error.value).toBeNull()
    expect(bento.loading.value).toBe(false)
  })

  it('keeps the last status when a refresh fails, and shows the error', async () => {
    const bento = useBento(api)
    await bento.refresh()
    getStatus.mockResolvedValue({ ok: false, error: 'Bento est injoignable.' })
    await bento.refresh()
    expect(bento.status.value).toEqual(status(1))
    expect(bento.error.value).toBe('Bento est injoignable.')
  })

  it("remembers when the phone last read bento, on the phone's own clock", async () => {
    vi.setSystemTime(new Date('2026-10-19T10:00:00Z'))
    const bento = useBento(api)
    expect(bento.fetchedAt.value).toBeNull()
    await bento.refresh()
    expect(bento.fetchedAt.value).toBe(Date.parse('2026-10-19T10:00:00Z'))
    vi.setSystemTime(new Date('2026-10-19T10:05:00Z'))
    getStatus.mockResolvedValue({ ok: false, error: 'Bento est injoignable.' })
    await bento.refresh()
    expect(bento.fetchedAt.value).toBe(Date.parse('2026-10-19T10:00:00Z'))
  })

  it('recovers when the next refresh works', async () => {
    getStatus.mockResolvedValueOnce({ ok: false, error: 'Bento est injoignable.' })
    const bento = useBento(api)
    await bento.refresh()
    expect(bento.status.value).toBeNull()
    await bento.refresh()
    expect(bento.error.value).toBeNull()
    expect(bento.status.value).toEqual(status(1))
  })

  it('does not stack requests: a refresh in progress is shared', async () => {
    const bento = useBento(api)
    await Promise.all([bento.refresh(), bento.refresh(), bento.refresh()])
    expect(getStatus).toHaveBeenCalledOnce()
  })
})

describe('polling', () => {
  it('reads now, then at the interval, until stopped', async () => {
    const bento = useBento(api)
    bento.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(getStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
    expect(getStatus).toHaveBeenCalledTimes(2)
    bento.stop()
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3)
    expect(getStatus).toHaveBeenCalledTimes(2)
  })

  it('start() twice does not double the polling', async () => {
    const bento = useBento(api)
    bento.start()
    bento.start()
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
    expect(getStatus).toHaveBeenCalledTimes(2)
    bento.stop()
  })
})

describe('run', () => {
  it('sends the action, then reads bento again', async () => {
    const bento = useBento(api)
    await bento.run('restart', 'jellyfin')
    expect(runAction).toHaveBeenCalledExactlyOnceWith('restart', 'jellyfin')
    expect(getStatus).toHaveBeenCalledOnce()
    expect(bento.actionError.value).toBeNull()
    expect(bento.busy.value).toBeNull()
  })

  it('is busy while the action runs and refuses a second one', async () => {
    let finish: (result: ContainerActionResult) => void = () => {}
    runAction.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const bento = useBento(api)
    const first = bento.run('restart', 'jellyfin')
    expect(bento.busy.value).toEqual({ action: 'restart', container: 'jellyfin' })
    await bento.run('stop', 'other')
    expect(runAction).toHaveBeenCalledOnce()
    finish({ ok: true })
    await first
    expect(bento.busy.value).toBeNull()
  })

  it('shows the failure for that container, and still refreshes', async () => {
    runAction.mockResolvedValue({ ok: false, error: 'Conteneur introuvable sur bento.' })
    const bento = useBento(api)
    await bento.run('start', 'jellyfin')
    expect(bento.actionError.value).toEqual({
      container: 'jellyfin',
      message: 'Conteneur introuvable sur bento.'
    })
    expect(getStatus).toHaveBeenCalledOnce()
  })

  it('clears the previous failure when a new action starts', async () => {
    runAction.mockResolvedValueOnce({ ok: false, error: 'Non.' })
    const bento = useBento(api)
    await bento.run('start', 'jellyfin')
    await bento.run('start', 'jellyfin')
    expect(bento.actionError.value).toBeNull()
  })

  it('turns an unexpected exception into a French message', async () => {
    runAction.mockRejectedValue(new Error('boom'))
    const bento = useBento(api)
    await bento.run('stop', 'jellyfin')
    expect(bento.actionError.value).toEqual({
      container: 'jellyfin',
      message: "L'arrêt a échoué."
    })
    expect(bento.busy.value).toBeNull()
  })
})
