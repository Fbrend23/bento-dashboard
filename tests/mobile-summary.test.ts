import { describe, expect, it } from 'vitest'
import type { ServiceLevel, ServiceStatus } from '../src/shared/monitors'
import type { AgentStatus } from '../src/shared/agent'
import { summarize } from '../src/mobile/src/summary'
import { metrics } from './helpers/status'

const service = (id: string, level: ServiceLevel, detail = 'Up 2 days'): ServiceStatus => ({
  id,
  label: id,
  kind: 'container',
  level,
  detail,
  state: level === 'ok' ? 'running' : 'exited',
  project: 'media',
  ports: []
})

const status = (...services: ServiceStatus[]): AgentStatus => ({
  updatedAt: 1,
  services,
  stackLabels: {},
  metrics: metrics()
})

describe('summarize', () => {
  it('is idle and waiting before the first answer', () => {
    expect(summarize(null, null)).toMatchObject({ tone: 'idle', title: 'Lecture en cours…' })
  })

  it('is idle and explains when nothing could ever be read', () => {
    expect(summarize(null, 'Bento est injoignable.')).toMatchObject({
      tone: 'idle',
      title: 'Bento est injoignable.'
    })
  })

  it('is fine when everything is up, and neutral stopped containers do not count', () => {
    expect(summarize(status(service('a', 'ok'), service('b', 'stopped')), null)).toMatchObject({
      tone: 'ok',
      title: 'Bento va bien.'
    })
  })

  it('names the service that is down', () => {
    const verdict = summarize(
      status(service('a', 'ok'), service('web', 'down', 'Exited (1) 3 minutes ago')),
      null
    )
    expect(verdict.tone).toBe('danger')
    expect(verdict.title).toBe("Un service est à l'arrêt.")
    expect(verdict.details).toEqual(['web : Arrêté (code 1) il y a 3 minutes'])
  })

  it('counts several services down', () => {
    const verdict = summarize(status(service('a', 'down'), service('b', 'absent')), null)
    expect(verdict.title).toBe("Plusieurs services sont à l'arrêt.")
  })

  it('warns on degraded or unknown levels', () => {
    expect(summarize(status(service('a', 'degraded')), null).tone).toBe('warn')
    expect(summarize(status(service('a', 'unknown')), null).tone).toBe('warn')
  })

  it('keeps the last values and says they may be old when a refresh failed', () => {
    const verdict = summarize(status(service('a', 'ok')), 'Bento est injoignable.')
    expect(verdict.tone).toBe('idle')
    expect(verdict.title).toBe('Bento est injoignable.')
    expect(verdict.details).toContain('Les dernières valeurs connues restent affichées.')
  })
})
