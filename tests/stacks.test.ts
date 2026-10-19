import { describe, expect, it } from 'vitest'
import type { ServiceStatus } from '@shared/monitors'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { LabelSettings } from '@shared/labels'
import * as shared from '@shared/stacks'
import { primaryLink, sortMembers, stackSummary } from '@shared/stacks'
import { parseDockerPs } from '../src/main/monitors/containers'
import { buildSnapshot } from '../src/main/monitors/snapshot'
import { recordedDockerPs } from './helpers/docker-ps'
import { snapshotOutput } from './helpers/snapshot-output'
import { service } from './helpers/status'

const running = new Set(
  parseDockerPs(recordedDockerPs())
    .filter((c) => c.state === 'running')
    .map((c) => c.name)
)
// What a user would have typed in the settings for this recorded server.
const labels: LabelSettings = {
  containerLabels: { 'docker-ui': 'Docker UI' },
  stackLabels: { media: 'Jellyfin', proxy: 'Nginx' },
  portLabels: {
    8096: 'Jellyfin',
    8989: 'Series',
    7878: 'Movies',
    7575: 'Homepage',
    8443: 'Game',
    9443: 'Docker UI',
    81: 'Nginx Proxy Manager'
  }
}
const groupStacks = (list: ServiceStatus[]): shared.Stack[] => shared.groupStacks(list, labels)
const memberLinks = (member: ServiceStatus): shared.StackLink[] =>
  shared.memberLinks(member, labels)

const { services } = buildSnapshot(
  snapshotOutput(),
  { ...DEFAULT_SETTINGS, ...labels },
  null,
  running
)
const stacks = groupStacks(services)
const stack = (id: string): ReturnType<typeof groupStacks>[number] | undefined =>
  stacks.find((s) => s.id === id)

describe('groupStacks (recorded output)', () => {
  it('groups containers by compose project', () => {
    const media = stack('stack:media')
    expect(media?.members).toHaveLength(13)
    expect(media?.members.map((m) => m.id)).toEqual(
      expect.arrayContaining(['jellyfin', 'series', 'movies', 'downloader', 'vpn'])
    )
    expect(stack('stack:server')?.members).toHaveLength(10)
    expect(stack('stack:game')?.members.map((m) => m.id)).toEqual(['game_container'])
    expect(stack('stack:proxy')?.members.map((m) => m.id)).toEqual(['proxy-app-1'])
  })

  it('gives a container outside compose and tailscale a stack of their own', () => {
    expect(stack('service:docker-ui')?.members.map((m) => m.id)).toEqual(['docker-ui'])
    expect(stack('service:tailscaled')?.members.map((m) => m.id)).toEqual(['tailscaled'])
  })

  it('does not lose or duplicate any service', () => {
    const ids = stacks.flatMap((s) => s.members.map((m) => m.id))
    expect(ids.sort()).toEqual(services.map((s) => s.id).sort())
  })

  it('names the stacks with friendly labels', () => {
    expect(stack('stack:media')?.label).toBe('Jellyfin')
    expect(stack('stack:proxy')?.label).toBe('Nginx')
    expect(stack('stack:server')?.label).toBe('Server')
    expect(stack('service:docker-ui')?.label).toBe('Docker UI')
    expect(stack('service:tailscaled')?.label).toBe('Tailscale')
  })

  it('takes the worst level of the members, ignoring stopped ones', () => {
    expect(stack('stack:media')?.level).toBe('degraded') // homepage is unhealthy
    expect(stack('stack:game')?.level).toBe('ok')
    expect(stack('stack:server')?.level).toBe('stopped')
  })

  it('counts the active members', () => {
    expect(stack('stack:media')?.activeCount).toBe(13)
    expect(stack('stack:server')?.activeCount).toBe(0)
  })

  it('lists the web ports a stack exposes, with the names of the services behind them', () => {
    const links = stack('stack:media')?.links ?? []
    expect(links).toContainEqual({ container: 'jellyfin', hostPort: 8096, label: 'Jellyfin' })
    expect(links).toContainEqual({ container: 'vpn', hostPort: 8989, label: 'Series' })
    expect(links).toContainEqual({ container: 'vpn', hostPort: 7878, label: 'Movies' })
    expect(links).toContainEqual({ container: 'homepage', hostPort: 7575, label: 'Homepage' })
  })

  it('keeps unnamed tcp ports as links without a label, and drops udp and exposed-only ports', () => {
    const links = stack('stack:media')?.links ?? []
    expect(links).toContainEqual({ container: 'vpn', hostPort: 6881, label: null })
    expect(links.filter((l) => l.hostPort === 6881)).toHaveLength(1)
    expect(links.some((l) => l.hostPort === 8920)).toBe(false)
    expect(stack('stack:game')?.links.map((l) => l.hostPort)).toEqual([8123, 8443, 25565, 25566])
  })

  it('puts problems first and stopped stacks last', () => {
    const levels = stacks.map((s) => s.level)
    const rank = { down: 0, absent: 0, degraded: 1, unknown: 1, ok: 2, stopped: 3 } as const
    expect(levels.map((l) => rank[l])).toEqual([...levels.map((l) => rank[l])].sort())
    expect(stacks.at(-1)?.id).toBe('stack:server')
  })
})

