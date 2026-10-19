import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryPoint } from '@shared/history'
import type { BentoStatus } from '@shared/monitors'
import { createHistory } from '../src/main/history/history'
import { BUCKET_MS } from '../src/main/history/recorder'
import type { HistoryData, HistoryStore } from '../src/main/history/store'
import { disk, metrics, service, status } from './helpers/status'

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0)

let clock: number

beforeEach(() => {
  vi.useFakeTimers()
  clock = T0
})

afterEach(() => {
  vi.useRealTimers()
})

function fakeStore(initial: HistoryData = { points: [], incidents: [] }): HistoryStore & {
  saves: HistoryData[]
  syncSaves: HistoryData[]
  failNext: boolean
} {
  const store = {
    saves: [] as HistoryData[],
    syncSaves: [] as HistoryData[],
    failNext: false,
    load: async () => initial,
    save: async (data: HistoryData) => {
      if (store.failNext) {
        store.failNext = false
        throw new Error('disk full')
      }
      store.saves.push(structuredClone(data))
    },
    saveSync: (data: HistoryData) => {
      store.syncSaves.push(structuredClone(data))
    }
  }
  return store
}

/** A reading `minutes` after the start, with its own `updatedAt` as each poll has. */
const reading = (
  minutes: number,
  patch: Partial<ReturnType<typeof metrics>> = {},
  over: Partial<BentoStatus> = {}
): BentoStatus =>
  status({ updatedAt: T0 + minutes * BUCKET_MS, metrics: { ...metrics(), ...patch }, ...over })

const make = async (
  store = fakeStore()
): Promise<{ history: Awaited<ReturnType<typeof createHistory>>; store: typeof store }> => {
  const history = await createHistory({ store, now: () => clock, saveDelayMs: 60_000 })
  return { history, store }
}

const query = (
  history: Awaited<ReturnType<typeof createHistory>>
): NonNullable<ReturnType<typeof history.query>> => {
  const result = history.query('24h')
  if (!result) throw new Error('no result')
  return result
}

describe('createHistory (recording)', () => {
  it('starts with the history that was saved', async () => {
    const saved: HistoryPoint = {
      t: T0 - 10 * BUCKET_MS,
      cpu: 12,
      memory: 30,
      swap: null,
      down: null,
      up: null,
      temperature: null,
      disks: {}
    }
    const { history } = await make(fakeStore({ points: [saved], incidents: [] }))
    expect(query(history).points).toEqual([saved])
  })

  it('turns the readings of a minute into one point', async () => {
    const { history } = await make()
    history.observe(reading(0, { cpuPercent: 10, memoryUsedPercent: 40 }))
    history.observe(reading(0.5, { cpuPercent: 30, memoryUsedPercent: 60 }))
    history.observe(reading(1, { cpuPercent: 99 }))
    clock = T0 + 2 * BUCKET_MS
    expect(query(history).points).toEqual([expect.objectContaining({ t: T0, cpu: 20, memory: 50 })])
  })

  it('records swap, network, temperature and the used percentage of each disk', async () => {
    const { history } = await make()
    const full = {
      swapUsedPercent: 17,
      network: { downBytesPerSec: 2000, upBytesPerSec: 800 },
      temperatureC: 55,
      disks: [disk({ mount: '/', usedPercent: 31 }), disk({ mount: '/mnt/media', usedPercent: 83 })]
    }
    history.observe(reading(0, full))
    history.observe(reading(1, full))
    expect(query(history).points[0]).toEqual({
      t: T0,
      cpu: 5,
      memory: 20,
      swap: 17,
      down: 2000,
      up: 800,
      temperature: 55,
      disks: { '/': 31, '/mnt/media': 83 }
    })
  })

  it('counts a reading once, however often the status is published', async () => {
    const { history } = await make()
    const same = reading(0, { cpuPercent: 10 })
    history.observe(same)
    history.observe(same)
    history.observe(same)
    history.observe(reading(1, { cpuPercent: 10 }))
    expect(query(history).points[0].cpu).toBe(10)
  })

  it('records nothing while bento is unreachable: the values are the last known ones', async () => {
    const { history } = await make()
    history.observe(reading(0, {}, { connection: 'offline', overall: 'offline' }))
    history.observe(reading(1, {}, { connection: 'offline', overall: 'offline' }))
    history.observe(reading(2, {}, { connection: 'offline', overall: 'offline' }))
    expect(query(history).points).toEqual([])
  })

  it('records nothing before there is any data', async () => {
    const { history } = await make()
    history.observe(status({ updatedAt: null, metrics: null }))
    history.observe(reading(1, {}, { metrics: null }))
    expect(query(history).points).toEqual([])
  })
})

