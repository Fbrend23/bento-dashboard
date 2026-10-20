import { beforeEach, describe, expect, it } from 'vitest'
import { RANGE_MS, UNREACHABLE_GRACE_MS, type Incident } from '@shared/history'
import { IncidentTracker, incidentsInRange } from '../src/main/history/incidents'
import { RETENTION_MS } from '../src/main/history/recorder'
import { disk, metrics, service, status, tailscale } from './helpers/status'

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0)
const at = (seconds: number): number => T0 + seconds * 1000

let tracker: IncidentTracker

beforeEach(() => {
  tracker = new IncidentTracker()
})

const down = (id = 'jellyfin', label = 'Jellyfin'): ReturnType<typeof status> =>
  status({
    services: [service({ id, label, level: 'down', state: 'exited' }), tailscale()]
  })
const up = (id = 'jellyfin', label = 'Jellyfin'): ReturnType<typeof status> =>
  status({ services: [service({ id, label, level: 'ok' }), tailscale()] })

describe('service incidents', () => {
  it('opens an incident when a service goes down, with the time it was noticed', () => {
    expect(tracker.update(down(), at(0))).toBe(true)
    expect(tracker.incidents).toEqual([
      {
        key: 'service-down:jellyfin',
        kind: 'service-down',
        subject: 'Jellyfin',
        startedAt: at(0),
        endedAt: null
      }
    ])
  })

  it('does not open a second one while it lasts', () => {
    tracker.update(down(), at(0))
    expect(tracker.update(down(), at(30))).toBe(false)
    expect(tracker.incidents).toHaveLength(1)
  })

  it('closes it when the service is back, and keeps it as history', () => {
    tracker.update(down(), at(0))
    expect(tracker.update(up(), at(90))).toBe(true)
    expect(tracker.incidents).toEqual([
      expect.objectContaining({ startedAt: at(0), endedAt: at(90) })
    ])
  })

  it('opens a new one if it falls again', () => {
    tracker.update(down(), at(0))
    tracker.update(up(), at(60))
    tracker.update(down(), at(120))
    expect(tracker.incidents).toHaveLength(2)
    expect(tracker.incidents[1]).toMatchObject({ startedAt: at(120), endedAt: null })
  })

  it('counts an absent container as down', () => {
    const absent = status({ services: [service({ id: 'x', label: 'x', level: 'absent' })] })
    tracker.update(absent, at(0))
    expect(tracker.incidents[0]).toMatchObject({ key: 'service-down:x', endedAt: null })
  })

  it('does not count a container that is stopped on purpose, and closes the incident', () => {
    const stopped = status({ services: [service({ level: 'stopped', state: 'exited' })] })
    expect(tracker.update(stopped, at(0))).toBe(false)
    expect(tracker.incidents).toEqual([])

    tracker.update(down(), at(10))
    tracker.update(stopped, at(20))
    expect(tracker.incidents[0].endedAt).toBe(at(20))
  })

  it('keeps one incident per service', () => {
    const both = status({
      services: [
        service({ id: 'a', label: 'A', level: 'down' }),
        service({ id: 'b', label: 'B', level: 'down' })
      ]
    })
    tracker.update(both, at(0))
    expect(tracker.incidents.map((i) => i.key)).toEqual(['service-down:a', 'service-down:b'])
  })

  it('also follows the systemd service', () => {
    const tsDown = status({ services: [tailscale({ level: 'down', detail: 'inactive (dead)' })] })
    tracker.update(tsDown, at(0))
    expect(tracker.incidents[0]).toMatchObject({
      key: 'service-down:tailscaled',
      subject: 'Tailscale'
    })
  })

  it('leaves an incident alone when the state cannot be read', () => {
    tracker.update(down(), at(0))
    const unknown = status({
      services: [service({ id: 'docker', label: 'Docker', level: 'unknown', state: null })]
    })
    expect(tracker.update(unknown, at(30))).toBe(false)
    expect(tracker.incidents[0].endedAt).toBeNull()
  })

  it('closes the incident of a container that was removed, once docker is readable', () => {
    tracker.update(down(), at(0))
    tracker.update(
      status({ services: [service({ id: 'other', label: 'Other', level: 'ok' })] }),
      at(60)
    )
    expect(tracker.incidents[0].endedAt).toBe(at(60))
  })
})

