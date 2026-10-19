import { readFileSync } from 'fs'
import { resolve } from 'path'

type Section =
  'docker' | 'systemd' | 'loadavg' | 'uptime' | 'stat' | 'meminfo' | 'net' | 'thermal' | 'df'

const FIXTURES: Record<Section, string> = {
  docker: 'docker-ps-stacks.txt',
  systemd: 'systemctl-show.txt',
  loadavg: 'loadavg.txt',
  uptime: 'uptime.txt',
  stat: 'proc-stat.txt',
  meminfo: 'meminfo.txt',
  net: 'net-dev.txt',
  thermal: 'thermal.txt',
  df: 'df.txt'
}

const ORDER: Section[] = [
  'docker',
  'systemd',
  'loadavg',
  'uptime',
  'stat',
  'meminfo',
  'net',
  'thermal',
  'df'
]

/** Rebuilds the output of SNAPSHOT_COMMAND from the recorded fixtures (real bento output). */
export function snapshotOutput(overrides: Partial<Record<Section, string>> = {}): string {
  return ORDER.map((name) => {
    const body = overrides[name] ?? readFileSync(resolve('tests/fixtures', FIXTURES[name]), 'utf-8')
    return `@@${name}\n${body.endsWith('\n') || body === '' ? body : `${body}\n`}`
  }).join('')
}
