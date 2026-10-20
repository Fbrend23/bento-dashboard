import { describe, expect, it } from 'vitest'
import {
  TAILSCALED_SOURCE,
  containerSource,
  groupLogSources,
  logSourceFileName,
  logSources,
  parseLogSource
} from '@shared/logs'
import type { ServiceStatus } from '@shared/monitors'

describe('parseLogSource', () => {
  it('reads tailscaled and container sources', () => {
    expect(parseLogSource('tailscaled')).toEqual({ kind: 'tailscaled' })
    expect(parseLogSource('container:app-1')).toEqual({ kind: 'container', name: 'app-1' })
    expect(parseLogSource(containerSource('a.b_c-d'))).toEqual({
      kind: 'container',
      name: 'a.b_c-d'
    })
  })

  it('keeps a container named tailscaled apart from the journal', () => {
    expect(parseLogSource(containerSource('tailscaled'))).toEqual({
      kind: 'container',
      name: 'tailscaled'
    })
  })

  it.each([
    undefined,
    null,
    42,
    {},
    [],
    '',
    'jellyfin',
    'sshd',
    'container:',
    'container:-rf',
    'container:--help',
    'container:a b',
    'container:a;id',
    'container:$(id)',
    'container:a/b',
    'container:a\nb',
    `container:${'a'.repeat(129)}`,
    'container:container:x',
    'Container:app-1',
    ' container:app-1',
    'tailscaled ',
    '__proto__',
    'constructor'
  ])('refuses %j', (value) => {
    expect(parseLogSource(value)).toBeNull()
  })
})

describe('logSourceFileName', () => {
  it('never contains a character Windows refuses in a file name', () => {
    expect(logSourceFileName(TAILSCALED_SOURCE)).toBe('tailscaled.log')
    expect(logSourceFileName(containerSource('app-1'))).toBe('app-1.log')
    expect(logSourceFileName(containerSource('a.b_c-d'))).not.toMatch(/[<>:"/\\|?*]/)
  })
})

describe('logSources', () => {
  const settings = {
    logContainers: ['app-1', 'jellyfin'],
    containerLabels: { jellyfin: 'Jellyfin' }
  }

  it('lists the configured containers with their label, then Tailscale', () => {
    expect(logSources(settings)).toEqual([
      { id: 'container:app-1', label: 'app-1' },
      { id: 'container:jellyfin', label: 'Jellyfin' },
      { id: 'tailscaled', label: 'Tailscale' }
    ])
  })

  it('offers Tailscale alone when no container is configured', () => {
    expect(logSources({ logContainers: [], containerLabels: {} })).toEqual([
      { id: 'tailscaled', label: 'Tailscale' }
    ])
  })
})

describe('groupLogSources', () => {
  const service = (
    id: string,
    project: string | null,
    level: ServiceStatus['level'] = 'ok'
  ): ServiceStatus => ({
    id,
    label: id,
    kind: id === 'tailscaled' ? 'systemd' : 'container',
    level,
    detail: '',
    state: null,
    project,
    ports: []
  })
  const sources = (names: string[]) => logSources({ logContainers: names, containerLabels: {} })

  it('groups containers by stack, sorted by label, with Tailscale alone at the end', () => {
    const groups = groupLogSources(
      sources(['web-1', 'jellyfin', 'app-1']),
      [
        service('web-1', 'web'),
        service('jellyfin', 'media', 'degraded'),
        service('app-1', 'media'),
        service('tailscaled', null, 'down')
      ],
      { stackLabels: { web: 'Site' } }
    )
    expect(groups.map((g) => g.label)).toEqual(['Media', 'Site', null])
    expect(groups[0].sources.map((s) => [s.id, s.level])).toEqual([
      ['container:jellyfin', 'degraded'],
      ['container:app-1', 'ok']
    ])
    expect(groups[2].sources).toEqual([{ id: 'tailscaled', label: 'Tailscale', level: 'down' }])
  })

  it('puts containers outside any stack in an untitled group before Tailscale', () => {
    const groups = groupLogSources(
      sources(['solo', 'app-1']),
      [service('solo', null), service('app-1', 'media')],
      { stackLabels: {} }
    )
    expect(groups.map((g) => g.label)).toEqual(['Media', null, null])
    expect(groups[1].sources.map((s) => s.id)).toEqual(['container:solo'])
    expect(groups[2].sources.map((s) => s.id)).toEqual(['tailscaled'])
  })

  it('keeps every source with no level when the last poll is empty', () => {
    const groups = groupLogSources(sources(['app-1']), [], { stackLabels: {} })
    expect(groups.map((g) => g.label)).toEqual([null, null])
    expect(groups.flatMap((g) => g.sources).map((s) => s.level)).toEqual([null, null])
  })

  it('gives each group a distinct key', () => {
    const groups = groupLogSources(
      sources(['a', 'b']),
      [service('a', 'media'), service('b', 'web')],
      { stackLabels: {} }
    )
    expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length)
  })
})
