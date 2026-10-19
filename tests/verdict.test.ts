import { describe, expect, it } from 'vitest'
import type { BentoStatus, Metrics, ServiceStatus } from '@shared/monitors'
import { buildVerdict } from '@shared/verdict'

const NBSP = ' '

const service = (overrides: Partial<ServiceStatus>): ServiceStatus => ({
  id: 'jellyfin',
  label: 'jellyfin',
  kind: 'container',
  level: 'ok',
  detail: 'Up 4 days',
  state: 'running',
  project: null,
  ports: [],
  ...overrides
})

const metrics = (disks: Metrics['disks'] = []): Metrics => ({
  cpuPercent: 5,
  memoryUsedPercent: 20,
  memoryTotalKb: 16251684,
  swapUsedPercent: null,
  swapTotalKb: null,
  network: null,
  temperatureC: null,
  load: { load1: 0.1, load5: 0.1, load15: 0.1 },
  uptimeSeconds: 1000,
  diskThresholdPercent: 85,
  disks
})

const status = (overrides: Partial<BentoStatus> = {}): BentoStatus => ({
  connection: 'online',
  configured: true,
  lastError: null,
  updatedAt: 1,
  overall: 'ok',
  services: [service({}), service({ id: 'tailscaled', label: 'Tailscale', kind: 'systemd' })],
  metrics: metrics(),
  ...overrides
})

describe('buildVerdict when everything is fine', () => {
  it('says so in one plain sentence', () => {
    expect(buildVerdict(status())).toEqual({
      tone: 'ok',
      title: 'Bento va bien.',
      details: ['Tous les services répondent.'],
      technical: null,
      action: null
    })
  })
})

describe('buildVerdict when attention is needed', () => {
  it('names the degraded service with its translated status', () => {
    const verdict = buildVerdict(
      status({
        overall: 'degraded',
        services: [
          service({
            id: 'homepage',
            label: 'homepage',
            level: 'degraded',
            detail: 'Up 4 days (unhealthy)'
          })
        ]
      })
    )
    expect(verdict).toMatchObject({
      tone: 'warn',
      title: 'Bento demande votre attention.',
      details: ['homepage : Actif depuis 4 jours, non sain']
    })
  })

  it('reports services whose state could not be read', () => {
    const verdict = buildVerdict(
      status({
        overall: 'degraded',
        services: [service({ level: 'unknown', detail: 'Lecture Docker impossible' })]
      })
    )
    expect(verdict.details).toEqual(['jellyfin : Lecture Docker impossible'])
    expect(verdict.tone).toBe('warn')
  })

  it('reports a disk over its threshold', () => {
    const disk = {
      filesystem: 'nas:/video',
      mount: '/mnt/nas',
      totalBytes: 100,
      usedBytes: 87,
      availableBytes: 13,
      usedPercent: 86.9,
      overThreshold: true
    }
    const verdict = buildVerdict(status({ overall: 'degraded', metrics: metrics([disk]) }))
    expect(verdict.title).toBe('Bento demande votre attention.')
    expect(verdict.details).toEqual([`Le disque /mnt/nas est rempli à 87${NBSP}%.`])
  })
})

describe('buildVerdict when a service is down', () => {
  const down = service({
    id: 'stream',
    label: 'stream',
    level: 'down',
    detail: 'Exited (0) 2 months ago'
  })

  it('uses the singular for one service', () => {
    const verdict = buildVerdict(status({ overall: 'down', services: [down] }))
    expect(verdict).toMatchObject({
      tone: 'danger',
      title: "Un service est à l'arrêt.",
      details: ['stream : Arrêté (code 0) il y a 2 mois']
    })
  })

  it('counts absent containers as down and uses the plural', () => {
    const absent = service({
      id: 'nginx',
      label: 'nginx',
      level: 'absent',
      detail: 'Conteneur introuvable'
    })
    const verdict = buildVerdict(status({ overall: 'down', services: [down, absent] }))
    expect(verdict.title).toBe("Plusieurs services sont à l'arrêt.")
    expect(verdict.details).toEqual([
      'stream : Arrêté (code 0) il y a 2 mois',
      'nginx : Conteneur introuvable'
    ])
  })

  it('lists the worst problems first', () => {
    const degraded = service({
      id: 'homepage',
      label: 'homepage',
      level: 'degraded',
      detail: 'Up 4 days (unhealthy)'
    })
    const verdict = buildVerdict(status({ overall: 'down', services: [degraded, down] }))
    expect(verdict.details[0]).toMatch(/^stream/)
    expect(verdict.details[1]).toMatch(/^homepage/)
  })
})

describe('buildVerdict when bento cannot be reached', () => {
  it('announces the retry and keeps the technical reason apart', () => {
    const verdict = buildVerdict(
      status({
        connection: 'offline',
        overall: 'offline',
        services: [],
        metrics: null,
        lastError: 'timeout'
      })
    )
    expect(verdict).toEqual({
      tone: 'idle',
      title: 'Bento est injoignable.',
      details: ['Nouvelle tentative automatique.'],
      technical: 'timeout',
      action: null
    })
  })

  it('explains a known cause in plain French, between the retry notice and the raw text', () => {
    const verdict = buildVerdict(
      status({
        connection: 'offline',
        overall: 'offline',
        services: [],
        metrics: null,
        lastError: 'All configured authentication methods failed'
      })
    )
    expect(verdict.details).toEqual([
      'Nouvelle tentative automatique.',
      expect.stringContaining('ssh-add -l')
    ])
    expect(verdict.technical).toBe('All configured authentication methods failed')
  })

  it('does not explain while connecting, nor an error nobody recognises', () => {
    const connecting = buildVerdict(
      status({
        connection: 'connecting',
        overall: 'offline',
        services: [],
        metrics: null,
        lastError: 'connect EHOSTUNREACH 192.0.2.7:22'
      })
    )
    expect(connecting.details).toEqual(['Connexion en cours…'])
    const unknown = buildVerdict(
      status({
        connection: 'offline',
        overall: 'offline',
        services: [],
        metrics: null,
        lastError: 'weird'
      })
    )
    expect(unknown.details).toEqual(['Nouvelle tentative automatique.'])
  })

  it('says the last known values stay on screen when there are some', () => {
    const verdict = buildVerdict(status({ connection: 'offline', overall: 'offline' }))
    expect(verdict.details).toEqual([
      'Nouvelle tentative automatique.',
      'Les dernières valeurs connues restent affichées.'
    ])
  })

  it('shows progress while connecting', () => {
    const verdict = buildVerdict(
      status({ connection: 'connecting', overall: 'offline', services: [], metrics: null })
    )
    expect(verdict.details).toEqual(['Connexion en cours…'])
  })
})

describe('buildVerdict before there is anything to show', () => {
  it('invites the user to configure bento', () => {
    const verdict = buildVerdict(
      status({
        configured: false,
        connection: 'offline',
        overall: 'unconfigured',
        services: [],
        metrics: null
      })
    )
    expect(verdict).toEqual({
      tone: 'idle',
      title: "Bento n'est pas encore configuré.",
      details: ["Renseignez l'hôte et l'empreinte du serveur pour démarrer la surveillance."],
      technical: null,
      action: 'configure'
    })
  })

  it('waits for the first reading', () => {
    const verdict = buildVerdict(status({ overall: 'pending', services: [], metrics: null }))
    expect(verdict).toMatchObject({
      tone: 'idle',
      title: 'Première lecture en cours…',
      details: []
    })
  })
})
