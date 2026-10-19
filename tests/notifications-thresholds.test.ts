import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { NotificationTracker } from '../src/main/notifications/tracker'
import { metrics, status } from './helpers/status'

const NBSP = ' '
const settings = { ...DEFAULT_SETTINGS } // cpu 90 %, memory 90 %, 3 readings, load off

let tracker: NotificationTracker
let tick = 0

beforeEach(() => {
  tracker = new NotificationTracker()
  tick = 0
})

/** A new reading: each call has its own `updatedAt`, as each poll has. */
const reading = (patch: Partial<ReturnType<typeof metrics>>): ReturnType<typeof status> => {
  tick += 1
  return status({ updatedAt: tick * 30_000, metrics: { ...metrics(), ...patch } })
}

const cpu = (value: number | null): ReturnType<typeof status> => reading({ cpuPercent: value })

const feed = (
  s: typeof settings,
  statuses: ReturnType<typeof status>[]
): ReturnType<NotificationTracker['update']>[] =>
  statuses.map((st, i) => tracker.update(st, s, i * 30_000))

describe('sustained cpu', () => {
  it('notifies on the third consecutive reading above the threshold, and only then', () => {
    const results = feed(settings, [cpu(95), cpu(96), cpu(97), cpu(98)])
    expect(results[0]).toEqual([])
    expect(results[1]).toEqual([])
    expect(results[2]).toEqual([
      {
        id: 'cpu',
        title: 'Processeur très sollicité',
        body: `97${NBSP}% sur les 3 derniers relevés, seuil d'alerte à 90${NBSP}%.`
      }
    ])
    expect(results[3]).toEqual([])
  })

  it('does not count the same reading twice (the notifier also ticks between polls)', () => {
    const same = cpu(95)
    expect(tracker.update(same, settings, 0)).toEqual([])
    expect(tracker.update(same, settings, 15_000)).toEqual([])
    expect(tracker.update(same, settings, 30_000)).toEqual([])
    expect(tracker.update(same, settings, 45_000)).toEqual([])
  })

  it('starts counting again after a reading at or below the threshold', () => {
    const results = feed(settings, [cpu(95), cpu(96), cpu(90), cpu(95), cpu(96)])
    expect(results.every((r) => r.length === 0)).toBe(true)
  })

  it('needs a reading strictly above the threshold', () => {
    const results = feed(settings, [cpu(90), cpu(90), cpu(90), cpu(90)])
    expect(results.every((r) => r.length === 0)).toBe(true)
  })

  it('ignores an unknown reading: it neither counts nor resets', () => {
    const results = feed(settings, [cpu(95), cpu(null), cpu(96), cpu(97)])
    expect(results[3]).toHaveLength(1)
  })

  it('can be switched off', () => {
    const off = { ...settings, notifyCpu: false }
    expect(feed(off, [cpu(99), cpu(99), cpu(99), cpu(99)]).flat()).toEqual([])
  })

  it('follows the configured threshold and number of readings', () => {
    const custom = { ...settings, cpuThresholdPercent: 60, sustainedSamples: 2 }
    const results = feed(custom, [cpu(65), cpu(70)])
    expect(results[1]).toHaveLength(1)
    expect(results[1][0].body).toContain(`60${NBSP}%`)
  })

  it('notifies at once with a single required reading', () => {
    const quick = { ...settings, sustainedSamples: 1 }
    expect(feed(quick, [cpu(95)])[0]).toHaveLength(1)
  })

  it('notifies again when the overload comes back after a calm period', () => {
    const results = feed(settings, [cpu(95), cpu(95), cpu(95), cpu(10), cpu(95), cpu(95), cpu(95)])
    expect(results[2].some((n) => n.id === 'cpu')).toBe(true)
    expect(results[6].some((n) => n.id === 'cpu')).toBe(true)
  })

  it('does not count while bento is unreachable, and starts over after', () => {
    tracker.update(cpu(95), settings, 0)
    tracker.update(cpu(95), settings, 30_000)
    tracker.update(status({ connection: 'offline', overall: 'offline' }), settings, 60_000)
    expect(tracker.update(cpu(95), settings, 90_000)).toEqual([])
    expect(tracker.update(cpu(95), settings, 120_000)).toEqual([])
    expect(tracker.update(cpu(95), settings, 150_000).some((n) => n.id === 'cpu')).toBe(true)
  })
})

describe('sustained memory', () => {
  const memory = (value: number | null): ReturnType<typeof status> =>
    reading({ memoryUsedPercent: value })

  it('notifies on the third consecutive reading above the threshold', () => {
    const results = feed(settings, [memory(92), memory(93), memory(94)])
    expect(results[2]).toEqual([
      {
        id: 'memory',
        title: 'Mémoire presque pleine',
        body: `94${NBSP}% sur les 3 derniers relevés, seuil d'alerte à 90${NBSP}%.`
      }
    ])
  })

  it('can be switched off', () => {
    const off = { ...settings, notifyMemory: false }
    expect(feed(off, [memory(99), memory(99), memory(99)]).flat()).toEqual([])
  })

  it('is independent of the cpu', () => {
    const both = (): ReturnType<typeof status> => reading({ cpuPercent: 95, memoryUsedPercent: 50 })
    const results = feed(settings, [both(), both(), both()])
    expect(results[2].map((n) => n.id)).toEqual(['cpu'])
  })
})

describe('sustained load', () => {
  const load = (load1: number): ReturnType<typeof status> =>
    reading({ load: { load1, load5: load1, load15: load1 } })
  const on = { ...settings, notifyLoad: true } // threshold 8

  it('is off by default', () => {
    expect(feed(settings, [load(50), load(50), load(50)]).flat()).toEqual([])
  })

  it('notifies on the third consecutive reading above the threshold when on', () => {
    const results = feed(on, [load(9), load(9.5), load(10.25)])
    expect(results[2]).toEqual([
      {
        id: 'load',
        title: 'Charge élevée',
        body: "Charge de 10,25 sur 1 minute, seuil d'alerte à 8."
      }
    ])
  })

  it('ignores a missing load average', () => {
    const none = (): ReturnType<typeof status> => reading({ load: null })
    expect(feed(on, [none(), none(), none(), none()]).flat()).toEqual([])
  })
})

describe('recovery from an overload', () => {
  it('tells when the cpu is back to normal, after a notified overload', () => {
    feed(settings, [cpu(95), cpu(95), cpu(95)])
    expect(tracker.update(cpu(20), settings, 120_000)).toEqual([
      {
        id: 'cpu-ok',
        title: 'Processeur revenu à la normale',
        body: `20${NBSP}% actuellement.`
      }
    ])
  })

  it('stays silent when the overload never reached a notification', () => {
    feed(settings, [cpu(95), cpu(95)])
    expect(tracker.update(cpu(20), settings, 90_000)).toEqual([])
  })

  it('stays silent when recovery notifications are off', () => {
    const off = { ...settings, notifyRecovery: false }
    feed(off, [cpu(95), cpu(95), cpu(95)])
    expect(tracker.update(cpu(20), off, 120_000)).toEqual([])
  })

  it('tells for the memory as well', () => {
    const memory = (value: number): ReturnType<typeof status> =>
      reading({ memoryUsedPercent: value })
    feed(settings, [memory(95), memory(95), memory(95)])
    expect(tracker.update(memory(40), settings, 120_000)[0]).toMatchObject({
      id: 'memory-ok',
      title: 'Mémoire revenue à la normale'
    })
  })
})
