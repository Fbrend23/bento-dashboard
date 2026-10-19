import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { NotificationTracker, UNREACHABLE_GRACE_MS } from '../src/main/notifications/tracker'
import { disk, metrics, service, status, tailscale } from './helpers/status'

const at = (hour: number, minute = 0): number => new Date(2026, 9, 16, hour, minute).getTime()
const settings = { ...DEFAULT_SETTINGS, quietHoursEnabled: true } // 22:00 to 07:00

let tracker: NotificationTracker

beforeEach(() => {
  tracker = new NotificationTracker()
})

const down = (id = 'jellyfin'): ReturnType<typeof status> =>
  status({
    overall: 'down',
    services: [service({ id, label: id, level: 'down', detail: 'Exited (137) 3 minutes ago' })]
  })
const ok = (id = 'jellyfin'): ReturnType<typeof status> =>
  status({ services: [service({ id, label: id, level: 'ok', detail: 'Up 5 seconds' })] })

describe('quiet hours', () => {
  it('sends nothing during the quiet hours', () => {
    expect(tracker.update(down(), settings, at(23))).toEqual([])
    expect(tracker.update(down(), settings, at(3))).toEqual([])
  })

  it('delivers a problem that is still there once the quiet hours end, only once', () => {
    tracker.update(down(), settings, at(23))
    tracker.update(down(), settings, at(3))
    expect(tracker.update(down(), settings, at(7, 0)).map((n) => n.id)).toEqual(['down:jellyfin'])
    expect(tracker.update(down(), settings, at(7, 30))).toEqual([])
  })

  it('never delivers a problem that fixed itself during the night, nor its recovery', () => {
    tracker.update(down(), settings, at(23))
    expect(tracker.update(ok(), settings, at(23, 30))).toEqual([])
    expect(tracker.update(ok(), settings, at(8))).toEqual([])
  })

  it('drops the recovery of a problem that was reported before the quiet hours began', () => {
    expect(tracker.update(down(), settings, at(21))).toHaveLength(1)
    expect(tracker.update(ok(), settings, at(23))).toEqual([])
    expect(tracker.update(ok(), settings, at(8))).toEqual([])
  })

  it('does not repeat, at the end of the quiet hours, a problem reported earlier', () => {
    tracker.update(down(), settings, at(21))
    tracker.update(down(), settings, at(23))
    expect(tracker.update(down(), settings, at(7, 1))).toEqual([])
  })

  it('delivers every deferred problem, in the order they appeared', () => {
    tracker.update(down('a'), settings, at(23))
    tracker.update(
      status({
        overall: 'down',
        services: [
          service({ id: 'a', label: 'a', level: 'down', detail: 'Exited (1) 1 minute ago' }),
          service({ id: 'b', label: 'b', level: 'down', detail: 'Exited (1) 1 minute ago' })
        ]
      }),
      settings,
      at(2)
    )
    const bothDown = status({
      overall: 'down',
      services: [
        service({ id: 'a', label: 'a', level: 'down', detail: 'Exited (1) 1 minute ago' }),
        service({ id: 'b', label: 'b', level: 'down', detail: 'Exited (1) 1 minute ago' })
      ]
    })
    expect(tracker.update(bothDown, settings, at(8)).map((n) => n.id)).toEqual(['down:a', 'down:b'])
  })

  it('delivers only the problems that are still there', () => {
    const both = (aLevel: 'down' | 'ok'): ReturnType<typeof status> =>
      status({
        services: [
          service({ id: 'a', label: 'a', level: aLevel, detail: 'x' }),
          service({ id: 'b', label: 'b', level: 'down', detail: 'Exited (1) 1 minute ago' })
        ]
      })
    tracker.update(both('down'), settings, at(23))
    tracker.update(both('ok'), settings, at(1))
    expect(tracker.update(both('ok'), settings, at(8)).map((n) => n.id)).toEqual(['down:b'])
  })

  it('is not applied when switched off', () => {
    const off = { ...settings, quietHoursEnabled: false }
    expect(tracker.update(down(), off, at(23))).toHaveLength(1)
  })

  it('follows the configured period', () => {
    const custom = { ...settings, quietHoursStart: '01:00', quietHoursEnd: '02:00' }
    expect(tracker.update(down(), custom, at(23))).toHaveLength(1)
    const other = new NotificationTracker()
    expect(other.update(down(), custom, at(1, 30))).toEqual([])
  })
})

describe('quiet hours and the other problems', () => {
  const offline = (): ReturnType<typeof status> =>
    status({ connection: 'offline', overall: 'offline' })

  it('defers an unreachable bento, and drops it if the connection came back', () => {
    tracker.update(offline(), settings, at(23))
    expect(tracker.update(offline(), settings, at(23) + UNREACHABLE_GRACE_MS)).toEqual([])
    expect(tracker.update(status(), settings, at(5))).toEqual([])
    expect(tracker.update(status(), settings, at(8))).toEqual([])
  })

  it('delivers an unreachable bento that is still down after the quiet hours', () => {
    tracker.update(offline(), settings, at(23))
    tracker.update(offline(), settings, at(23) + UNREACHABLE_GRACE_MS)
    const morning = tracker.update(offline(), settings, at(7, 0))
    expect(morning.map((n) => n.id)).toEqual(['unreachable'])
  })

  it('defers a full disk', () => {
    const full = status({
      metrics: metrics([disk({ mount: '/mnt/x', usedPercent: 90, overThreshold: true })])
    })
    expect(tracker.update(full, settings, at(23))).toEqual([])
    expect(tracker.update(full, settings, at(8)).map((n) => n.id)).toEqual(['disk:/mnt/x'])
  })

  it('defers a sustained overload', () => {
    const hot = (n: number): ReturnType<typeof status> =>
      status({ updatedAt: n, metrics: { ...metrics(), cpuPercent: 95 } })
    tracker.update(hot(1), settings, at(23))
    tracker.update(hot(2), settings, at(23, 1))
    expect(tracker.update(hot(3), settings, at(23, 2))).toEqual([])
    expect(tracker.update(hot(4), settings, at(8)).map((n) => n.id)).toEqual(['cpu'])
  })

  it('keeps tailscale problems out of the night too', () => {
    const tsDown = status({ services: [tailscale({ level: 'down', detail: 'inactive (dead)' })] })
    expect(tracker.update(tsDown, settings, at(2))).toEqual([])
  })
})
