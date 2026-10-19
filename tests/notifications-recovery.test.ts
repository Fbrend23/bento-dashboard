import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { NotificationTracker, UNREACHABLE_GRACE_MS } from '../src/main/notifications/tracker'
import { disk, metrics, service, status, tailscale } from './helpers/status'

const settings = { ...DEFAULT_SETTINGS }
const noRecovery = { ...settings, notifyRecovery: false }

let tracker: NotificationTracker

beforeEach(() => {
  tracker = new NotificationTracker()
})

const down = (): ReturnType<typeof status> =>
  status({
    overall: 'down',
    services: [service({ level: 'down', detail: 'Exited (137) 3 minutes ago' }), tailscale()]
  })

const back = (): ReturnType<typeof status> =>
  status({
    services: [service({ level: 'ok', detail: 'Up 5 seconds' }), tailscale()]
  })

describe('recovery of a service', () => {
  it('tells when a service that was reported down is back', () => {
    tracker.update(down(), settings, 0)
    expect(tracker.update(back(), settings, 30_000)).toEqual([
      {
        id: 'up:jellyfin',
        title: 'jellyfin est de nouveau actif',
        body: 'Actif depuis 5 secondes.'
      }
    ])
  })

  it('tells only once', () => {
    tracker.update(down(), settings, 0)
    tracker.update(back(), settings, 30_000)
    expect(tracker.update(back(), settings, 60_000)).toEqual([])
  })

  it('stays silent when recovery notifications are off', () => {
    tracker.update(down(), noRecovery, 0)
    expect(tracker.update(back(), noRecovery, 30_000)).toEqual([])
  })

  it('stays silent for a service that was never reported', () => {
    expect(tracker.update(back(), settings, 0)).toEqual([])
    tracker.update(status({ services: [service({ level: 'stopped' })] }), settings, 30_000)
    expect(tracker.update(back(), settings, 60_000)).toEqual([])
  })

  it('stays silent when our own restart held the "down" notification back and it came back', () => {
    tracker.suppress('jellyfin', 120_000)
    expect(tracker.update(down(), settings, 0)).toEqual([])
    expect(tracker.update(back(), settings, 30_000)).toEqual([])
  })

  it('does not call a stop that was ignored a recovery', () => {
    tracker.update(down(), settings, 0)
    const stopped = status({ services: [service({ level: 'stopped', state: 'exited' })] })
    expect(tracker.update(stopped, settings, 30_000)).toEqual([])
    // and a later start is not announced either: nobody was told it was down any more
    expect(tracker.update(back(), settings, 60_000)).toEqual([])
  })

  it('does not announce recovery from an unreadable state', () => {
    tracker.update(down(), settings, 0)
    const unknown = status({ services: [service({ level: 'unknown' })] })
    expect(tracker.update(unknown, settings, 30_000)).toEqual([])
    expect(tracker.update(back(), settings, 60_000)).toHaveLength(1)
  })

  it('announces a service that came back as degraded', () => {
    tracker.update(down(), settings, 0)
    const starting = status({
      services: [service({ level: 'degraded', detail: 'Up 3 seconds (health: starting)' })]
    })
    expect(tracker.update(starting, settings, 30_000)[0]).toMatchObject({ id: 'up:jellyfin' })
  })

  it('works for the systemd service too', () => {
    const tsDown = status({ services: [tailscale({ level: 'down', detail: 'inactive (dead)' })] })
    tracker.update(tsDown, settings, 0)
    const tsBack = status({ services: [tailscale({ level: 'ok', detail: 'Up 2 minutes' })] })
    expect(tracker.update(tsBack, settings, 30_000)[0]).toMatchObject({
      id: 'up:tailscaled',
      title: 'Tailscale est de nouveau actif'
    })
  })
})

describe('recovery of an unhealthy container', () => {
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
  const healthy = (): ReturnType<typeof status> =>
    status({
      services: [
        service({ id: 'homepage', label: 'homepage', level: 'ok', detail: 'Up 4 days (healthy)' })
      ]
    })

  it('tells when the healthcheck passes again, after a notified failure', () => {
    tracker.update(status(), settings, 0)
    tracker.update(unhealthy(), settings, 30_000)
    expect(tracker.update(healthy(), settings, 60_000)).toEqual([
      {
        id: 'healthy:homepage',
        title: 'homepage répond de nouveau',
        body: 'Le contrôle de santé du conteneur réussit.'
      }
    ])
  })

  it('stays silent for a container that was already unhealthy when first seen', () => {
    tracker.update(unhealthy(), settings, 0)
    expect(tracker.update(healthy(), settings, 30_000)).toEqual([])
  })
})

describe('recovery of the connection', () => {
  const offline = (): ReturnType<typeof status> =>
    status({ connection: 'offline', overall: 'offline' })

  it('tells when bento is reachable again after a notified outage', () => {
    tracker.update(offline(), settings, 0)
    tracker.update(offline(), settings, UNREACHABLE_GRACE_MS)
    expect(tracker.update(status(), settings, UNREACHABLE_GRACE_MS + 5000)).toEqual([
      {
        id: 'reachable',
        title: 'Bento est de nouveau joignable',
        body: 'La connexion est rétablie.'
      }
    ])
  })

  it('stays silent after a brief drop that never reached a notification', () => {
    tracker.update(offline(), settings, 0)
    expect(tracker.update(status(), settings, UNREACHABLE_GRACE_MS - 1)).toEqual([])
  })

  it('stays silent when recovery notifications are off', () => {
    tracker.update(offline(), noRecovery, 0)
    tracker.update(offline(), noRecovery, UNREACHABLE_GRACE_MS)
    expect(tracker.update(status(), noRecovery, UNREACHABLE_GRACE_MS + 1)).toEqual([])
  })

  it('notifies the next outage again', () => {
    tracker.update(offline(), settings, 0)
    tracker.update(offline(), settings, UNREACHABLE_GRACE_MS)
    tracker.update(status(), settings, UNREACHABLE_GRACE_MS + 1)
    const later = UNREACHABLE_GRACE_MS * 3
    tracker.update(offline(), settings, later)
    expect(tracker.update(offline(), settings, later + UNREACHABLE_GRACE_MS)).toHaveLength(1)
  })
})

describe('recovery of a disk', () => {
  const full = (): ReturnType<typeof status> =>
    status({
      metrics: metrics([disk({ mount: '/mnt/nas', usedPercent: 87, overThreshold: true })])
    })
  const roomy = (): ReturnType<typeof status> =>
    status({
      metrics: metrics([disk({ mount: '/mnt/nas', usedPercent: 60, overThreshold: false })])
    })

  it('tells when a disk that was over the threshold is below it again', () => {
    tracker.update(full(), settings, 0)
    expect(tracker.update(roomy(), settings, 30_000)).toEqual([
      {
        id: 'disk-ok:/mnt/nas',
        title: 'Disque revenu sous le seuil : /mnt/nas',
        body: expect.stringContaining('60')
      }
    ])
  })

  it('stays silent when recovery notifications are off', () => {
    tracker.update(full(), noRecovery, 0)
    expect(tracker.update(roomy(), noRecovery, 30_000)).toEqual([])
  })

  it('stays silent when the disk disappears instead', () => {
    tracker.update(full(), settings, 0)
    expect(tracker.update(status({ metrics: metrics([]) }), settings, 30_000)).toEqual([])
  })
})
