import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { NotificationTracker, UNREACHABLE_GRACE_MS } from '../src/main/notifications/tracker'
import { disk, metrics, service, status, tailscale } from './helpers/status'

const NBSP = ' '
const settings = { ...DEFAULT_SETTINGS }
const offline = (): ReturnType<typeof status> =>
  status({ connection: 'offline', overall: 'offline' })

let tracker: NotificationTracker

beforeEach(() => {
  tracker = new NotificationTracker()
})

describe('NotificationTracker basics', () => {
  it('stays silent when everything is fine', () => {
    expect(tracker.update(status(), settings, 0)).toEqual([])
  })

  it('stays silent before bento is configured, even if the connection is down', () => {
    const unconfigured = status({
      configured: false,
      connection: 'offline',
      overall: 'unconfigured'
    })
    expect(tracker.update(unconfigured, settings, 0)).toEqual([])
    expect(tracker.update(unconfigured, settings, UNREACHABLE_GRACE_MS * 10)).toEqual([])
  })
})

describe('NotificationTracker services', () => {
  const down = (): ReturnType<typeof status> =>
    status({
      overall: 'down',
      services: [service({ level: 'down', detail: 'Exited (137) 3 minutes ago' }), tailscale()]
    })

  it('notifies when a service goes down', () => {
    expect(tracker.update(down(), settings, 0)).toEqual([
      {
        id: 'down:jellyfin',
        title: "jellyfin est à l'arrêt",
        body: 'Arrêté (code 137) il y a 3 minutes.'
      }
    ])
  })

  it('does not repeat while the service stays down', () => {
    tracker.update(down(), settings, 0)
    expect(tracker.update(down(), settings, 30_000)).toEqual([])
    expect(tracker.update(down(), settings, 60_000)).toEqual([])
  })

  it('notifies again after a recovery', () => {
    tracker.update(down(), settings, 0)
    tracker.update(status(), settings, 30_000)
    expect(tracker.update(down(), settings, 60_000)).toHaveLength(1)
  })

  it('says a missing container cannot be found', () => {
    const absent = status({
      overall: 'down',
      services: [
        service({ id: 'nginx', label: 'nginx', level: 'absent', detail: 'Conteneur introuvable' })
      ]
    })
    expect(tracker.update(absent, settings, 0)).toEqual([
      { id: 'down:nginx', title: 'nginx est introuvable', body: 'Conteneur introuvable.' }
    ])
  })

  it('also watches the systemd service', () => {
    const tsDown = status({
      overall: 'down',
      services: [tailscale({ level: 'down', detail: 'inactive (dead)' })]
    })
    expect(tracker.update(tsDown, settings, 0)[0]).toMatchObject({
      id: 'down:tailscaled',
      title: "Tailscale est à l'arrêt"
    })
  })

  it('ignores unreadable states and does not forget a known outage', () => {
    tracker.update(down(), settings, 0)
    const unknown = status({
      services: [service({ level: 'unknown', detail: 'Lecture Docker impossible' })]
    })
    expect(tracker.update(unknown, settings, 30_000)).toEqual([])
    expect(tracker.update(down(), settings, 60_000)).toEqual([])
  })

  it('notifies about every service that fell in the same cycle', () => {
    const both = status({
      overall: 'down',
      services: [
        service({ id: 'a', label: 'a', level: 'down', detail: 'Exited (0) 1 minute ago' }),
        service({ id: 'b', label: 'b', level: 'down', detail: 'Exited (0) 1 minute ago' })
      ]
    })
    expect(tracker.update(both, settings, 0).map((n) => n.id)).toEqual(['down:a', 'down:b'])
  })

  it('forgets services that are no longer watched', () => {
    tracker.update(down(), settings, 0)
    tracker.update(status({ services: [tailscale()] }), settings, 30_000)
    expect(tracker.update(down(), settings, 60_000)).toHaveLength(1)
  })
})

