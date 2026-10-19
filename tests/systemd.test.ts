import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import type { SystemdUnit } from '@shared/monitors'
import {
  activeSeconds,
  describeUnit,
  parseSystemctlShow,
  SYSTEMCTL_SHOW_COMMAND,
  unitLevel
} from '../src/main/monitors/systemd'

const fixture = readFileSync(resolve('tests/fixtures/systemctl-show.txt'), 'utf-8')
const units = parseSystemctlShow(fixture)

describe('SYSTEMCTL_SHOW_COMMAND', () => {
  it('is a fixed read-only command limited to tailscaled', () => {
    expect(SYSTEMCTL_SHOW_COMMAND).toBe(
      'systemctl show tailscaled -p Id,ActiveState,SubState,ActiveEnterTimestamp,ActiveEnterTimestampMonotonic'
    )
  })
})

describe('parseSystemctlShow (recorded output from bento)', () => {
  it('parses the one unit asked for', () => {
    expect(units.map((u) => u.id)).toEqual(['tailscaled.service'])
  })

  it('parses an active unit with its start timestamp and its monotonic start time', () => {
    expect(units[0]).toEqual({
      id: 'tailscaled.service',
      activeState: 'active',
      subState: 'running',
      since: 'Mon 2026-10-12 04:01:06 CEST',
      activeEnterMonotonicUs: 8109844
    })
  })

  it('returns null for an empty timestamp and a zero monotonic time (never active)', () => {
    const [never] = parseSystemctlShow(
      'Id=a.service\nActiveState=inactive\nSubState=dead\nActiveEnterTimestamp=\nActiveEnterTimestampMonotonic=0\n'
    )
    expect(never).toMatchObject({ since: null, activeEnterMonotonicUs: null })
  })

  it('returns null for a missing or unreadable monotonic time', () => {
    const [missing] = parseSystemctlShow('Id=a.service\nActiveState=active\nSubState=running\n')
    const [garbage] = parseSystemctlShow(
      'Id=a.service\nActiveState=active\nSubState=running\nActiveEnterTimestampMonotonic=abc\n'
    )
    expect(missing.activeEnterMonotonicUs).toBeNull()
    expect(garbage.activeEnterMonotonicUs).toBeNull()
  })
})

describe('activeSeconds (recorded)', () => {
  it('is the server uptime minus the boot-relative start of the unit', () => {
    expect(activeSeconds(units[0], 365415.79)).toBeCloseTo(365407.68, 2)
  })

  it('is null when either side is unknown', () => {
    expect(activeSeconds(units[0], null)).toBeNull()
    expect(activeSeconds({ ...units[0], activeEnterMonotonicUs: null }, 365415.79)).toBeNull()
    expect(activeSeconds(undefined, 365415.79)).toBeNull()
  })

  it('is null when the unit would have started after the reading (inconsistent data)', () => {
    expect(activeSeconds({ ...units[0], activeEnterMonotonicUs: 9e12 }, 100)).toBeNull()
  })
})

describe('describeUnit', () => {
  const running = (uptimeSeconds: number | null): string => describeUnit(units[0], uptimeSeconds)

  it('shows how long a running unit has been up, in the same words as docker', () => {
    expect(running(365415.79)).toBe('Up 4 days')
  })

  it.each([
    [8.2, 'Up Less than a second'],
    [9.2, 'Up 1 second'],
    [13.5, 'Up 5 seconds'],
    [8.11 + 90, 'Up About a minute'],
    [8.11 + 600, 'Up 10 minutes'],
    [8.11 + 3700, 'Up About an hour'],
    [8.11 + 3 * 3600, 'Up 3 hours'],
    [8.11 + 3 * 86400, 'Up 3 days'],
    [8.11 + 21 * 86400, 'Up 3 weeks'],
    [8.11 + 95 * 86400, 'Up 3 months'],
    [8.11 + 900 * 86400, 'Up 2 years']
  ])('at uptime %d s: %s', (uptime, expected) => {
    expect(running(uptime)).toBe(expected)
  })

  it('falls back to the state when the uptime is unknown', () => {
    expect(running(null)).toBe('active (running)')
  })

  it('keeps the state for a unit that is not simply running', () => {
    const activating = { ...units[0], activeState: 'activating' as const, subState: 'start' }
    const exited = { ...units[0], subState: 'exited' }
    const failed = { ...units[0], activeState: 'failed' as const, subState: 'failed' }
    expect(describeUnit(activating, 1000)).toBe('activating (start)')
    expect(describeUnit(exited, 1000)).toBe('active (exited)')
    expect(describeUnit(failed, 1000)).toBe('failed (failed)')
  })
})

describe('parseSystemctlShow (edge cases, synthetic input)', () => {
  it('returns an empty list for empty output', () => {
    expect(parseSystemctlShow('')).toEqual([])
  })

  it('handles CRLF and a missing trailing blank line', () => {
    const out = 'Id=a.service\r\nActiveState=failed\r\nSubState=failed\r\nActiveEnterTimestamp=\r\n'
    expect(parseSystemctlShow(out)).toEqual([
      {
        id: 'a.service',
        activeState: 'failed',
        subState: 'failed',
        since: null,
        activeEnterMonotonicUs: null
      }
    ])
  })

  it('skips blocks without an Id', () => {
    expect(parseSystemctlShow('ActiveState=active\nSubState=running\n')).toEqual([])
  })

  it('maps an unrecognised active state to unknown', () => {
    const out = 'Id=a.service\nActiveState=weird\nSubState=x\nActiveEnterTimestamp=\n'
    expect(parseSystemctlShow(out)[0].activeState).toBe('unknown')
  })
})

describe('unitLevel', () => {
  const unit = (activeState: SystemdUnit['activeState'], subState: string): SystemdUnit => ({
    id: 'a',
    activeState,
    subState,
    since: null,
    activeEnterMonotonicUs: null
  })

  it('maps unit states to a service level', () => {
    expect(unitLevel(units[0])).toBe('ok')
    expect(unitLevel(unit('inactive', 'dead'))).toBe('down')
    expect(unitLevel(unit('failed', 'failed'))).toBe('down')
    expect(unitLevel(unit('activating', 'start'))).toBe('degraded')
    expect(unitLevel(unit('reloading', 'reload'))).toBe('degraded')
    expect(unitLevel(undefined)).toBe('absent')
  })
})
