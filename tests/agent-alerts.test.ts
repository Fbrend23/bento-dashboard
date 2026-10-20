import { describe, expect, it } from 'vitest'
import type { AgentStatus } from '../src/shared/agent'
import type { ServiceLevel, ServiceStatus } from '../src/shared/monitors'
import { createAlerts } from '../src/agent/alerts'

function service(
  id: string,
  level: ServiceLevel,
  kind: ServiceStatus['kind'] = 'container'
): ServiceStatus {
  return {
    id,
    label: id,
    kind,
    level,
    detail: level === 'ok' ? 'Up 2 hours' : 'Exited (1) 3 seconds ago',
    state: null,
    project: null,
    ports: []
  }
}

function status(services: ServiceStatus[], diskOver = false): AgentStatus {
  return {
    updatedAt: 0,
    services,
    stackLabels: {},
    metrics: {
      cpuPercent: 99,
      memoryUsedPercent: 99,
      memoryTotalKb: 1000,
      swapUsedPercent: null,
      swapTotalKb: null,
      network: null,
      temperatureC: null,
      load: { load1: 50, load5: 50, load15: 50 },
      uptimeSeconds: 100,
      diskThresholdPercent: 85,
      disks: [
        {
          filesystem: '/dev/sda1',
          mount: '/',
          totalBytes: 100,
          usedBytes: diskOver ? 95 : 10,
          availableBytes: 5,
          usedPercent: diskOver ? 95 : 10,
          overThreshold: diskOver
        }
      ]
    }
  }
}

describe('createAlerts', () => {
  it('announces a container that was running and goes down, then its return', () => {
    let t = 0
    const alerts = createAlerts({ now: () => t })
    expect(alerts.update(status([service('jellyfin', 'ok')]))).toEqual([])
    t += 30_000
    const down = alerts.update(status([service('jellyfin', 'down')]))
    expect(down).toHaveLength(1)
    expect(down[0]).toMatchObject({ id: 'down:jellyfin' })
    t += 30_000
    expect(alerts.update(status([service('jellyfin', 'down')]))).toEqual([])
    t += 30_000
    const up = alerts.update(status([service('jellyfin', 'ok')]))
    expect(up).toHaveLength(1)
    expect(up[0]).toMatchObject({ id: 'up:jellyfin' })
  })

  it('says nothing for a container that is stopped on purpose', () => {
    const alerts = createAlerts({ now: () => 0 })
    alerts.update(status([service('jellyfin', 'ok')]))
    expect(alerts.update(status([service('jellyfin', 'stopped')]))).toEqual([])
    expect(alerts.update(status([service('jellyfin', 'ok')]))).toEqual([])
  })

  it('announces tailscaled going down', () => {
    const alerts = createAlerts({ now: () => 0 })
    alerts.update(status([service('tailscaled.service', 'ok', 'systemd')]))
    const out = alerts.update(status([service('tailscaled.service', 'down', 'systemd')]))
    expect(out.map((n) => n.id)).toEqual(['down:tailscaled.service'])
  })

  it('ignores disks, health, cpu, memory and load', () => {
    const alerts = createAlerts({ now: () => 0 })
    const ok = [service('jellyfin', 'ok')]
    alerts.update(status(ok))
    for (let i = 0; i < 10; i++) {
      expect(alerts.update(status([service('jellyfin', 'degraded')], true))).toEqual([])
    }
  })

  it('holds back the down message of a container the user stops or restarts', () => {
    let t = 0
    const alerts = createAlerts({ now: () => t })
    alerts.update(status([service('jellyfin', 'ok')]))
    alerts.suppress('jellyfin', 60_000)
    t += 30_000
    expect(alerts.update(status([service('jellyfin', 'down')]))).toEqual([])
  })

  it('still announces a container that stays down once the hold ends', () => {
    let t = 0
    const alerts = createAlerts({ now: () => t })
    alerts.update(status([service('jellyfin', 'ok')]))
    alerts.suppress('jellyfin', 60_000)
    t += 90_000
    expect(alerts.update(status([service('jellyfin', 'down')])).map((n) => n.id)).toEqual([
      'down:jellyfin'
    ])
  })

  it('announces a container already down at the first read (remembered as running)', () => {
    const alerts = createAlerts({ now: () => 0 })
    expect(alerts.update(status([service('jellyfin', 'down')])).map((n) => n.id)).toEqual([
      'down:jellyfin'
    ])
  })
})