describe('NotificationTracker unhealthy containers', () => {
  const unhealthy = (): ReturnType<typeof status> =>
    status({
      overall: 'degraded',
      services: [
        service({
          id: 'homepage',
          label: 'homepage',
          level: 'degraded',
          detail: 'Up 4 days (unhealthy)'
        })
      ]
    })

  it('does not notify for a container that was already unhealthy when first seen', () => {
    expect(tracker.update(unhealthy(), settings, 0)).toEqual([])
    expect(tracker.update(unhealthy(), settings, 30_000)).toEqual([])
  })

  it('waits for real data before taking that first look', () => {
    const pending = status({ overall: 'pending', services: [], metrics: null })
    expect(tracker.update(pending, settings, 0)).toEqual([])
    expect(tracker.update(unhealthy(), settings, 30_000)).toEqual([])
    expect(tracker.update(status(), settings, 60_000)).toEqual([])
    expect(tracker.update(unhealthy(), settings, 90_000)).toHaveLength(1)
  })

  it('notifies once when a healthy container turns unhealthy', () => {
    tracker.update(status(), settings, 0)
    expect(tracker.update(unhealthy(), settings, 30_000)).toEqual([
      {
        id: 'unhealthy:homepage',
        title: 'homepage ne répond pas bien',
        body: 'Le contrôle de santé du conteneur échoue.'
      }
    ])
    expect(tracker.update(unhealthy(), settings, 60_000)).toEqual([])
  })

  it('stays silent when the setting is off, and notifies once it is turned on', () => {
    const off = { ...settings, notifyUnhealthy: false }
    tracker.update(status(), off, 0)
    expect(tracker.update(unhealthy(), off, 30_000)).toEqual([])
    expect(tracker.update(unhealthy(), settings, 60_000)).toHaveLength(1)
  })

  it('ignores transient states such as a container still starting or a systemd unit activating', () => {
    const starting = status({
      services: [
        service({ level: 'degraded', detail: 'Up 3 seconds (health: starting)' }),
        tailscale({ level: 'degraded', detail: 'activating (start)' })
      ]
    })
    expect(tracker.update(starting, settings, 0)).toEqual([])
  })

  it('notifies again after the container recovers and fails again', () => {
    tracker.update(unhealthy(), settings, 0)
    tracker.update(status(), settings, 30_000)
    expect(tracker.update(unhealthy(), settings, 60_000)).toHaveLength(1)
  })

  it('does not take a new first look after the connection comes back', () => {
    tracker.update(status(), settings, 0)
    tracker.update(offline(), settings, 30_000)
    expect(tracker.update(unhealthy(), settings, 60_000)).toHaveLength(1)
  })

  it('takes a new first look once bento is configured again', () => {
    tracker.update(status(), settings, 0)
    tracker.update(status({ configured: false, overall: 'unconfigured' }), settings, 30_000)
    expect(tracker.update(unhealthy(), settings, 60_000)).toEqual([])
  })
})

describe('NotificationTracker disks', () => {
  const full = (percent = 87): ReturnType<typeof status> =>
    status({
      overall: 'degraded',
      metrics: metrics([disk({ mount: '/mnt/nas', usedPercent: percent, overThreshold: true })])
    })

  it('notifies once when a disk goes over the threshold', () => {
    expect(tracker.update(full(), settings, 0)).toEqual([
      {
        id: 'disk:/mnt/nas',
        title: 'Disque presque plein : /mnt/nas',
        body: `87${NBSP}% utilisé, seuil d'alerte à 85${NBSP}%.`
      }
    ])
    expect(tracker.update(full(88), settings, 30_000)).toEqual([])
  })

  it('notifies again if the disk drops below the threshold and goes over it later', () => {
    tracker.update(full(), settings, 0)
    tracker.update(status(), settings, 30_000)
    expect(tracker.update(full(), settings, 60_000)).toHaveLength(1)
  })

  it('tracks each disk separately', () => {
    const two = status({
      metrics: metrics([
        disk({ mount: '/', usedPercent: 90, overThreshold: true }),
        disk({ mount: '/boot', usedPercent: 91, overThreshold: true })
      ])
    })
    expect(tracker.update(two, settings, 0).map((n) => n.id)).toEqual(['disk:/', 'disk:/boot'])
  })
})

