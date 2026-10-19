import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import type { ServiceStatus } from '@shared/monitors'
import { DOCKER_PS_COMMAND, parseDockerPs } from '../src/main/monitors/containers'
import { SYSTEMCTL_SHOW_COMMAND } from '../src/main/monitors/systemd'
import {
  buildSnapshot,
  overallLevel,
  SNAPSHOT_COMMAND,
  splitSections
} from '../src/main/monitors/snapshot'
import { recordedDockerPs } from './helpers/docker-ps'
import { snapshotOutput } from './helpers/snapshot-output'

const settings: Settings = { ...DEFAULT_SETTINGS }
const recorded = snapshotOutput()

describe('SNAPSHOT_COMMAND', () => {
  it('chains the fixed read-only commands, each behind a section marker', () => {
    expect(SNAPSHOT_COMMAND).toContain(DOCKER_PS_COMMAND)
    expect(SNAPSHOT_COMMAND).toContain(SYSTEMCTL_SHOW_COMMAND)
    for (const name of [
      'docker',
      'systemd',
      'loadavg',
      'uptime',
      'stat',
      'meminfo',
      'net',
      'thermal',
      'df'
    ]) {
      expect(SNAPSHOT_COMMAND).toContain(`echo '@@${name}'`)
    }
  })

  it('contains no write action', () => {
    expect(SNAPSHOT_COMMAND).not.toMatch(/restart|stop|start|rm |kill|>|docker (run|exec)/)
  })
})

describe('splitSections', () => {
  it('splits the output on marker lines', () => {
    const sections = splitSections('@@a\none\ntwo\n@@b\nthree\n')
    expect(sections).toEqual({ a: 'one\ntwo\n', b: 'three\n' })
  })

  it('handles CRLF and ignores text before the first marker', () => {
    expect(splitSections('noise\r\n@@a\r\nx\r\n')).toEqual({ a: 'x\n' })
  })

  it('returns empty sections for markers without content', () => {
    expect(splitSections('@@a\n@@b\nx\n')).toEqual({ a: '', b: 'x\n' })
  })

  it('returns nothing for empty output', () => {
    expect(splitSections('')).toEqual({})
  })
})

const RUNNING = new Set(
  parseDockerPs(recordedDockerPs())
    .filter((c) => c.state === 'running')
    .map((c) => c.name)
)

describe('buildSnapshot services (recorded output)', () => {
  const { services } = buildSnapshot(recorded, settings, null, RUNNING)
  const byId = (id: string): ServiceStatus | undefined => services.find((s) => s.id === id)

  it('lists every container by name, then tailscale', () => {
    expect(services).toHaveLength(27)
    const containers = services.slice(0, -1)
    expect(containers.every((s) => s.kind === 'container')).toBe(true)
    expect(containers.map((s) => s.id)).toEqual([...containers.map((s) => s.id)].sort())
    expect(services.at(-1)).toMatchObject({ id: 'tailscaled', kind: 'systemd' })
  })

  it('reports level, detail, project and ports', () => {
    expect(byId('jellyfin')).toEqual({
      id: 'jellyfin',
      label: 'Jellyfin',
      kind: 'container',
      level: 'ok',
      detail: 'Up 19 minutes',
      state: 'running',
      project: 'media',
      ports: [
        { hostPort: 8096, containerPort: 8096, proto: 'tcp', bind: '0.0.0.0', linkable: true }
      ]
    })
    expect(byId('tailscaled')).toMatchObject({
      label: 'Tailscale',
      level: 'ok',
      detail: 'Up 4 days',
      state: null,
      project: null,
      ports: []
    })
  })

  it('uses the label chosen in the settings, and the docker name otherwise', () => {
    const labelled = buildSnapshot(
      recorded,
      { ...settings, containerLabels: { 'proxy-app-1': 'Nginx' } },
      null,
      RUNNING
    )
    expect(labelled.services.find((x) => x.id === 'proxy-app-1')?.label).toBe('Nginx')
    expect(labelled.services.find((x) => x.id === 'series')?.label).toBe('series')
    expect(byId('proxy-app-1')?.label).toBe('proxy-app-1')
  })

  it('flags an unhealthy container as degraded', () => {
    expect(byId('homepage')).toMatchObject({ level: 'degraded', detail: 'Up 4 days (unhealthy)' })
  })

  it('flags a stopped container that was running before as down', () => {
    const expected = new Set([...RUNNING, 'stream'])
    const { services: s } = buildSnapshot(recorded, settings, null, expected)
    expect(s.find((x) => x.id === 'stream')).toMatchObject({
      level: 'down',
      detail: 'Exited (0) 2 months ago'
    })
  })

  it('keeps a container that was never seen running as stopped, not down', () => {
    expect(byId('stream')).toMatchObject({ level: 'stopped', detail: 'Exited (0) 2 months ago' })
    expect(services.filter((s) => s.level === 'stopped')).toHaveLength(10)
    expect(services.some((s) => s.level === 'down' || s.level === 'absent')).toBe(false)
  })

  it('hides the containers listed in the settings', () => {
    const { services: s } = buildSnapshot(
      recorded,
      { ...settings, hiddenContainers: ['homepage', 'stream'] },
      null,
      RUNNING
    )
    expect(s.some((x) => x.id === 'homepage' || x.id === 'stream')).toBe(false)
    expect(s).toHaveLength(25)
  })

  it('does not list an expected container that docker no longer knows', () => {
    const expected = new Set([...RUNNING, 'removed-long-ago'])
    const { services: s } = buildSnapshot(recorded, settings, null, expected)
    expect(s.some((x) => x.id === 'removed-long-ago')).toBe(false)
  })
})

