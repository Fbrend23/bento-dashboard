import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryRange, HistoryResult } from '../src/shared/history'
import type { HistoryApi, HistoryReply } from '../src/mobile/src/api'
import { HISTORY_REFRESH_MS, useHistory } from '../src/mobile/src/use-history'

const result = (range: HistoryRange, now = 1): HistoryResult => ({
  range,
  points: [],
  incidents: [],
  now
})

let getHistory: ReturnType<typeof vi.fn<HistoryApi['getHistory']>>

beforeEach(() => {
  vi.useFakeTimers()
  getHistory = vi
    .fn<HistoryApi['getHistory']>()
    .mockImplementation((range) => Promise.resolve({ ok: true, result: result(range) }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('load', () => {
  it('starts on the last 24 hours and stores the result', async () => {
    const history = useHistory({ getHistory })
    expect(history.range.value).toBe('24h')
    await history.load()
    expect(getHistory).toHaveBeenCalledWith('24h')
    expect(history.result.value).toEqual(result('24h'))
    expect(history.error.value).toBeNull()
    expect(history.loading.value).toBe(false)
  })

  it('keeps the last charts when a read fails, and shows the error', async () => {
    const history = useHistory({ getHistory })
    await history.load()
    getHistory.mockResolvedValue({ ok: false, error: 'Bento est injoignable.' })
    await history.load()
    expect(history.result.value).toEqual(result('24h'))
    expect(history.error.value).toBe('Bento est injoignable.')
  })

  it('shares one read between simultaneous calls', async () => {
    const history = useHistory({ getHistory })
    await Promise.all([history.load(), history.load()])
    expect(getHistory).toHaveBeenCalledOnce()
  })
})

describe('setRange', () => {
  it('reads the new range and drops the charts of the old one', async () => {
    const history = useHistory({ getHistory })
    await history.load()
    const reading = history.setRange('7d')
    expect(history.range.value).toBe('7d')
    expect(history.result.value).toBeNull()
    await reading
    expect(history.result.value).toEqual(result('7d'))
  })

  it('ignores an answer that arrives for a range no longer selected', async () => {
    let release!: (value: HistoryReply) => void
    getHistory.mockImplementationOnce(
      () => new Promise<HistoryReply>((resolve) => (release = resolve))
    )
    const history = useHistory({ getHistory })
    const slow = history.load()
    const fast = history.setRange('1h')
    release({ ok: true, result: result('24h') })
    await Promise.all([slow, fast])
    expect(history.range.value).toBe('1h')
    expect(history.result.value).toEqual(result('1h'))
  })

  it('does nothing when the range is already selected', async () => {
    const history = useHistory({ getHistory })
    await history.setRange('24h')
    expect(getHistory).not.toHaveBeenCalled()
  })
})

describe('start and stop', () => {
  it('reads at once, then every 30 seconds, until stopped', async () => {
    const history = useHistory({ getHistory })
    history.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(getHistory).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(HISTORY_REFRESH_MS)
    expect(getHistory).toHaveBeenCalledTimes(2)
    history.stop()
    await vi.advanceTimersByTimeAsync(HISTORY_REFRESH_MS * 3)
    expect(getHistory).toHaveBeenCalledTimes(2)
  })

  it('does not start twice', async () => {
    const history = useHistory({ getHistory })
    history.start()
    history.start()
    await vi.advanceTimersByTimeAsync(HISTORY_REFRESH_MS)
    expect(getHistory).toHaveBeenCalledTimes(2)
    history.stop()
  })
})
