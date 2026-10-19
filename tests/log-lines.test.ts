import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { parseLogs } from '../src/main/monitors/logs'
import {
  countByLevel,
  filterLogLines,
  parseLogLine,
  type LogLevelFilter
} from '../src/shared/log-lines'

const fixture = (name: string): string[] =>
  parseLogs(readFileSync(resolve(__dirname, 'fixtures', name), 'utf8'))

describe('parseLogLine', () => {
  it('reads a Jellyfin line', () => {
    expect(
      parseLogLine('[04:07:36] [WRN] [37] MediaBrowser.Controller.Entities.BaseItem: skipping')
    ).toEqual({
      time: '04:07:36',
      level: 'warn',
      text: '[37] MediaBrowser.Controller.Entities.BaseItem: skipping'
    })
    expect(parseLogLine('[19:11:15] [INF] [56] Foo: bar').level).toBe('info')
    expect(parseLogLine('[19:11:15] [ERR] [56] Foo: bar').level).toBe('error')
    expect(parseLogLine('[19:11:15] [FTL] [56] Foo: bar').level).toBe('error')
    expect(parseLogLine('[19:11:15] [DBG] [56] Foo: bar').level).toBe('debug')
  })

  it('reads an Nginx Proxy Manager line', () => {
    expect(
      parseLogLine('[10/14/2026] [2:01:25 PM] [SSL      ] › ℹ  info      Renewing SSL certs')
    ).toEqual({ time: '2:01:25 PM', level: 'info', text: '[SSL] Renewing SSL certs' })
    expect(parseLogLine('[10/14/2026] [2:01:25 PM] [Nginx    ] › ✖  error     boom').level).toBe(
      'error'
    )
    expect(parseLogLine('[10/14/2026] [2:01:25 PM] [Nginx    ] › ⚠  warning   hmm').level).toBe(
      'warn'
    )
    expect(parseLogLine('[10/14/2026] [2:01:25 PM] [Nginx    ] › ▶  start     x').level).toBeNull()
  })

  it('reads a journalctl line', () => {
    expect(parseLogLine('2026-10-16T02:11:57+02:00 bento tailscaled[1717]: dns: Set: ok')).toEqual({
      time: '02:11:57',
      level: null,
      text: 'tailscaled[1717]: dns: Set: ok'
    })
  })

  it('falls back to keywords on unstructured lines', () => {
    expect(parseLogLine('Unsupported codec with id 0')).toEqual({
      level: null,
      text: 'Unsupported codec with id 0'
    })
    expect(parseLogLine('FATAL: out of memory').level).toBe('error')
    expect(parseLogLine('Received error: PollNetMap').level).toBe('error')
    expect(parseLogLine('warning: deprecated').level).toBe('warn')
    expect(parseLogLine('terror management').level).toBeNull()
  })

  it('never throws and keeps the text of any recorded line', () => {
    for (const name of [
      'docker-logs-jellyfin.txt',
      'docker-logs-proxy-app-1.txt',
      'journalctl-tailscaled.txt'
    ]) {
      for (const line of fixture(name)) expect(parseLogLine(line).text).not.toBe(undefined)
    }
  })

  it('finds the warnings of the Jellyfin fixture', () => {
    const levels = countByLevel(fixture('docker-logs-jellyfin.txt'))
    expect(levels.warn).toBeGreaterThan(0)
    expect(levels.info).toBeGreaterThan(0)
  })
})

describe('filterLogLines', () => {
  const lines = [
    '[01:00:00] [INF] [1] Hello World',
    '[01:00:01] [WRN] [1] careful',
    '[01:00:02] [ERR] [1] broken'
  ]
  const run = (query: string, level: LogLevelFilter): string[] =>
    filterLogLines(lines, query, level)

  it('keeps everything with no filter', () => {
    expect(run('', 'all')).toEqual(lines)
  })
  it('searches case-insensitively, ignoring surrounding spaces', () => {
    expect(run('  hello world ', 'all')).toEqual([lines[0]])
  })
  it('filters by level', () => {
    expect(run('', 'errors')).toEqual([lines[2]])
    expect(run('', 'warnings')).toEqual([lines[1], lines[2]])
  })
  it('combines both', () => {
    expect(run('CAREFUL', 'errors')).toEqual([])
    expect(run('careful', 'warnings')).toEqual([lines[1]])
  })
})