describe('NotificationTracker unreachable bento', () => {
  it('waits for the grace period so a brief drop does not alert', () => {
    expect(tracker.update(offline(), settings, 1_000)).toEqual([])
    expect(tracker.update(offline(), settings, 1_000 + UNREACHABLE_GRACE_MS - 1)).toEqual([])
    tracker.update(status(), settings, 1_000 + UNREACHABLE_GRACE_MS + 5_000)
    expect(tracker.update(offline(), settings, 200_000)).toEqual([])
  })

  it('notifies once the outage has lasted for the grace period', () => {
    tracker.update(offline(), settings, 1_000)
    expect(tracker.update(offline(), settings, 1_000 + UNREACHABLE_GRACE_MS)).toEqual([
      {
        id: 'unreachable',
        title: 'Bento est injoignable',
        body: "Aucune réponse depuis plus d'une minute. Nouvelle tentative automatique."
      }
    ])
  })

  it('does not repeat during the same outage', () => {
    tracker.update(offline(), settings, 0)
    tracker.update(offline(), settings, UNREACHABLE_GRACE_MS)
    expect(tracker.update(offline(), settings, UNREACHABLE_GRACE_MS * 5)).toEqual([])
  })

  it('notifies again for a later outage', () => {
    tracker.update(offline(), settings, 0)
    tracker.update(offline(), settings, UNREACHABLE_GRACE_MS)
    tracker.update(status(), settings, UNREACHABLE_GRACE_MS + 10_000)
    tracker.update(offline(), settings, 200_000)
    expect(tracker.update(offline(), settings, 200_000 + UNREACHABLE_GRACE_MS)).toHaveLength(1)
  })

  it('does not report stale services while offline', () => {
    const stale = status({
      connection: 'offline',
      overall: 'offline',
      services: [service({ level: 'down', detail: 'Exited (1) 1 minute ago' })],
      metrics: metrics([disk({ overThreshold: true, usedPercent: 99 })])
    })
    expect(tracker.update(stale, settings, 0)).toEqual([])
  })

  it('counts a connection still being established as unreachable', () => {
    const connecting = status({ connection: 'connecting', overall: 'offline' })
    tracker.update(connecting, settings, 0)
    expect(tracker.update(connecting, settings, UNREACHABLE_GRACE_MS)).toHaveLength(1)
  })
})

describe('NotificationTracker.suppress', () => {
  const jellyfinDown = (): ReturnType<typeof status> =>
    status({
      overall: 'down',
      services: [service({ level: 'down', detail: 'Exited (0) 1 second ago' }), tailscale()]
    })

  it('stays silent about a service that is down while it is suppressed', () => {
    tracker.suppress('jellyfin', 1000)
    expect(tracker.update(jellyfinDown(), settings, 500)).toEqual([])
  })

  it('does not hide other services', () => {
    tracker.suppress('jellyfin', 1000)
    const both = status({
      overall: 'down',
      services: [
        service({ level: 'down', detail: 'Exited (0) 1 second ago' }),
        service({ id: 'proxy-app-1', label: 'proxy-app-1', level: 'down', detail: 'Exited (1)' })
      ]
    })
    expect(tracker.update(both, settings, 500).map((n) => n.id)).toEqual(['down:proxy-app-1'])
  })

  it('stays silent when the service comes back before the end, and notifies if it fails again', () => {
    tracker.suppress('jellyfin', 1000)
    expect(tracker.update(jellyfinDown(), settings, 100)).toEqual([])
    expect(tracker.update(status(), settings, 200)).toEqual([])
    expect(tracker.update(jellyfinDown(), settings, 2000).map((n) => n.id)).toEqual([
      'down:jellyfin'
    ])
  })

  it('notifies once the suppression has ended if the service is still down', () => {
    tracker.suppress('jellyfin', 1000)
    expect(tracker.update(jellyfinDown(), settings, 999)).toEqual([])
    expect(tracker.update(jellyfinDown(), settings, 1000).map((n) => n.id)).toEqual([
      'down:jellyfin'
    ])
    expect(tracker.update(jellyfinDown(), settings, 1500)).toEqual([])
  })
})