describe('unreachable bento', () => {
  const offline = (patch: Partial<ReturnType<typeof status>> = {}): ReturnType<typeof status> =>
    status({ connection: 'offline', overall: 'offline', lastError: 'timeout', ...patch })

  const grace = UNREACHABLE_GRACE_MS / 1000

  it('opens an incident once the outage has lasted a minute, dated from when it began', () => {
    expect(tracker.update(offline(), at(0))).toBe(false)
    expect(tracker.update(offline(), at(grace - 1))).toBe(false)
    expect(tracker.incidents).toEqual([])

    expect(tracker.update(offline(), at(grace))).toBe(true)
    expect(tracker.incidents).toEqual([
      {
        key: 'unreachable:bento',
        kind: 'unreachable',
        subject: 'bento',
        startedAt: at(0),
        endedAt: null
      }
    ])
  })

  it('closes it when the connection is back', () => {
    tracker.update(offline(), at(0))
    tracker.update(offline(), at(grace))
    tracker.update(status(), at(300))
    expect(tracker.incidents[0].endedAt).toBe(at(300))
  })

  it('records nothing for a drop shorter than a minute (a sleep, a Wi-Fi blip, new settings)', () => {
    tracker.update(offline(), at(0))
    tracker.update(offline(), at(40))
    expect(tracker.update(status(), at(50))).toBe(false)
    expect(tracker.incidents).toEqual([])
  })

  it('times each outage from its own start', () => {
    tracker.update(offline(), at(0))
    tracker.update(status(), at(30))
    tracker.update(offline(), at(100))
    expect(tracker.update(offline(), at(100 + grace - 1))).toBe(false)
    expect(tracker.incidents).toEqual([])
    tracker.update(offline(), at(100 + grace))
    expect(tracker.incidents[0].startedAt).toBe(at(100))
  })

  it('counts the time spent reconnecting as part of the outage', () => {
    tracker.update(offline(), at(0))
    tracker.update(offline({ connection: 'connecting' }), at(30))
    tracker.update(offline(), at(grace))
    expect(tracker.incidents[0].startedAt).toBe(at(0))
  })

  it('does not count the first connection of the app, before anything was tried', () => {
    const starting = status({
      connection: 'offline',
      overall: 'offline',
      lastError: null,
      updatedAt: null,
      services: [],
      metrics: null
    })
    expect(tracker.update(starting, at(0))).toBe(false)
    expect(tracker.update(status({ ...starting, connection: 'connecting' }), at(5))).toBe(false)
    expect(tracker.incidents).toEqual([])
  })

  it('counts a failed first attempt', () => {
    const failed = status({
      connection: 'offline',
      overall: 'offline',
      lastError: 'connect ECONNREFUSED',
      updatedAt: null,
      services: [],
      metrics: null
    })
    tracker.update(failed, at(0))
    tracker.update(failed, at(grace))
    expect(tracker.incidents).toHaveLength(1)
  })

  it('keeps the incident open while reconnecting', () => {
    tracker.update(offline(), at(0))
    tracker.update(offline(), at(grace))
    expect(tracker.update(offline({ connection: 'connecting' }), at(grace + 10))).toBe(false)
    expect(tracker.incidents[0].endedAt).toBeNull()
  })

  it('does not judge services and disks from stale values while unreachable', () => {
    const stale = offline({ services: [service({ level: 'down' })] })
    tracker.update(stale, at(0))
    tracker.update(stale, at(grace))
    expect(tracker.incidents.map((i) => i.kind)).toEqual(['unreachable'])
  })

  it('records nothing before bento is configured', () => {
    expect(tracker.update(status({ configured: false, connection: 'offline' }), at(0))).toBe(false)
    expect(tracker.incidents).toEqual([])
  })
})

describe('disk incidents', () => {
  const full = (percent = 90): ReturnType<typeof status> =>
    status({
      metrics: metrics([disk({ mount: '/mnt/media', usedPercent: percent, overThreshold: true })])
    })
  const roomy = (): ReturnType<typeof status> =>
    status({
      metrics: metrics([disk({ mount: '/mnt/media', usedPercent: 50, overThreshold: false })])
    })

  it('opens an incident when a disk goes over its threshold, and closes it below', () => {
    tracker.update(full(), at(0))
    expect(tracker.incidents[0]).toMatchObject({
      key: 'disk-full:/mnt/media',
      kind: 'disk-full',
      subject: '/mnt/media',
      endedAt: null
    })
    expect(tracker.update(full(91), at(30))).toBe(false)
    tracker.update(roomy(), at(60))
    expect(tracker.incidents[0].endedAt).toBe(at(60))
  })

  it('closes it when the disk disappears', () => {
    tracker.update(full(), at(0))
    tracker.update(status({ metrics: metrics([]) }), at(30))
    expect(tracker.incidents[0].endedAt).toBe(at(30))
  })

  it('leaves it open when the disks could not be read at all', () => {
    tracker.update(full(), at(0))
    tracker.update(status({ metrics: null }), at(30))
    expect(tracker.incidents[0].endedAt).toBeNull()
  })
})

