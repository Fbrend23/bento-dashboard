import type { ServiceLevel, SystemdUnit, UnitActiveState } from '@shared/monitors'

// Fixed command, never built from input. Only tailscaled is a systemd service on bento.
export const SYSTEMCTL_SHOW_COMMAND =
  'systemctl show tailscaled -p Id,ActiveState,SubState,ActiveEnterTimestamp,ActiveEnterTimestampMonotonic'

const ACTIVE_STATES: readonly UnitActiveState[] = [
  'active',
  'inactive',
  'failed',
  'activating',
  'deactivating',
  'reloading'
]

function parseActiveState(raw: string): UnitActiveState {
  return ACTIVE_STATES.find((s) => s === raw) ?? 'unknown'
}

/** Microseconds after boot; 0 means the unit never became active. */
function parseMonotonic(raw: string | undefined): number | null {
  const us = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
  return Number.isFinite(us) && us > 0 ? us : null
}

export function parseSystemctlShow(output: string): SystemdUnit[] {
  const units: SystemdUnit[] = []
  for (const block of output.split(/\r?\n\r?\n/)) {
    const props = new Map<string, string>()
    for (const line of block.split(/\r?\n/)) {
      const eq = line.indexOf('=')
      if (eq > 0) props.set(line.slice(0, eq), line.slice(eq + 1))
    }
    const id = props.get('Id')
    if (!id) continue
    units.push({
      id,
      activeState: parseActiveState(props.get('ActiveState') ?? ''),
      subState: props.get('SubState') ?? '',
      since: props.get('ActiveEnterTimestamp') || null,
      activeEnterMonotonicUs: parseMonotonic(props.get('ActiveEnterTimestampMonotonic'))
    })
  }
  return units
}

export function unitLevel(unit: SystemdUnit | undefined): ServiceLevel {
  if (!unit) return 'absent'
  switch (unit.activeState) {
    case 'active':
      return 'ok'
    case 'activating':
    case 'reloading':
      return 'degraded'
    default:
      return 'down'
  }
}

/**
 * How long a unit has been active, from the server's own clocks: its uptime minus the boot-relative
 * time at which the unit started. Null when either is unknown or they contradict each other.
 */
export function activeSeconds(
  unit: SystemdUnit | undefined,
  uptimeSeconds: number | null
): number | null {
  if (!unit || unit.activeEnterMonotonicUs === null || uptimeSeconds === null) return null
  const seconds = uptimeSeconds - unit.activeEnterMonotonicUs / 1e6
  // Both clocks are read a few milliseconds apart: tolerate a hair of negative, not more.
  return seconds >= -1 ? Math.max(0, seconds) : null
}

/** Docker's own wording ("Less than a second", "About an hour", "4 days"…), see go-units. */
function dockerDuration(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds)
  const minutes = Math.floor(totalSeconds / 60)
  const hours = Math.floor(totalSeconds / 3600)
  if (seconds < 1) return 'Less than a second'
  if (seconds === 1) return '1 second'
  if (seconds < 60) return `${seconds} seconds`
  if (minutes === 1) return 'About a minute'
  if (minutes < 60) return `${minutes} minutes`
  if (hours === 1) return 'About an hour'
  if (hours < 48) return `${hours} hours`
  if (hours < 24 * 7 * 2) return `${Math.floor(hours / 24)} days`
  if (hours < 24 * 30 * 2) return `${Math.floor(hours / 24 / 7)} weeks`
  if (hours < 24 * 365 * 2) return `${Math.floor(hours / 24 / 30)} months`
  return `${Math.floor(hours / 24 / 365)} years`
}

/**
 * Detail line of a unit. A running unit reads like a running container ("Up 4 days"), so the
 * dashboard words it the same way; any other state keeps systemd's "state (substate)".
 */
export function describeUnit(unit: SystemdUnit, uptimeSeconds: number | null): string {
  if (unit.activeState === 'active' && unit.subState === 'running') {
    const seconds = activeSeconds(unit, uptimeSeconds)
    if (seconds !== null) return `Up ${dockerDuration(seconds)}`
  }
  return `${unit.activeState} (${unit.subState})`
}
