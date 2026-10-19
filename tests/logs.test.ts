import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  describeCommandFailure,
  MAX_LINE_LENGTH,
  MAX_LOG_LINES,
  parseLogs,
  toLogsResult
} from '../src/main/monitors/logs'

const FIXTURES = [
  'docker-logs-jellyfin.txt',
  'docker-logs-proxy-app-1.txt',
  'journalctl-tailscaled.txt'
]
const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, 'fixtures', name), 'utf-8')
const ESC = String.fromCharCode(27)

describe('parseLogs on recorded logs', () => {
  it('reads 200 lines of jellyfin, in order, without terminal noise', () => {
    const lines = parseLogs(fixture('docker-logs-jellyfin.txt'))
    expect(lines).toHaveLength(200)
    expect(lines[0]).toBe('Unsupported codec with id 0 for input stream 7')
    expect(lines[2]).toMatch(/^\[19:11:15\] \[INF\] \[56\] MediaBrowser\.Providers\.TV/)
    // eslint-disable-next-line no-control-regex -- checking that none is left
    expect(lines.join('')).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/)
  })

  it('strips the ANSI colours of the nginx proxy manager banner', () => {
    const raw = fixture('docker-logs-proxy-app-1.txt')
    expect(raw).toContain(ESC)
    const lines = parseLogs(raw)
    expect(lines).toHaveLength(200)
    expect(lines.join('\n')).not.toContain(ESC)
    expect(lines[0]).toBe(
      '[10/14/2026] [2:01:25 PM] [SSL      ] › ℹ  info      Renewing SSL certs expiring within 30 days ...'
    )
  })

  it('reads 200 lines of tailscaled from the journal', () => {
    const lines = parseLogs(fixture('journalctl-tailscaled.txt'))
    expect(lines).toHaveLength(200)
    expect(lines[0]).toMatch(/^2026-10-16T02:11:57\+02:00 bento tailscaled\[1717\]: magicsock/)
  })

  it('keeps recorded lines intact (none reaches the truncation limit)', () => {
    for (const name of FIXTURES) {
      for (const line of parseLogs(fixture(name))) {
        expect(line.length).toBeLessThan(MAX_LINE_LENGTH)
      }
    }
  })

  it('keeps the fixtures free of identifying data', () => {
    const all = FIXTURES.map(fixture).join('\n')
    // Tailscale addresses (100.64.0.0/10) other than the documentation ones and the MagicDNS resolver.
    const tailnet =
      all.match(/\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g) ?? []
    expect(tailnet.filter((ip) => ip !== '100.100.100.100' && !ip.startsWith('100.64.0.'))).toEqual(
      []
    )
    // Only placeholder tailnet names.
    for (const name of all.match(/[\w-]+\.ts\.net/g) ?? []) expect(name).toMatch(/example/)
    // No user name of the person who recorded them.
    expect(all).not.toMatch(/\bbrendan\b/i)
  })
})

describe('parseLogs', () => {
  it('splits lines, drops the trailing newline and keeps order', () => {
    expect(parseLogs('a\nb\r\nc\n')).toEqual(['a', 'b', 'c'])
  })

  it('returns no line for empty output', () => {
    expect(parseLogs('')).toEqual([])
    expect(parseLogs('\n')).toEqual([])
  })

  it('keeps blank lines inside the log', () => {
    expect(parseLogs('a\n\nb\n')).toEqual(['a', '', 'b'])
  })

  it('strips ANSI colour sequences', () => {
    expect(parseLogs('\u001b[32mINFO\u001b[0m ready\n\u001b[1;31mERR\u001b[m x\n')).toEqual([
      'INFO ready',
      'ERR x'
    ])
  })

  it('strips control characters but keeps tabs', () => {
    expect(parseLogs('a\u0000b\u0007c\td\u001b]0;title\u0007e\n')).toEqual(['abc\tde'])
  })

  it('truncates very long lines', () => {
    const [line] = parseLogs(`${'x'.repeat(MAX_LINE_LENGTH + 500)}\n`)
    expect(line).toHaveLength(MAX_LINE_LENGTH + 1)
    expect(line.endsWith('…')).toBe(true)
  })

  it('keeps only the last 200 lines', () => {
    const output = Array.from({ length: MAX_LOG_LINES + 50 }, (_, i) => `line ${i}`).join('\n')
    const lines = parseLogs(output)
    expect(lines).toHaveLength(MAX_LOG_LINES)
    expect(lines[0]).toBe('line 50')
    expect(lines.at(-1)).toBe(`line ${MAX_LOG_LINES + 49}`)
  })
})

describe('describeCommandFailure', () => {
  it('explains a missing sudoers rule', () => {
    expect(
      describeCommandFailure({ stdout: '', stderr: 'sudo: a password is required\n', code: 1 })
    ).toBe('Règle sudoers manquante pour bento-dash.')
    expect(
      describeCommandFailure({
        stdout: '',
        stderr: 'Sorry, user bento-dash is not allowed to execute',
        code: 1
      })
    ).toBe('Règle sudoers manquante pour bento-dash.')
  })

  it('explains a timeout (exit code 124 from `timeout`)', () => {
    expect(describeCommandFailure({ stdout: '', stderr: '', code: 124 })).toBe(
      'Bento a mis trop de temps à répondre.'
    )
  })

  it('explains a missing container', () => {
    expect(
      describeCommandFailure({ stdout: '', stderr: 'Error: No such container: jellyfin', code: 1 })
    ).toBe('Conteneur introuvable.')
  })

  it('falls back to a generic message with the exit code', () => {
    expect(describeCommandFailure({ stdout: '', stderr: 'boom', code: 2 })).toBe(
      'La commande a échoué (code 2).'
    )
    expect(describeCommandFailure({ stdout: '', stderr: '', code: null })).toBe(
      'La commande a échoué.'
    )
  })
})

describe('toLogsResult', () => {
  it('returns the cleaned lines on success', () => {
    expect(toLogsResult({ stdout: 'a\nb\n', stderr: '', code: 0 }, 1234)).toEqual({
      ok: true,
      lines: ['a', 'b'],
      fetchedAt: 1234
    })
  })

  it('is a success with no line when the log is empty', () => {
    expect(toLogsResult({ stdout: '', stderr: '', code: 0 }, 1)).toEqual({
      ok: true,
      lines: [],
      fetchedAt: 1
    })
  })

  it('returns a readable error on failure, never the raw stderr', () => {
    expect(
      toLogsResult({ stdout: '', stderr: 'sudo: a password is required', code: 1 }, 1)
    ).toEqual({ ok: false, error: 'Règle sudoers manquante pour bento-dash.' })
  })
})
