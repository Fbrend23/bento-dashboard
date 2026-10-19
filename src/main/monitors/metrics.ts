import type {
  CpuSample,
  DiskInfo,
  LoadAverage,
  MemoryInfo,
  NetSample,
  NetworkRate
} from '@shared/monitors'

export const DEFAULT_EXCLUDED_MOUNTS: readonly string[] = ['/boot/efi']

export function parseLoadAvg(output: string): LoadAverage | null {
  const [a, b, c] = output.trim().split(/\s+/).map(Number)
  if (![a, b, c].every(Number.isFinite)) return null
  return { load1: a, load5: b, load15: c }
}

export function parseUptime(output: string): number | null {
  const seconds = Number(output.trim().split(/\s+/)[0])
  return output.trim() !== '' && Number.isFinite(seconds) ? seconds : null
}

export function parseMemInfo(output: string): MemoryInfo | null {
  const total = output.match(/^MemTotal:\s+(\d+)\s+kB/m)
  const available = output.match(/^MemAvailable:\s+(\d+)\s+kB/m)
  if (!total || !available) return null
  const swapTotal = output.match(/^SwapTotal:\s+(\d+)\s+kB/m)
  const swapFree = output.match(/^SwapFree:\s+(\d+)\s+kB/m)
  return {
    totalKb: Number(total[1]),
    availableKb: Number(available[1]),
    swapTotalKb: swapTotal ? Number(swapTotal[1]) : 0,
    swapFreeKb: swapFree ? Number(swapFree[1]) : 0
  }
}

export function memoryUsedPercent(mem: MemoryInfo): number {
  return (1 - mem.availableKb / mem.totalKb) * 100
}

/** Null when there is no swap at all. */
export function swapUsedPercent(mem: MemoryInfo): number | null {
  return mem.swapTotalKb > 0 ? (1 - mem.swapFreeKb / mem.swapTotalKb) * 100 : null
}

export function parseProcStat(output: string): CpuSample | null {
  const fields = output.trim().split(/\s+/)
  if (fields[0] !== 'cpu') return null
  // user nice system idle iowait irq softirq steal (guest ticks are already in user/nice)
  const ticks = fields.slice(1, 9).map(Number)
  if (ticks.length < 8 || !ticks.every(Number.isFinite)) return null
  return { idle: ticks[3] + ticks[4], total: ticks.reduce((sum, t) => sum + t, 0) }
}

export function cpuUsagePercent(prev: CpuSample, next: CpuSample): number {
  const totalDelta = next.total - prev.total
  if (totalDelta <= 0) return 0
  const usage = (1 - (next.idle - prev.idle) / totalDelta) * 100
  return Math.min(100, Math.max(0, usage))
}

const DF_ROW = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/

export function parseDf(output: string): DiskInfo[] {
  const disks: DiskInfo[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(DF_ROW)
    if (!match) continue
    const [, filesystem, total, used, available, mount] = match
    const usedBytes = Number(used)
    const availableBytes = Number(available)
    const denominator = usedBytes + availableBytes
    disks.push({
      filesystem,
      mount,
      totalBytes: Number(total),
      usedBytes,
      availableBytes,
      usedPercent: denominator > 0 ? (usedBytes / denominator) * 100 : 0
    })
  }
  return disks
}

/** Keeps real block devices and network mounts; drops pseudo filesystems and excluded mounts. */
export function selectDisks(
  disks: DiskInfo[],
  excludedMounts: readonly string[] = DEFAULT_EXCLUDED_MOUNTS
): DiskInfo[] {
  return disks.filter(
    (d) =>
      (d.filesystem.startsWith('/') || d.filesystem.includes(':')) &&
      !excludedMounts.includes(d.mount)
  )
}

// Physical interfaces only: ethernet (eth0, enp3s0, enx…) and wifi (wlan0, wlp2s0). Loopback,
// bridges, docker/veth and tailscale0 would count the same traffic twice.
const PHYSICAL_INTERFACE = /^(?:eth\d+|en[a-z0-9]+|wl[a-z0-9]+)$/

/** Total bytes received and sent by the physical interfaces, from `/proc/net/dev`. */
export function parseNetDev(output: string): Omit<NetSample, 'atSec'> | null {
  let rxBytes = 0
  let txBytes = 0
  let found = false
  for (const line of output.split(/\r?\n/)) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    if (!PHYSICAL_INTERFACE.test(line.slice(0, colon).trim())) continue
    const fields = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/)
      .map(Number)
    // Receive bytes is the first column, transmit bytes the ninth.
    if (fields.length < 9 || !Number.isFinite(fields[0]) || !Number.isFinite(fields[8])) continue
    rxBytes += fields[0]
    txBytes += fields[8]
    found = true
  }
  return found ? { rxBytes, txBytes } : null
}

/** Null without two samples, when time did not advance, or when a counter went backwards. */
export function netRate(previous: NetSample | null, current: NetSample | null): NetworkRate | null {
  if (!previous || !current) return null
  const elapsed = current.atSec - previous.atSec
  if (!(elapsed > 0)) return null
  const down = current.rxBytes - previous.rxBytes
  const up = current.txBytes - previous.txBytes
  if (down < 0 || up < 0) return null
  return { downBytesPerSec: down / elapsed, upBytesPerSec: up / elapsed }
}

// Thermal zones worth trusting, best first. The others on a machine are often meaningless (virtual
// zones, sensors that report 50 or 100050) and are never shown.
const CPU_ZONES: readonly string[] = [
  'x86_pkg_temp',
  'coretemp',
  'k10temp',
  'cpu-thermal',
  'cpu_thermal',
  'acpitz'
]

/** Cpu temperature in degrees, from lines of "<zone type>|<millidegrees>". */
export function parseThermal(output: string): number | null {
  const zones = new Map<string, number>()
  for (const line of output.split(/\r?\n/)) {
    const bar = line.lastIndexOf('|')
    if (bar <= 0) continue
    const degrees = Number(line.slice(bar + 1).trim()) / 1000
    // A real cpu reading; anything outside is a broken sensor.
    if (!Number.isFinite(degrees) || degrees <= 0 || degrees >= 150) continue
    const type = line.slice(0, bar).trim()
    if (!zones.has(type)) zones.set(type, degrees)
  }
  for (const zone of CPU_ZONES) {
    const degrees = zones.get(zone)
    if (degrees !== undefined) return degrees
  }
  return null
}
