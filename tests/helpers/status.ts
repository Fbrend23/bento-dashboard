import type { BentoStatus, DiskStatus, Metrics, ServiceStatus } from '@shared/monitors'

export const service = (overrides: Partial<ServiceStatus> = {}): ServiceStatus => ({
  id: 'jellyfin',
  label: 'jellyfin',
  kind: 'container',
  level: 'ok',
  detail: 'Up 4 days',
  state: 'running',
  project: null,
  ports: [],
  ...overrides
})

export const tailscale = (overrides: Partial<ServiceStatus> = {}): ServiceStatus =>
  service({
    id: 'tailscaled',
    label: 'Tailscale',
    kind: 'systemd',
    detail: 'active (running)',
    state: null,
    ...overrides
  })

export const disk = (overrides: Partial<DiskStatus> = {}): DiskStatus => ({
  filesystem: '/dev/sda1',
  mount: '/',
  totalBytes: 100,
  usedBytes: 30,
  availableBytes: 70,
  usedPercent: 30,
  overThreshold: false,
  ...overrides
})

export const metrics = (disks: DiskStatus[] = [disk()]): Metrics => ({
  cpuPercent: 5,
  memoryUsedPercent: 20,
  memoryTotalKb: 16251684,
  swapUsedPercent: null,
  swapTotalKb: null,
  network: null,
  temperatureC: null,
  load: { load1: 0.1, load5: 0.1, load15: 0.1 },
  uptimeSeconds: 1000,
  diskThresholdPercent: 85,
  disks
})

export const status = (overrides: Partial<BentoStatus> = {}): BentoStatus => ({
  connection: 'online',
  configured: true,
  lastError: null,
  updatedAt: 1,
  overall: 'ok',
  services: [service(), tailscale()],
  metrics: metrics(),
  ...overrides
})