describe('keeping incidents', () => {
  const closed = (key: string, startedAt: number, endedAt: number): Incident => ({
    key,
    kind: 'service-down',
    subject: key,
    startedAt,
    endedAt
  })

  it('starts from the incidents it was given, and keeps closing the open ones', () => {
    const open: Incident = { ...closed('service-down:jellyfin', at(0), at(0)), endedAt: null }
    const resumed = new IncidentTracker([open])
    resumed.update(up(), at(100))
    expect(resumed.incidents[0].endedAt).toBe(at(100))
  })

  it('forgets closed incidents older than seven days, never open ones', () => {
    const old = closed('service-down:old', at(0), at(60))
    const open: Incident = { ...closed('service-down:still', at(0), at(0)), endedAt: null }
    const t = new IncidentTracker([old, open])
    t.update(up('other'), at(0) + RETENTION_MS + 120_000)
    expect(t.incidents.map((i) => i.key)).toEqual(['service-down:still'])
  })

  it('keeps at most the 200 most recent closed incidents', () => {
    const many = Array.from({ length: 250 }, (_, i) =>
      closed(`service-down:s${i}`, at(i), at(i + 1))
    )
    const t = new IncidentTracker(many)
    t.update(down(), at(1000))
    const closedOnes = t.incidents.filter((i) => i.endedAt !== null)
    expect(closedOnes).toHaveLength(200)
    expect(closedOnes[0].key).toBe('service-down:s50')
  })
})

describe('incidentsInRange', () => {
  const NOW = at(100_000)
  const incident = (key: string, startedAt: number, endedAt: number | null): Incident => ({
    key,
    kind: 'service-down',
    subject: key,
    startedAt,
    endedAt
  })

  it('keeps the incidents that overlap the range, newest first', () => {
    const list = [
      incident('old', NOW - 2 * RANGE_MS['24h'], NOW - 2 * RANGE_MS['24h'] + 60_000),
      incident('overlapping', NOW - RANGE_MS['24h'] - 60_000, NOW - RANGE_MS['24h'] + 60_000),
      incident('recent', NOW - 3_600_000, NOW - 3_000_000),
      incident('open', NOW - 7_200_000, null)
    ]
    expect(incidentsInRange(list, '24h', NOW).map((i) => i.key)).toEqual([
      'recent',
      'open',
      'overlapping'
    ])
  })

  it('shows an incident that is still open whatever its age', () => {
    expect(
      incidentsInRange([incident('open', NOW - 3 * 86_400_000, null)], '1h', NOW)
    ).toHaveLength(1)
  })

  it('caps the list', () => {
    const list = Array.from({ length: 80 }, (_, i) =>
      incident(`k${i}`, NOW - i * 1000 - 1000, NOW - i * 1000)
    )
    expect(incidentsInRange(list, '1h', NOW)).toHaveLength(50)
  })

  it('does not change the list it is given', () => {
    const list = [incident('a', NOW - 2000, NOW - 1000), incident('b', NOW - 1000, null)]
    const copy = structuredClone(list)
    incidentsInRange(list, '1h', NOW)
    expect(list).toEqual(copy)
  })
})

describe('gaps (the agent was not running)', () => {
  const grace = UNREACHABLE_GRACE_MS / 1000

  it('records a gap as a closed unreachable incident', () => {
    expect(tracker.recordGap(at(0), at(600))).toBe(true)
    expect(tracker.incidents).toEqual([
      {
        key: 'unreachable:bento',
        kind: 'unreachable',
        subject: 'bento',
        startedAt: at(0),
        endedAt: at(600)
      }
    ])
  })

  it('ignores a gap shorter than the grace period', () => {
    expect(tracker.recordGap(at(0), at(grace - 1))).toBe(false)
    expect(tracker.incidents).toEqual([])
  })

  it('records a gap exactly as long as the grace period', () => {
    expect(tracker.recordGap(at(0), at(grace))).toBe(true)
  })

  it('ignores a gap that does not go forward', () => {
    expect(tracker.recordGap(at(600), at(0))).toBe(false)
  })

  it('forgets a gap older than the retention, like any closed incident', () => {
    const now = at(0) + RETENTION_MS * 2
    tracker.recordGap(at(0), at(600))
    tracker.update(up(), now)
    expect(tracker.incidents).toEqual([])
  })
})