describe('groupStacks (synthetic)', () => {
  const member = (
    id: string,
    level: ServiceStatus['level'],
    project: string | null = 'app'
  ): ServiceStatus => service({ id, label: id, level, project })

  it('is down as soon as one member is down or absent', () => {
    expect(groupStacks([member('a', 'ok'), member('b', 'down')])[0].level).toBe('down')
    expect(groupStacks([member('a', 'ok'), member('b', 'absent')])[0].level).toBe('down')
  })

  it('is ok when running members are mixed with stopped ones', () => {
    const [only] = groupStacks([member('a', 'ok'), member('b', 'stopped')])
    expect(only.level).toBe('ok')
    expect(only.activeCount).toBe(1)
  })

  it('is degraded for an unhealthy member, and unknown when a member cannot be read', () => {
    expect(groupStacks([member('a', 'ok'), member('b', 'degraded')])[0].level).toBe('degraded')
    expect(groupStacks([member('a', 'ok'), member('b', 'unknown')])[0].level).toBe('unknown')
    expect(groupStacks([member('a', 'unknown'), member('b', 'degraded')])[0].level).toBe('degraded')
  })

  it('returns nothing for no services', () => {
    expect(groupStacks([])).toEqual([])
  })

  it('does not group an unreadable docker row with anything', () => {
    const docker = service({ id: 'docker', label: 'Docker', level: 'unknown', project: null })
    expect(groupStacks([docker])).toHaveLength(1)
  })

  it('capitalises the name of an unknown project', () => {
    expect(groupStacks([member('a', 'ok', 'my-stack')])[0].label).toBe('My-stack')
  })
})

describe('stackSummary', () => {
  const make = (members: ServiceStatus[]): ReturnType<typeof groupStacks>[number] =>
    groupStacks(members)[0]
  const m = (id: string, level: ServiceStatus['level']): ServiceStatus =>
    service({ id, label: id, level, project: 'app' })

  it('counts active containers out of all of them', () => {
    expect(stackSummary(make([m('a', 'ok'), m('b', 'ok'), m('c', 'stopped')]))).toBe(
      '2 sur 3 actifs'
    )
  })

  it('says so when nothing runs', () => {
    expect(stackSummary(make([m('a', 'stopped'), m('b', 'stopped')]))).toBe('Aucun actif sur 2')
  })

  it('stays short for a single service', () => {
    expect(stackSummary(make([m('a', 'ok')]))).toBe('Actif')
    expect(stackSummary(make([m('a', 'down')]))).toBe('Arrêté')
  })

  it('counts a degraded container as active', () => {
    expect(stackSummary(make([m('a', 'ok'), m('b', 'degraded')]))).toBe('2 sur 2 actifs')
  })
})

describe('primaryLink', () => {
  it('picks the interface named like the stack', () => {
    expect(primaryLink(stack('stack:media')!)).toEqual({
      container: 'jellyfin',
      hostPort: 8096,
      label: 'Jellyfin'
    })
    expect(primaryLink(stack('service:docker-ui')!)).toMatchObject({ hostPort: 9443 })
    expect(primaryLink(stack('stack:game')!)).toMatchObject({ hostPort: 8443 })
  })

  it('prefers a named interface for a lone container, else its first port', () => {
    expect(primaryLink(stack('stack:proxy')!)).toMatchObject({ hostPort: 81 })
    const lone = groupStacks([
      service({
        id: 'x',
        label: 'X',
        project: null,
        ports: [
          { hostPort: 3000, containerPort: 3000, proto: 'tcp', bind: '0.0.0.0', linkable: true }
        ]
      })
    ])[0]
    expect(primaryLink(lone)).toEqual({ container: 'x', hostPort: 3000, label: null })
  })

  it('is null when nothing can be opened', () => {
    expect(primaryLink(stack('service:tailscaled')!)).toBeNull()
    expect(primaryLink(stack('stack:server')!)).toBeNull()
  })

  it('does not guess among unnamed ports of a stack', () => {
    const unnamed = groupStacks([
      service({
        id: 'a',
        label: 'a',
        project: 'p',
        ports: [
          { hostPort: 3000, containerPort: 3000, proto: 'tcp', bind: '0.0.0.0', linkable: true }
        ]
      }),
      service({
        id: 'b',
        label: 'b',
        project: 'p',
        ports: [
          { hostPort: 3001, containerPort: 3001, proto: 'tcp', bind: '0.0.0.0', linkable: true }
        ]
      })
    ])[0]
    expect(primaryLink(unnamed)).toBeNull()
  })
})

describe('memberLinks', () => {
  it('lists the tcp ports a container publishes, named when known', () => {
    const vpn = services.find((s) => s.id === 'vpn')!
    const links = memberLinks(vpn)
    expect(links.map((l) => l.hostPort)).toEqual([6881, 7878, 8080, 8191, 8989, 9696])
    expect(links.find((l) => l.hostPort === 8989)).toEqual({
      container: 'vpn',
      hostPort: 8989,
      label: 'Series'
    })
  })

  it('is empty for a container that publishes nothing', () => {
    expect(memberLinks(services.find((s) => s.id === 'series')!)).toEqual([])
  })
})

describe('sortMembers', () => {
  const m = (id: string, level: ServiceStatus['level']): ServiceStatus =>
    service({ id, label: id, level, project: 'p' })

  it('puts problems first, then running containers, then stopped ones, by name inside a group', () => {
    const sorted = sortMembers([
      m('b', 'ok'),
      m('z', 'stopped'),
      m('a', 'ok'),
      m('d', 'degraded'),
      m('c', 'down'),
      m('y', 'stopped')
    ])
    expect(sorted.map((x) => x.id)).toEqual(['c', 'd', 'a', 'b', 'y', 'z'])
  })

  it('does not change the list it is given', () => {
    const list = [m('b', 'ok'), m('a', 'down')]
    sortMembers(list)
    expect(list.map((x) => x.id)).toEqual(['b', 'a'])
  })
})
