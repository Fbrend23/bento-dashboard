// Monitor result types shared by main, preload and renderer.

export type ContainerState =
  'running' | 'exited' | 'restarting' | 'paused' | 'created' | 'dead' | 'unknown'

export type ContainerHealth = 'healthy' | 'unhealthy' | 'starting'

/** A port published on the host (`docker ps` "0.0.0.0:8989->8080/tcp"). */
export interface PublishedPort {
  hostPort: number
  containerPort: number
  proto: 'tcp' | 'udp'
  /** Host address the port is bound to, e.g. "0.0.0.0", "::" or "127.0.0.1". */
  bind: string
  /** True when a browser on another machine can reach it: tcp and not bound to loopback. */
  linkable: boolean
}

export interface ContainerInfo {
  name: string
  state: ContainerState
  /** Raw `.Status` text from docker, e.g. "Up 4 days (healthy)". */
  status: string
  /** Present only when the container defines a healthcheck. */
  health: ContainerHealth | null
  /** Present only for exited containers. */
  exitCode: number | null
  /** Docker compose project (stack) the container belongs to, null outside compose. */
  project: string | null
  ports: PublishedPort[]
}

/** Normalised level shown in the UI and used for notifications. */
/**
 * `absent`: readable but not found. `unknown`: the data could not be read at all.
 * `stopped`: a container that is not running and was never seen running by this app; shown, but
 * neutral (no alert, does not affect the overall level).
 */
export type ServiceLevel = 'ok' | 'degraded' | 'down' | 'absent' | 'unknown' | 'stopped'

export type UnitActiveState =
  'active' | 'inactive' | 'failed' | 'activating' | 'deactivating' | 'reloading' | 'unknown'

export interface SystemdUnit {
  /** e.g. "tailscaled.service" */
  id: string
  activeState: UnitActiveState
  subState: string
  /** Raw `ActiveEnterTimestamp`, null when the unit never started. */
  since: string | null
  /** `ActiveEnterTimestampMonotonic`: microseconds after boot at which the unit became active. */
  activeEnterMonotonicUs: number | null
}

export interface LoadAverage {
  load1: number
  load5: number
  load15: number
}

export interface MemoryInfo {
  totalKb: number
  availableKb: number
  /** Both 0 on a machine without swap. */
  swapTotalKb: number
  swapFreeKb: number
}

/** Cumulative bytes of the physical network interfaces, with the server time they were read at. */
export interface NetSample {
  rxBytes: number
  txBytes: number
  /** Server uptime in seconds at the read: the time base for the rate, independent of our clock. */
  atSec: number
}

export interface NetworkRate {
  downBytesPerSec: number
  upBytesPerSec: number
}

/** Cumulative CPU ticks from the first line of /proc/stat. */
export interface CpuSample {
  idle: number
  total: number
}

export interface DiskInfo {
  filesystem: string
  mount: string
  totalBytes: number
  usedBytes: number
  availableBytes: number
  usedPercent: number
}

export type ConnectionState = 'offline' | 'connecting' | 'online'

export interface ServiceStatus {
  id: string
  label: string
  kind: 'container' | 'systemd'
  level: ServiceLevel
  /** Short text shown next to the service, e.g. "Up 4 days (healthy)". */
  detail: string
  /** Raw docker state, which decides what can be done; null for systemd and for unreadable docker. */
  state: ContainerState | null
  /** Docker compose project (stack); null for a container outside compose and for systemd. */
  project: string | null
  /** Ports published on the host (containers only). */
  ports: PublishedPort[]
}

export interface DiskStatus extends DiskInfo {
  /** Strictly above the configured threshold. */
  overThreshold: boolean
}

export interface Metrics {
  cpuPercent: number | null
  memoryUsedPercent: number | null
  memoryTotalKb: number | null
  swapUsedPercent: number | null
  swapTotalKb: number | null
  network: NetworkRate | null
  /** Cpu package temperature in degrees Celsius, when the server exposes a readable sensor. */
  temperatureC: number | null
  load: LoadAverage | null
  uptimeSeconds: number | null
  diskThresholdPercent: number
  disks: DiskStatus[]
}

/** What docker reported this cycle, for the poller to maintain the "was running" memory. */
export interface DockerInventory {
  /** Every container docker knows, hidden ones included. */
  present: string[]
  running: string[]
}

export interface Snapshot {
  services: ServiceStatus[]
  /** Null when docker could not be read: the memory of running containers must not change. */
  docker: DockerInventory | null
  metrics: Metrics
  /** Raw cpu ticks, kept by the poller as the baseline of the next cycle. */
  cpuSample: CpuSample | null
  /** Raw network counters, kept by the poller as the baseline of the next cycle. */
  netSample: NetSample | null
}

export type OverallLevel = 'ok' | 'degraded' | 'down' | 'offline' | 'pending' | 'unconfigured'

/** Everything the renderer (and later the tray) needs, published as one object. */
export interface BentoStatus {
  connection: ConnectionState
  configured: boolean
  lastError: string | null
  updatedAt: number | null
  overall: OverallLevel
  services: ServiceStatus[]
  metrics: Metrics | null
}