describe('buildSnapshot docker inventory', () => {
  it('reports which containers exist and which are running', () => {
    const { docker } = buildSnapshot(recorded, settings, null, RUNNING)
    expect(docker?.present).toHaveLength(26)
    expect(docker?.running).toHaveLength(16)
    expect(docker?.running).toContain('jellyfin')
    expect(docker?.running).not.toContain('stream')
  })

  it('includes hidden containers so they still count as seen', () => {
    const { docker } = buildSnapshot(
      recorded,
      { ...settings, hiddenContainers: ['homepage'] },
      null,
      RUNNING
    )
    expect(docker?.running).toContain('homepage')
  })

  it('is null when docker could not be read', () => {
    const out = snapshotOutput({ docker: 'sudo: a password is required\n' })
    expect(buildSnapshot(out, settings, null, RUNNING).docker).toBeNull()
  })
})

describe('buildSnapshot when data cannot be read', () => {
  it('shows one unknown docker row (not down) when docker output is unreadable', () => {
    const out = snapshotOutput({ docker: 'sudo: a password is required\n' })
    const { services } = buildSnapshot(out, settings, null, RUNNING)
    expect(services.map((s) => s.id)).toEqual(['docker', 'tailscaled'])
    expect(services[0]).toMatchObject({
      label: 'Docker',
      level: 'unknown',
      detail: 'Lecture Docker impossible'
    })
    expect(services[1].level).toBe('ok')
  })

  it('marks tailscale unknown when systemd output is missing', () => {
    const out = snapshotOutput({ systemd: '' })
    const { services } = buildSnapshot(out, settings, null, RUNNING)
    expect(services.at(-1)).toMatchObject({
      level: 'unknown',
      detail: 'Lecture systemd impossible'
    })
  })

  it('never throws on empty output and leaves metrics empty', () => {
    const { services, metrics, cpuSample } = buildSnapshot('', settings, null, RUNNING)
    expect(services.every((s) => s.level === 'unknown')).toBe(true)
    expect(metrics).toEqual({
      cpuPercent: null,
      memoryUsedPercent: null,
      memoryTotalKb: null,
      swapUsedPercent: null,
      swapTotalKb: null,
      network: null,
      temperatureC: null,
      load: null,
      uptimeSeconds: null,
      diskThresholdPercent: 85,
      disks: []
    })
    expect(cpuSample).toBeNull()
  })

  it('exposes the configured disk threshold so the UI can mark it', () => {
    const custom = buildSnapshot(recorded, { ...settings, diskThresholdPercent: 90 }, null)
    expect(custom.metrics.diskThresholdPercent).toBe(90)
  })
})

describe('buildSnapshot metrics (recorded output)', () => {
  const { metrics, cpuSample, netSample } = buildSnapshot(recorded, settings, null)

  it('parses memory, load and uptime', () => {
    expect(metrics.memoryUsedPercent).toBeCloseTo(17.66, 2)
    expect(metrics.memoryTotalKb).toBe(16251684)
    expect(metrics.load).toEqual({ load1: 0.07, load5: 0.08, load15: 0.08 })
    expect(metrics.uptimeSeconds).toBe(365415.79)
  })

  it('parses swap and the cpu temperature', () => {
    expect(metrics.swapUsedPercent).toBeCloseTo(16.76, 2)
    expect(metrics.swapTotalKb).toBe(4194300)
    expect(metrics.temperatureC).toBe(55)
  })

  it('has no swap value on a machine without swap', () => {
    const none = snapshotOutput({
      meminfo: 'MemTotal: 1000 kB\nMemAvailable: 500 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n'
    })
    const { metrics: m } = buildSnapshot(none, settings, null)
    expect(m.swapUsedPercent).toBeNull()
    expect(m.swapTotalKb).toBeNull()
  })

  it('has no temperature when no sensor can be read', () => {
    const { metrics: m } = buildSnapshot(snapshotOutput({ thermal: '' }), settings, null)
    expect(m.temperatureC).toBeNull()
  })

  it('has no network rate on the first cycle, but keeps the counters for the next one', () => {
    expect(metrics.network).toBeNull()
    expect(netSample).toEqual({
      rxBytes: 44015946651 + 1019348071,
      txBytes: 41771722990 + 49341404,
      atSec: 365415.79
    })
  })

  it('computes the network rate against the previous sample, on the server clock', () => {
    const previous = {
      rxBytes: 44015946651 + 1019348071 - 20000,
      txBytes: 41771722990 + 49341404 - 10000,
      atSec: 365415.79 - 2
    }
    const { metrics: m } = buildSnapshot(recorded, settings, null, new Set(), previous)
    expect(m.network).toEqual({ downBytesPerSec: 10000, upBytesPerSec: 5000 })
  })

  it('has no network sample when the counters or the uptime cannot be read', () => {
    expect(buildSnapshot(snapshotOutput({ net: '' }), settings, null).netSample).toBeNull()
    expect(buildSnapshot(snapshotOutput({ uptime: '' }), settings, null).netSample).toBeNull()
  })

  it('keeps the raw cpu sample for the next cycle', () => {
    expect(cpuSample).toEqual({ idle: 266795210, total: 273838069 })
  })

  it('has no cpu percentage on the first cycle', () => {
    expect(metrics.cpuPercent).toBeNull()
  })

  it('computes cpu usage against the previous sample', () => {
    const previous = { idle: 266795210 - 300, total: 273838069 - 400 }
    expect(buildSnapshot(recorded, settings, previous).metrics.cpuPercent).toBe(25)
  })

  it('selects disks without pseudo filesystems or excluded mounts', () => {
    expect(metrics.disks.map((d) => d.mount)).toEqual(['/', '/boot', '/mnt/nas'])
    const custom = buildSnapshot(recorded, { ...settings, excludedMounts: ['/mnt/nas'] }, null)
    expect(custom.metrics.disks.map((d) => d.mount)).toEqual(['/', '/boot', '/boot/efi'])
  })
})

