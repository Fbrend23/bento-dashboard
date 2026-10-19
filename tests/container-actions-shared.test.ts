import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  actionBusyLabel,
  actionLabel,
  availableActions,
  CONTAINER_ACTIONS,
  CONTAINER_NAME,
  isContainerAction,
  isContainerName,
  needsConfirmation
} from '@shared/actions'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { ServiceStatus } from '@shared/monitors'
import { buildSnapshot } from '../src/main/monitors/snapshot'
import { recordedDockerPs } from './helpers/docker-ps'
import { snapshotOutput } from './helpers/snapshot-output'
import { service, tailscale } from './helpers/status'

describe('container actions', () => {
  it('are exactly start, stop and restart', () => {
    expect([...CONTAINER_ACTIONS]).toEqual(['start', 'stop', 'restart'])
  })

  it('are recognised only when exact', () => {
    for (const action of ['start', 'stop', 'restart']) expect(isContainerAction(action)).toBe(true)
    for (const bad of ['Start', 'RESTART', 'rm', 'kill', 'exec', '', ' start', 'start ', null, 7]) {
      expect(isContainerAction(bad)).toBe(false)
    }
  })

  it('are not fooled by inherited object keys', () => {
    expect(isContainerAction('constructor')).toBe(false)
    expect(isContainerAction('__proto__')).toBe(false)
    expect(isContainerAction('toString')).toBe(false)
  })

  it('ask for confirmation to interrupt a service, not to start one', () => {
    expect(needsConfirmation('stop')).toBe(true)
    expect(needsConfirmation('restart')).toBe(true)
    expect(needsConfirmation('start')).toBe(false)
  })
})

describe('action labels', () => {
  it('name each action on its button, in French', () => {
    expect(actionLabel('start')).toBe('Démarrer')
    expect(actionLabel('stop')).toBe('Arrêter')
    expect(actionLabel('restart')).toBe('Redémarrer')
  })

  it('say what is going on while it runs', () => {
    expect(actionBusyLabel('start')).toBe('Démarrage…')
    expect(actionBusyLabel('stop')).toBe('Arrêt…')
    expect(actionBusyLabel('restart')).toBe('Redémarrage…')
  })
})

describe('container names', () => {
  it.each(['jellyfin', 'proxy-app-1', 'game_container', '56d385c967ac_camera', 'a.b-c_d', 'A'])(
    'accepts %s',
    (name) => {
      expect(isContainerName(name)).toBe(true)
    }
  )

  it.each([
    '',
    '-rf',
    '--help',
    '.hidden',
    '_x',
    'a b',
    'a;b',
    'a|b',
    '$(id)',
    '`id`',
    'a/b',
    '../x',
    'jellyfin ',
    'a'.repeat(129),
    'jellyfin\nseries',
    'é',
    null,
    undefined,
    42,
    {}
  ])('refuses %j', (name) => {
    expect(isContainerName(name)).toBe(false)
  })

  it('accepts the longest allowed name', () => {
    expect(isContainerName('a'.repeat(128))).toBe(true)
  })

  it('uses exactly the pattern the script on bento enforces', () => {
    const script = readFileSync(resolve('scripts/bento-docker-action.sh'), 'utf-8')
    const pattern = script.match(/=~ (\^\[A-Za-z0-9\][^ ]*\$) \]\]/)?.[1]
    expect(pattern).toBeDefined()
    expect(CONTAINER_NAME.source).toBe(pattern)
  })
})

describe('availableActions (from the raw docker state)', () => {
  const container = (
    state: ServiceStatus['state'],
    level: ServiceStatus['level'] = 'ok'
  ): ServiceStatus => service({ state, level })

  it('offers restart and stop on a running container, whether healthy or not', () => {
    expect(availableActions(container('running', 'ok'))).toEqual(['restart', 'stop'])
    expect(availableActions(container('running', 'degraded'))).toEqual(['restart', 'stop'])
  })

  it('offers restart and stop on a container that keeps crashing and restarting', () => {
    // containerLevel calls this "down": the level alone would only have offered "start".
    expect(availableActions(container('restarting', 'down'))).toEqual(['restart', 'stop'])
  })

  it('offers start on a container that exited or was only created', () => {
    expect(availableActions(container('exited', 'down'))).toEqual(['start'])
    expect(availableActions(container('exited', 'stopped'))).toEqual(['start'])
    expect(availableActions(container('created', 'stopped'))).toEqual(['start'])
  })

  it('offers nothing on a paused container: docker refuses to start it', () => {
    expect(availableActions(container('paused', 'down'))).toEqual([])
  })

  it('offers nothing when the state is dead, unknown or missing', () => {
    expect(availableActions(container('dead', 'down'))).toEqual([])
    expect(availableActions(container('unknown', 'unknown'))).toEqual([])
    expect(availableActions(container(null, 'ok'))).toEqual([])
  })

  it('does not trust the level: a stale "ok" level cannot offer start on an exited container', () => {
    expect(availableActions(container('exited', 'ok'))).toEqual(['start'])
  })

  it('offers nothing for a systemd unit', () => {
    expect(availableActions(tailscale({ level: 'ok' }))).toEqual([])
    expect(availableActions(tailscale({ level: 'down' }))).toEqual([])
  })

  it('offers nothing for the placeholder shown when docker cannot be read', () => {
    expect(
      availableActions(
        service({ id: 'docker', label: 'Docker', level: 'unknown', state: null, project: null })
      )
    ).toEqual([])
  })
})

describe('availableActions (end to end, from docker ps output)', () => {
  const actionsFor = (ps: string, expected: string[], id: string): string[] => {
    const { services } = buildSnapshot(
      snapshotOutput({ docker: ps }),
      DEFAULT_SETTINGS,
      null,
      new Set(expected)
    )
    return availableActions(services.find((s) => s.id === id)!)
  }

  it('offers restart and stop on the recorded running containers', () => {
    const recorded = recordedDockerPs()
    expect(actionsFor(recorded, ['jellyfin'], 'jellyfin')).toEqual(['restart', 'stop'])
    expect(actionsFor(recorded, ['homepage'], 'homepage')).toEqual(['restart', 'stop'])
  })

  it('offers start on the recorded containers that exited', () => {
    expect(actionsFor(recordedDockerPs(), [], 'stream')).toEqual(['start'])
    expect(actionsFor(recordedDockerPs(), ['stream'], 'stream')).toEqual(['start'])
  })

  it('offers restart and stop on a crash-looping container, expected or not', () => {
    const ps = 'loop|restarting|||Restarting (1) 5 seconds ago\njellyfin|running|||Up 1 hour\n'
    expect(actionsFor(ps, ['loop'], 'loop')).toEqual(['restart', 'stop'])
    expect(actionsFor(ps, [], 'loop')).toEqual(['restart', 'stop'])
  })

  it('offers nothing on a paused container', () => {
    const ps = 'p|paused|||Up 2 hours (Paused)\njellyfin|running|||Up 1 hour\n'
    expect(actionsFor(ps, ['p'], 'p')).toEqual([])
  })
})
