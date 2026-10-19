import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  memoryUsedPercent,
  netRate,
  parseMemInfo,
  parseNetDev,
  parseThermal,
  swapUsedPercent
} from '../src/main/monitors/metrics'

const fixture = (name: string): string => readFileSync(resolve('tests/fixtures', name), 'utf-8')

describe('swap (recorded)', () => {
  const mem = parseMemInfo(fixture('meminfo.txt'))

  it('reads the swap lines next to the memory ones', () => {
    expect(mem).toEqual({
      totalKb: 16251684,
      availableKb: 13382052,
      swapTotalKb: 4194300,
      swapFreeKb: 3491228
    })
  })

  it('computes the used percentages', () => {
    expect(memoryUsedPercent(mem!)).toBeCloseTo(17.66, 2)
    expect(swapUsedPercent(mem!)).toBeCloseTo(16.76, 2)
  })

  it('has no swap percentage on a machine without swap', () => {
    const none = parseMemInfo(
      'MemTotal: 1000 kB\nMemAvailable: 500 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n'
    )
    expect(none).toMatchObject({ swapTotalKb: 0, swapFreeKb: 0 })
    expect(swapUsedPercent(none!)).toBeNull()
  })

  it('treats missing swap lines as no swap', () => {
    const missing = parseMemInfo('MemTotal: 1000 kB\nMemAvailable: 500 kB\n')
    expect(missing).toMatchObject({ swapTotalKb: 0, swapFreeKb: 0 })
    expect(swapUsedPercent(missing!)).toBeNull()
  })

  it('still needs the memory lines', () => {
    expect(parseMemInfo('SwapTotal: 10 kB\nSwapFree: 5 kB\n')).toBeNull()
  })
})

describe('parseNetDev (recorded)', () => {
  it('sums only the physical interfaces: ethernet and wifi', () => {
    expect(parseNetDev(fixture('net-dev.txt'))).toEqual({
      rxBytes: 44015946651 + 1019348071,
      txBytes: 41771722990 + 49341404
    })
  })

  it('ignores loopback, tailscale, bridges, docker and veth interfaces', () => {
    const virtual = fixture('net-dev.txt')
      .split('\n')
      .filter((line) => !/^(enx|wlp)/.test(line.trim()))
      .join('\n')
    expect(parseNetDev(virtual)).toBeNull()
  })
})

describe('parseNetDev (synthetic input)', () => {
  const line = (name: string, rx: number, tx: number): string =>
    `${name}: ${rx} 1 0 0 0 0 0 0 ${tx} 1 0 0 0 0 0 0`

  it.each(['eth0', 'enp3s0', 'ens18', 'wlan0', 'wlp2s0'])('counts %s', (name) => {
    expect(parseNetDev(line(name, 10, 20))).toEqual({ rxBytes: 10, txBytes: 20 })
  })

  it.each(['lo', 'tailscale0', 'docker0', 'br-1a2b3c', 'veth1234', 'virbr0'])(
    'ignores %s',
    (name) => {
      expect(parseNetDev(line(name, 10, 20))).toBeNull()
    }
  )

  it('reads a line without a space after the colon (large counters)', () => {
    expect(parseNetDev('eth0:123456789012 1 0 0 0 0 0 0 99 1 0 0 0 0 0 0')).toEqual({
      rxBytes: 123456789012,
      txBytes: 99
    })
  })

  it('adds several physical interfaces together', () => {
    expect(parseNetDev([line('eth0', 10, 20), line('wlan0', 1, 2)].join('\n'))).toEqual({
      rxBytes: 11,
      txBytes: 22
    })
  })

  it('returns null for empty or unreadable output', () => {
    expect(parseNetDev('')).toBeNull()
    expect(parseNetDev('cat: /proc/net/dev: No such file')).toBeNull()
    expect(parseNetDev('eth0: abc 1 0 0 0 0 0 0 def 1 0 0 0 0 0 0')).toBeNull()
  })
})

describe('netRate', () => {
  const sample = (
    rxBytes: number,
    txBytes: number,
    atSec: number
  ): Parameters<typeof netRate>[0] => ({
    rxBytes,
    txBytes,
    atSec
  })

  it('divides the counter difference by the elapsed time', () => {
    expect(netRate(sample(1000, 500, 100), sample(3000, 1500, 102))).toEqual({
      downBytesPerSec: 1000,
      upBytesPerSec: 500
    })
  })

  it('is zero when nothing moved', () => {
    expect(netRate(sample(5, 5, 10), sample(5, 5, 40))).toEqual({
      downBytesPerSec: 0,
      upBytesPerSec: 0
    })
  })

  it('is null without a previous sample', () => {
    expect(netRate(null, sample(1, 1, 10))).toBeNull()
    expect(netRate(sample(1, 1, 10), null)).toBeNull()
  })

  it('is null when time did not move forward', () => {
    expect(netRate(sample(1, 1, 10), sample(2, 2, 10))).toBeNull()
    expect(netRate(sample(1, 1, 10), sample(2, 2, 9))).toBeNull()
  })

  it('is null when a counter went backwards (interface reset or server rebooted)', () => {
    expect(netRate(sample(1000, 10, 10), sample(500, 20, 12))).toBeNull()
    expect(netRate(sample(10, 1000, 10), sample(20, 500, 12))).toBeNull()
  })
})

describe('parseThermal (recorded)', () => {
  it('takes the cpu package temperature, in degrees', () => {
    expect(parseThermal(fixture('thermal.txt'))).toBe(55)
  })

  it('does not trust the other zones on this machine', () => {
    const withoutCpu = fixture('thermal.txt')
      .split('\n')
      .filter((l) => !l.startsWith('x86_pkg_temp'))
      .join('\n')
    expect(parseThermal(withoutCpu)).toBe(39) // acpitz, the next best known zone
  })
})

describe('parseThermal (synthetic input)', () => {
  it('prefers a known cpu zone, whatever the order', () => {
    expect(parseThermal('acpitz|30000\nx86_pkg_temp|61500\n')).toBe(61.5)
    expect(parseThermal('coretemp|50000\nacpitz|30000\n')).toBe(50)
  })

  it('finds an arm cpu zone', () => {
    expect(parseThermal('cpu-thermal|47000\n')).toBe(47)
  })

  it('returns null when only unknown or meaningless zones exist', () => {
    expect(parseThermal('SEN1|50\nSEN2|100050\nB0D4|53000\n')).toBeNull()
  })

  it('ignores a cpu zone with an impossible value and falls back', () => {
    expect(parseThermal('x86_pkg_temp|-274000\nacpitz|40000\n')).toBe(40)
    expect(parseThermal('x86_pkg_temp|900000\nacpitz|40000\n')).toBe(40)
    expect(parseThermal('x86_pkg_temp|abc\nacpitz|40000\n')).toBe(40)
  })

  it('returns null for empty or garbage output', () => {
    expect(parseThermal('')).toBeNull()
    expect(parseThermal('|\n')).toBeNull()
    expect(parseThermal('cat: /sys/class/thermal/thermal_zone*/type: No such file\n|\n')).toBeNull()
  })

  it('handles CRLF line endings and blank lines', () => {
    expect(parseThermal('\r\nx86_pkg_temp|55000\r\n\r\n')).toBe(55)
  })
})