describe('buildSnapshot disk threshold', () => {
  it('is below the default 85 % for every recorded disk', () => {
    const { metrics } = buildSnapshot(recorded, settings, null)
    expect(metrics.disks.some((d) => d.overThreshold)).toBe(false)
  })

  it('flags disks above a lower threshold', () => {
    const { metrics } = buildSnapshot(recorded, { ...settings, diskThresholdPercent: 30 }, null)
    expect(metrics.disks.map((d) => [d.mount, d.overThreshold])).toEqual([
      ['/', true],
      ['/boot', false],
      ['/mnt/nas', true]
    ])
  })

  it('only flags a disk strictly above the threshold', () => {
    const df = (used: number, free: number): string =>
      `Filesystem 1-blocks Used Available Capacity Mounted on\n/dev/sda1 ${used + free} ${used} ${free} 85% /\n`
    const at = buildSnapshot(snapshotOutput({ df: df(85, 15) }), settings, null)
    const above = buildSnapshot(snapshotOutput({ df: df(86, 14) }), settings, null)
    expect(at.metrics.disks[0].overThreshold).toBe(false)
    expect(above.metrics.disks[0].overThreshold).toBe(true)
  })
})

describe('overallLevel', () => {
  const ok = {
    id: 'a',
    label: 'a',
    kind: 'container' as const,
    level: 'ok' as const,
    detail: '',
    state: 'running' as const,
    project: null,
    ports: []
  }
  const base = {
    connection: 'online' as const,
    configured: true,
    services: [ok],
    metrics: buildSnapshot(recorded, settings, null).metrics
  }

  it('is unconfigured before host and fingerprint are set', () => {
    expect(overallLevel({ ...base, configured: false, connection: 'offline' })).toBe('unconfigured')
  })

  it('is offline unless the connection is online', () => {
    expect(overallLevel({ ...base, connection: 'offline' })).toBe('offline')
    expect(overallLevel({ ...base, connection: 'connecting' })).toBe('offline')
  })

  it('is pending when online without any data yet', () => {
    expect(overallLevel({ ...base, services: [], metrics: null })).toBe('pending')
  })

  it('is ok when everything is fine', () => {
    expect(overallLevel(base)).toBe('ok')
  })

  it('is down when a service is down or absent', () => {
    expect(overallLevel({ ...base, services: [ok, { ...ok, level: 'down' }] })).toBe('down')
    expect(overallLevel({ ...base, services: [{ ...ok, level: 'absent' }] })).toBe('down')
  })

  it('ignores stopped services', () => {
    expect(overallLevel({ ...base, services: [ok, { ...ok, level: 'stopped' }] })).toBe('ok')
  })

  it('is degraded for unhealthy or unreadable services', () => {
    expect(overallLevel({ ...base, services: [{ ...ok, level: 'degraded' }] })).toBe('degraded')
    expect(overallLevel({ ...base, services: [{ ...ok, level: 'unknown' }] })).toBe('degraded')
  })

  it('is degraded when a disk is over its threshold', () => {
    const over = buildSnapshot(recorded, { ...settings, diskThresholdPercent: 30 }, null).metrics
    expect(overallLevel({ ...base, metrics: over })).toBe('degraded')
  })

  it('prefers down over degraded', () => {
    const services = [
      { ...ok, level: 'degraded' as const },
      { ...ok, level: 'down' as const }
    ]
    expect(overallLevel({ ...base, services })).toBe('down')
  })
})
