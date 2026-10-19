import type { Settings } from '@shared/settings'
import { containerLabel } from '@shared/labels'
import type {
  ConnectionState,
  ContainerInfo,
  CpuSample,
  DockerInventory,
  Metrics,
  NetSample,
  OverallLevel,
  ServiceStatus,
  Snapshot
} from '@shared/monitors'
import { containerLevel, DOCKER_PS_COMMAND, parseDockerPs } from './containers'
import {
  cpuUsagePercent,
  memoryUsedPercent,
  netRate,
  parseDf,
  parseLoadAvg,
  parseMemInfo,
  parseNetDev,
  parseProcStat,
  parseThermal,
  parseUptime,
  selectDisks,
  swapUsedPercent
} from './metrics'
import { describeUnit, parseSystemctlShow, SYSTEMCTL_SHOW_COMMAND, unitLevel } from './systemd'

const section = (name: string, command: string): string => `echo '@@${name}'; ${command}`

/**
 * The one command sent to bento each cycle: fixed, read-only, never built from input.
 * Sections are chained with `;` so a failure in one (e.g. docker) does not hide the others.
 * `timeout` keeps a hung command (dead NFS mount, stuck docker) from blocking the whole cycle.
 */
export const SNAPSHOT_COMMAND = [
  section('docker', `timeout 10 ${DOCKER_PS_COMMAND}`),
  section('systemd', SYSTEMCTL_SHOW_COMMAND),
  section('loadavg', 'cat /proc/loadavg'),
  section('uptime', 'cat /proc/uptime'),
  section('stat', 'head -1 /proc/stat'),
  section('meminfo', "grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree):' /proc/meminfo"),
  section('net', 'cat /proc/net/dev'),
  // One "<zone type>|<millidegrees>" line per thermal zone; a missing sensor just yields no line.
  section(
    'thermal',
    'for z in /sys/class/thermal/thermal_zone*; do echo "$(cat $z/type)|$(cat $z/temp)"; done'
  ),
  section('df', 'timeout 5 df -P -B1 -x tmpfs -x devtmpfs -x squashfs')
].join('; ')

const MARKER = /^@@(\w+)$/

export function splitSections(output: string): Record<string, string> {
  const sections: Record<string, string> = {}
  const lines = output.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  let current: string | null = null
  for (const line of lines) {
    const marker = line.match(MARKER)
    if (marker) {
      current = marker[1]
      sections[current] = ''
    } else if (current) {
      sections[current] += `${line}\n`
    }
  }
  return sections
}

/**
 * Every container docker reports becomes a service. A container that is not running only raises
 * an alert (`down`) if it was running before (`expectedRunning`); otherwise it is `stopped`, which
 * is shown but neutral, so containers that were already stopped never alarm.
 */
function containerServices(
  containers: ContainerInfo[],
  settings: Pick<Settings, 'hiddenContainers' | 'containerLabels'>,
  expectedRunning: ReadonlySet<string>
): ServiceStatus[] {
  return containers
    .filter((c) => !settings.hiddenContainers.includes(c.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((container) => {
      const level = containerLevel(container)
      return {
        id: container.name,
        label: containerLabel(container.name, settings),
        kind: 'container',
        level: level === 'down' && !expectedRunning.has(container.name) ? 'stopped' : level,
        detail: container.status,
        state: container.state,
        project: container.project,
        ports: container.ports
      }
    })
}

export function buildSnapshot(
  output: string,
  settings: Settings,
  previousCpu: CpuSample | null,
  expectedRunning: ReadonlySet<string> = new Set(),
  previousNet: NetSample | null = null
): Snapshot {
  const sections = splitSections(output)

  const containers = parseDockerPs(sections['docker'] ?? '')
  const docker: DockerInventory | null =
    containers.length > 0
      ? {
          present: containers.map((c) => c.name),
          running: containers.filter((c) => c.state === 'running').map((c) => c.name)
        }
      : null
  const dockerServices: ServiceStatus[] = docker
    ? containerServices(containers, settings, expectedRunning)
    : [
        {
          id: 'docker',
          label: 'Docker',
          kind: 'container',
          level: 'unknown',
          detail: 'Lecture Docker impossible',
          state: null,
          project: null,
          ports: []
        }
      ]

  const uptimeSeconds = parseUptime(sections['uptime'] ?? '')
  const tailscale = parseSystemctlShow(sections['systemd'] ?? '').find(
    (u) => u.id === 'tailscaled.service'
  )
  const tailscaleService: ServiceStatus = tailscale
    ? {
        id: 'tailscaled',
        label: 'Tailscale',
        kind: 'systemd',
        level: unitLevel(tailscale),
        detail: describeUnit(tailscale, uptimeSeconds),
        state: null,
        project: null,
        ports: []
      }
    : {
        id: 'tailscaled',
        label: 'Tailscale',
        kind: 'systemd',
        level: 'unknown',
        detail: 'Lecture systemd impossible',
        state: null,
        project: null,
        ports: []
      }

  const cpuSample = parseProcStat(sections['stat'] ?? '')
  const memory = parseMemInfo(sections['meminfo'] ?? '')
  const counters = parseNetDev(sections['net'] ?? '')
  // The server's own uptime is the time base of the rate: no dependency on our clock or latency.
  const netSample: NetSample | null =
    counters && uptimeSeconds !== null ? { ...counters, atSec: uptimeSeconds } : null
  const metrics: Metrics = {
    cpuPercent: cpuSample && previousCpu ? cpuUsagePercent(previousCpu, cpuSample) : null,
    memoryUsedPercent: memory ? memoryUsedPercent(memory) : null,
    memoryTotalKb: memory?.totalKb ?? null,
    swapUsedPercent: memory ? swapUsedPercent(memory) : null,
    swapTotalKb: memory && memory.swapTotalKb > 0 ? memory.swapTotalKb : null,
    network: netRate(previousNet, netSample),
    temperatureC: parseThermal(sections['thermal'] ?? ''),
    load: parseLoadAvg(sections['loadavg'] ?? ''),
    uptimeSeconds,
    diskThresholdPercent: settings.diskThresholdPercent,
    disks: selectDisks(parseDf(sections['df'] ?? ''), settings.excludedMounts).map((disk) => ({
      ...disk,
      overThreshold: disk.usedPercent > settings.diskThresholdPercent
    }))
  }

  return {
    services: [...dockerServices, tailscaleService],
    docker,
    metrics,
    cpuSample,
    netSample
  }
}

export function overallLevel(input: {
  connection: ConnectionState
  configured: boolean
  services: ServiceStatus[]
  metrics: Metrics | null
}): OverallLevel {
  if (!input.configured) return 'unconfigured'
  if (input.connection !== 'online') return 'offline'
  if (input.services.length === 0 && input.metrics === null) return 'pending'
  if (input.services.some((s) => s.level === 'down' || s.level === 'absent')) return 'down'
  if (
    input.services.some((s) => s.level === 'degraded' || s.level === 'unknown') ||
    input.metrics?.disks.some((d) => d.overThreshold)
  ) {
    return 'degraded'
  }
  return 'ok'
}
