import {
  formatBytes,
  formatLoad,
  formatMemoryKb,
  formatPercent,
  formatTemperature,
  formatUptime
} from '@shared/format'
import type { Metrics } from '@shared/monitors'

export interface FigureRow {
  label: string
  value: string
}

export interface DiskFigure {
  mount: string
  /** Fill in percent, for the bar. */
  percent: number
  /** "42 % · 120 Go / 500 Go". */
  value: string
  /** Above the threshold set on the desktop. */
  alert: boolean
}

export interface SystemFigures {
  rows: FigureRow[]
  disks: DiskFigure[]
}

/** The system card of the page: text only, formatted like the desktop app does. */
export function systemFigures(metrics: Metrics): SystemFigures {
  const rows: FigureRow[] = [
    { label: 'Processeur', value: formatPercent(metrics.cpuPercent) },
    {
      label: 'Mémoire',
      value:
        metrics.memoryUsedPercent === null
          ? formatPercent(null)
          : `${formatPercent(metrics.memoryUsedPercent)} · ${formatMemoryKb(metrics.memoryTotalKb)}`
    },
    { label: 'Disponibilité', value: formatUptime(metrics.uptimeSeconds) },
    { label: 'Charge', value: formatLoad(metrics.load) }
  ]
  if (metrics.temperatureC !== null) {
    rows.push({ label: 'Température', value: formatTemperature(metrics.temperatureC) })
  }

  const disks = metrics.disks.map((disk) => ({
    mount: disk.mount,
    percent: disk.usedPercent,
    value: `${formatPercent(disk.usedPercent)} · ${formatBytes(disk.usedBytes)} / ${formatBytes(disk.totalBytes)}`,
    alert: disk.overThreshold
  }))
  return { rows, disks }
}
