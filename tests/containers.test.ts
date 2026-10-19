import { describe, expect, it } from 'vitest'
import type { ContainerInfo } from '@shared/monitors'
import { recordedDockerPs } from './helpers/docker-ps'
import {
  containerLevel,
  DOCKER_PS_COMMAND,
  parseDockerPs,
  parsePorts
} from '../src/main/monitors/containers'

const containers = parseDockerPs(recordedDockerPs())
const byName = (name: string): ContainerInfo | undefined => containers.find((c) => c.name === name)

describe('DOCKER_PS_COMMAND', () => {
  it('is a fixed read-only command with the expected format', () => {
    expect(DOCKER_PS_COMMAND).toBe(
      'sudo -n docker ps -a --format \'{{.Names}}|{{.State}}|{{.Ports}}|{{.Label "com.docker.compose.project"}}|{{.Status}}\''
    )
  })
})

describe('parsePorts', () => {
  it('reads a port published on every interface and merges the IPv6 duplicate', () => {
    expect(parsePorts('0.0.0.0:8096->8096/tcp, :::8096->8096/tcp')).toEqual([
      { hostPort: 8096, containerPort: 8096, proto: 'tcp', bind: '0.0.0.0', linkable: true }
    ])
  })

  it('keeps a different host and container port', () => {
    expect(parsePorts('0.0.0.0:8989->8080/tcp')).toEqual([
      { hostPort: 8989, containerPort: 8080, proto: 'tcp', bind: '0.0.0.0', linkable: true }
    ])
  })

  it('flags loopback-only ports as not linkable', () => {
    expect(parsePorts('127.0.0.1:5432->5432/tcp')[0]).toMatchObject({ linkable: false })
    expect(parsePorts('[::1]:5432->5432/tcp')[0]).toMatchObject({ linkable: false })
  })

  it('flags udp ports as not linkable', () => {
    expect(parsePorts('0.0.0.0:6881->6881/udp')[0]).toMatchObject({
      proto: 'udp',
      linkable: false
    })
  })

  it('ignores exposed but unpublished ports', () => {
    expect(parsePorts('8096/tcp, 8920/tcp')).toEqual([])
  })

  it('expands a published range', () => {
    expect(parsePorts('0.0.0.0:7000-7002->7000-7002/tcp').map((p) => p.hostPort)).toEqual([
      7000, 7001, 7002
    ])
  })

  it('returns nothing for empty or garbage input', () => {
    expect(parsePorts('')).toEqual([])
    expect(parsePorts('???')).toEqual([])
  })

  it('keeps several published ports in order', () => {
    expect(
      parsePorts('0.0.0.0:8080->8080/tcp, :::8080->8080/tcp, 0.0.0.0:6881->6881/tcp').map(
        (p) => p.hostPort
      )
    ).toEqual([8080, 6881])
  })
})

describe('parseDockerPs (ports and compose project)', () => {
  it('reads the ports and the compose project', () => {
    const [series, lone] = parseDockerPs(
      'series|running|0.0.0.0:8989->8989/tcp, :::8989->8989/tcp|media|Up 2 days (healthy)\n' +
        'docker-ui|running|9443/tcp||Up 4 days\n'
    )
    expect(series).toMatchObject({
      name: 'series',
      project: 'media',
      status: 'Up 2 days (healthy)'
    })
    expect(series.ports).toHaveLength(1)
    expect(lone).toMatchObject({ name: 'docker-ui', project: null, ports: [] })
  })
})

