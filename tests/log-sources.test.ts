import { describe, expect, it } from 'vitest'
import {
  TAILSCALED_SOURCE,
  containerSource,
  logSourceFileName,
  logSources,
  parseLogSource
} from '@shared/logs'

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
