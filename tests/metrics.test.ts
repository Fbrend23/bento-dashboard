import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  cpuUsagePercent,
  DEFAULT_EXCLUDED_MOUNTS,
  memoryUsedPercent,
  parseDf,
  parseLoadAvg,
  parseMemInfo,
  parseProcStat,
  parseUptime,
  selectDisks
} from '../src/main/monitors/metrics'

const fixture = (name: string): string => readFileSync(resolve('tests/fixtures', name), 'utf-8')

describe('parseLoadAvg (recorded)', () => {
  it('parses the three load averages', () => {
    expect(parseLoadAvg(fixture('loadavg.txt'))).toEqual({ load1: 0.07, load5: 0.08, load15: 0.08 })
  })

  it('returns null for malformed output', () => {
    expect(parseLoadAvg('')).toBeNull()
    expect(parseLoadAvg('a b c')).toBeNull()
  })
})

describe('parseUptime (recorded)', () => {
  it('parses uptime in seconds', () => {
    expect(parseUptime(fixture('uptime.txt'))).toBe(365415.79)
  })

  it('returns null for malformed output', () => {
    expect(parseUptime('')).toBeNull()
    expect(parseUptime('nope')).toBeNull()
  })
})

describe('parseMemInfo (recorded)', () => {
  const mem = parseMemInfo(fixture('meminfo.txt'))

  it('parses total and available memory in kB', () => {
    expect(mem).toMatchObject({ totalKb: 16251684, availableKb: 13382052 })
  })

  it('computes the used percentage from available memory', () => {
    expect(memoryUsedPercent(mem!)).toBeCloseTo(17.66, 2)
  })

  it('returns null when a field is missing', () => {
    expect(parseMemInfo('MemTotal:       16251684 kB\n')).toBeNull()
    expect(parseMemInfo('')).toBeNull()
  })
})

describe('parseProcStat (recorded)', () => {
  it('sums busy and idle ticks (idle includes iowait)', () => {
    expect(parseProcStat(fixture('proc-stat.txt'))).toEqual({
      idle: 266795210,
      total: 273838069
    })
  })

  it('returns null for malformed output', () => {
    expect(parseProcStat('')).toBeNull()
    expect(parseProcStat('cpu0 1 2 3')).toBeNull()
  })
})

describe('cpuUsagePercent (synthetic samples)', () => {
  it('computes usage between two samples', () => {
    expect(cpuUsagePercent({ idle: 1000, total: 2000 }, { idle: 1300, total: 2400 })).toBe(25)
  })

  it('returns 0 when no ticks elapsed', () => {
    expect(cpuUsagePercent({ idle: 5, total: 10 }, { idle: 5, total: 10 })).toBe(0)
  })

  it('clamps to the 0-100 range', () => {
    expect(cpuUsagePercent({ idle: 100, total: 200 }, { idle: 50, total: 210 })).toBe(100)
  })
})

describe('parseDf (recorded)', () => {
  const disks = parseDf(fixture('df.txt'))

  it('parses every filesystem row and skips the header', () => {
    expect(disks).toHaveLength(5)
  })

  it('parses sizes in bytes and the used percentage', () => {
    const root = disks[0]
    expect(root).toMatchObject({
      filesystem: '/dev/mapper/ubuntu--vg--1-ubuntu--lv',
      mount: '/',
      totalBytes: 980122034176,
      usedBytes: 290857922560,
      availableBytes: 639401177088
    })
    expect(root.usedPercent).toBeCloseTo(31.27, 1)
  })

  it('parses NFS mounts', () => {
    expect(disks[4]).toMatchObject({
      mount: '/mnt/nas',
      filesystem: '192.0.2.10:/export/media'
    })
  })

  it('keeps mount points containing spaces', () => {
    const out =
      'Filesystem 1-blocks Used Available Capacity Mounted on\n/dev/sdc1 100 40 60 40% /mnt/my disk\n'
    expect(parseDf(out)[0].mount).toBe('/mnt/my disk')
  })

  it('returns an empty list for empty output', () => {
    expect(parseDf('')).toEqual([])
  })
})

describe('selectDisks', () => {
  const disks = parseDf(fixture('df.txt'))

  it('drops pseudo filesystems and excluded mounts by default', () => {
    expect(DEFAULT_EXCLUDED_MOUNTS).toEqual(['/boot/efi'])
    expect(selectDisks(disks).map((d) => d.mount)).toEqual(['/', '/boot', '/mnt/nas'])
  })

  it('accepts a custom exclusion list', () => {
    expect(selectDisks(disks, ['/mnt/nas', '/boot/efi']).map((d) => d.mount)).toEqual([
      '/',
      '/boot'
    ])
  })
})