describe('parseDockerPs (recorded output from bento)', () => {
  it('parses every line of the recorded output', () => {
    expect(containers).toHaveLength(26)
  })

  it('parses a running container without healthcheck', () => {
    expect(byName('jellyfin')).toEqual({
      name: 'jellyfin',
      state: 'running',
      status: 'Up 19 minutes',
      health: null,
      exitCode: null,
      project: 'media',
      ports: [
        { hostPort: 8096, containerPort: 8096, proto: 'tcp', bind: '0.0.0.0', linkable: true }
      ]
    })
  })

  it('reads the compose project, and null outside compose', () => {
    expect(byName('series')?.project).toBe('media')
    expect(byName('proxy-app-1')?.project).toBe('proxy')
    expect(byName('docker-ui')?.project).toBeNull()
  })

  it('shares one project between jellyfin and the *arr stack', () => {
    const media = containers.filter((c) => c.project === 'media').map((c) => c.name)
    expect(media).toEqual(expect.arrayContaining(['jellyfin', 'series', 'movies', 'vpn']))
  })

  it('puts the ports of containers behind vpn on vpn itself', () => {
    expect(byName('series')?.ports).toEqual([])
    const web = byName('vpn')
      ?.ports.filter((p) => p.linkable)
      .map((p) => p.hostPort)
    expect(web).toEqual(expect.arrayContaining([7878, 8080, 8191, 8989, 9696]))
  })

  it('reads published ranges and ignores exposed-only and udp ports', () => {
    const game = byName('game_container')?.ports ?? []
    const linkable = game.filter((p) => p.linkable).map((p) => p.hostPort)
    expect(linkable).toEqual([8123, 8443, 25565, 25566])
    expect(game.find((p) => p.proto === 'udp')).toMatchObject({
      hostPort: 24454,
      linkable: false
    })
  })

  it('reads ranges on the web ports of proxy-app-1', () => {
    expect(byName('proxy-app-1')?.ports.map((p) => p.hostPort)).toEqual([80, 81, 443])
  })

  it('parses health status', () => {
    expect(byName('movies')?.health).toBe('healthy')
    expect(byName('homepage')?.health).toBe('unhealthy')
  })

  it('parses exit codes of exited containers', () => {
    expect(byName('stream')).toMatchObject({ state: 'exited', exitCode: 0 })
    expect(byName('speaker')).toMatchObject({ state: 'exited', exitCode: 137 })
    expect(byName('matcher')).toMatchObject({ state: 'exited', exitCode: 143 })
  })

  it('keeps names that start with a hash', () => {
    expect(byName('56d385c967ac_camera')?.state).toBe('exited')
  })
})

describe('parseDockerPs (edge cases, synthetic input)', () => {
  it('returns an empty list for empty output', () => {
    expect(parseDockerPs('')).toEqual([])
    expect(parseDockerPs('\n')).toEqual([])
  })

  it('handles CRLF line endings', () => {
    const result = parseDockerPs('a|running|||Up 1 hour\r\nb|exited|||Exited (1) 3 days ago\r\n')
    expect(result.map((c) => c.name)).toEqual(['a', 'b'])
    expect(result[1].exitCode).toBe(1)
  })

  it('skips malformed lines', () => {
    const result = parseDockerPs(
      'Cannot connect to the Docker daemon\nok|running|||Up 1 hour\nonly|two\nold|running|Up 1 hour\n'
    )
    expect(result.map((c) => c.name)).toEqual(['ok'])
  })

  it('parses restarting, paused and starting states', () => {
    const result = parseDockerPs(
      'r|restarting|||Restarting (1) 5 seconds ago\np|paused|||Up 2 hours (Paused)\ns|running|||Up 3 seconds (health: starting)\n'
    )
    expect(result[0]).toMatchObject({ state: 'restarting', exitCode: null })
    expect(result[1].state).toBe('paused')
    expect(result[2].health).toBe('starting')
  })

  it('maps an unrecognised state to unknown', () => {
    expect(parseDockerPs('x|weird|||???\n')[0].state).toBe('unknown')
  })
})

describe('containerLevel', () => {
  it('is ok for running containers without healthcheck or healthy', () => {
    expect(containerLevel(byName('jellyfin'))).toBe('ok')
    expect(containerLevel(byName('movies'))).toBe('ok')
  })

  it('is degraded when unhealthy or still starting', () => {
    expect(containerLevel(byName('homepage'))).toBe('degraded')
    expect(containerLevel(parseDockerPs('s|running|||Up 3 seconds (health: starting)')[0])).toBe(
      'degraded'
    )
  })

  it('is down for exited, restarting, paused and dead containers', () => {
    expect(containerLevel(byName('stream'))).toBe('down')
    expect(containerLevel(parseDockerPs('r|restarting|||Restarting (1) 5 seconds ago')[0])).toBe(
      'down'
    )
    expect(containerLevel(parseDockerPs('p|paused|||Up 2 hours (Paused)')[0])).toBe('down')
  })

  it('is absent when the container does not exist', () => {
    expect(containerLevel(undefined)).toBe('absent')
  })
})
