import type {
  ContainerHealth,
  ContainerInfo,
  ContainerState,
  PublishedPort,
  ServiceLevel
} from '@shared/monitors'

// Fixed command, never built from input. Needs an exact sudoers rule for bento-dash.
// `.Status` stays last: it is the only free text, and may itself contain a `|`.
export const DOCKER_PS_COMMAND =
  'sudo -n docker ps -a --format \'{{.Names}}|{{.State}}|{{.Ports}}|{{.Label "com.docker.compose.project"}}|{{.Status}}\''

/** Ranges wider than this are not expanded (a published range is never a web UI). */
const MAX_PORT_RANGE = 32

const PORT_ENTRY = /^(.*):(\d+(?:-\d+)?)->(\d+(?:-\d+)?)\/(tcp|udp)$/

function range(spec: string): number[] {
  const [from, to = from] = spec.split('-').map(Number)
  if (to < from || to - from >= MAX_PORT_RANGE) return []
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

function normaliseBind(raw: string): string {
  const bind = raw.replace(/^\[(.*)\]$/, '$1')
  return bind === ':' ? '::' : bind
}

function isLoopback(bind: string): boolean {
  return bind === '::1' || bind.startsWith('127.')
}

/** Published (host-mapped) ports from docker's `.Ports`; exposed-only ports are ignored. */
export function parsePorts(raw: string): PublishedPort[] {
  const ports: PublishedPort[] = []
  for (const entry of raw.split(',').map((e) => e.trim())) {
    const match = entry.match(PORT_ENTRY)
    if (!match) continue
    const bind = normaliseBind(match[1])
    const proto = match[4] as 'tcp' | 'udp'
    const hostPorts = range(match[2])
    const containerPorts = range(match[3])
    if (hostPorts.length === 0 || hostPorts.length !== containerPorts.length) continue
    hostPorts.forEach((hostPort, i) => {
      const port: PublishedPort = {
        hostPort,
        containerPort: containerPorts[i],
        proto,
        bind,
        linkable: proto === 'tcp' && !isLoopback(bind)
      }
      const existing = ports.findIndex((p) => p.hostPort === hostPort && p.proto === proto)
      if (existing === -1) ports.push(port)
      else if (ports[existing].bind.includes(':') && !bind.includes(':')) ports[existing] = port
    })
  }
  return ports
}

const STATES: readonly ContainerState[] = [
  'running',
  'exited',
  'restarting',
  'paused',
  'created',
  'dead'
]

function parseState(raw: string): ContainerState {
  return STATES.find((s) => s === raw) ?? 'unknown'
}

function parseHealth(status: string): ContainerHealth | null {
  if (status.includes('(unhealthy)')) return 'unhealthy'
  if (status.includes('(healthy)')) return 'healthy'
  if (status.includes('(health: starting)')) return 'starting'
  return null
}

function parseExitCode(state: ContainerState, status: string): number | null {
  if (state !== 'exited') return null
  const match = status.match(/^Exited \((\d+)\)/)
  return match ? Number(match[1]) : null
}

export function parseDockerPs(output: string): ContainerInfo[] {
  const containers: ContainerInfo[] = []
  for (const line of output.split(/\r?\n/)) {
    const [name, rawState, rawPorts, project, ...rest] = line.split('|')
    if (!name || !rawState || rawPorts === undefined || project === undefined) continue
    if (rest.length === 0) continue
    const status = rest.join('|')
    const state = parseState(rawState)
    containers.push({
      name,
      state,
      status,
      health: parseHealth(status),
      exitCode: parseExitCode(state, status),
      project: project || null,
      ports: parsePorts(rawPorts)
    })
  }
  return containers
}

export function containerLevel(container: ContainerInfo | undefined): ServiceLevel {
  if (!container) return 'absent'
  if (container.state !== 'running') return 'down'
  return container.health === 'unhealthy' || container.health === 'starting' ? 'degraded' : 'ok'
}