describe('createHistory (incidents)', () => {
  it('reports the incidents it saw', async () => {
    const { history } = await make()
    history.observe(
      status({ services: [service({ id: 'series', label: 'Series', level: 'down' })] })
    )
    expect(query(history).incidents).toEqual([
      expect.objectContaining({ key: 'service-down:series', subject: 'Series', endedAt: null })
    ])
  })

  it('timestamps an incident with the time it was noticed', async () => {
    const { history } = await make()
    clock = T0 + 5 * BUCKET_MS
    history.observe(status({ services: [service({ level: 'down' })] }))
    expect(query(history).incidents[0].startedAt).toBe(T0 + 5 * BUCKET_MS)
  })
})

describe('createHistory (saving)', () => {
  it('writes nothing while nothing has changed', async () => {
    const { history, store } = await make()
    history.observe(reading(0))
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(store.saves).toEqual([])
  })

  it('waits before writing, then writes once for all the changes made meanwhile', async () => {
    const { history, store } = await make()
    history.observe(reading(0))
    history.observe(reading(1)) // closes minute 0: a change
    await vi.advanceTimersByTimeAsync(30_000)
    history.observe(reading(2)) // closes minute 1: another change
    expect(store.saves).toEqual([])

    await vi.advanceTimersByTimeAsync(60_000)
    expect(store.saves).toHaveLength(1)
    expect(store.saves[0].points.map((p) => p.t)).toEqual([T0, T0 + BUCKET_MS])
  })

  it('saves the incidents too', async () => {
    const { history, store } = await make()
    history.observe(status({ services: [service({ level: 'down' })] }))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(store.saves[0].incidents).toEqual([
      expect.objectContaining({ key: 'service-down:jellyfin' })
    ])
  })

  it('writes again for a later change', async () => {
    const { history, store } = await make()
    history.observe(reading(0))
    history.observe(reading(1))
    await vi.advanceTimersByTimeAsync(60_000)
    history.observe(reading(2))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(store.saves).toHaveLength(2)
  })

  it('survives a failed write and tries again with the next change', async () => {
    const { history, store } = await make()
    store.failNext = true
    history.observe(reading(0))
    history.observe(reading(1))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(store.saves).toEqual([])

    history.observe(reading(2))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(store.saves).toHaveLength(1)
    expect(store.saves[0].points).toHaveLength(2)
  })
})

describe('createHistory (quitting)', () => {
  it('closes the minute in progress and writes synchronously', async () => {
    const { history, store } = await make()
    history.observe(reading(0, { cpuPercent: 40 }))
    history.flushSync()
    expect(store.syncSaves).toHaveLength(1)
    expect(store.syncSaves[0].points).toEqual([expect.objectContaining({ t: T0, cpu: 40 })])
  })

  it('does not write afterwards what the final write already holds', async () => {
    const { history, store } = await make()
    history.observe(reading(0))
    history.observe(reading(1))
    history.flushSync()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(store.saves).toEqual([])
  })

  it('stops its timer when disposed', async () => {
    const { history, store } = await make()
    history.observe(reading(0))
    history.observe(reading(1))
    history.dispose()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(store.saves).toEqual([])
  })
})

describe('createHistory (query)', () => {
  it('refuses a range that is not one of the fixed ones', async () => {
    const { history } = await make()
    for (const bad of ['30d', '', 'constructor', null, undefined, 7, { evil: true }]) {
      expect(history.query(bad)).toBeNull()
    }
  })

  it('answers with the range, the points, the incidents and the time it was cut at', async () => {
    const { history } = await make()
    clock = T0 + 90 * 60_000
    expect(history.query('1h')).toEqual({ range: '1h', points: [], incidents: [], now: clock })
  })
})
