import { describe, expect, it, vi } from 'vitest'
import type { AgentStatus } from '@shared/agent'
import { createHistoryFeed, toBentoStatus } from '../src/agent/history'
import { metrics, service } from './helpers/status'

const agentStatus = (over: Partial<AgentStatus> = {}): AgentStatus => ({
  updatedAt: 1_700_000_000_000,
  services: [service({ id: 'jellyfin', label: 'Jellyfin', level: 'ok' })],
  stackLabels: {},
  metrics: metrics(),
  ...over
})

describe('toBentoStatus', () => {
  it('presents a read of the agent as an online, configured server', () => {
    const status = toBentoStatus(agentStatus())
    expect(status).toMatchObject({
      connection: 'online',
      configured: true,
      lastError: null,
      updatedAt: 1_700_000_000_000
    })
  })

  it('keeps the services and the metrics as they are', () => {
    const source = agentStatus()
    const status = toBentoStatus(source)
    expect(status.services).toEqual(source.services)
    expect(status.metrics).toEqual(source.metrics)
  })

  it('is down when a service is down, degraded when one is degraded, else ok', () => {
    const level = (l: 'ok' | 'degraded' | 'down'): string =>
      toBentoStatus(agentStatus({ services: [service({ level: l })] })).overall
    expect(level('ok')).toBe('ok')
    expect(level('degraded')).toBe('degraded')
    expect(level('down')).toBe('down')
  })
})

describe('createHistoryFeed', () => {
  const make = (): {
    feed: (status: AgentStatus) => void
    calls: string[]
    observe: ReturnType<typeof vi.fn>
  } => {
    const calls: string[] = []
    const observe = vi.fn(() => calls.push('observe'))
    const feed = createHistoryFeed({ noteGap: () => calls.push('noteGap'), observe })
    return { feed, calls, observe }
  }

  it('notes the gap since the last run once, before the first reading', () => {
    const { feed, calls } = make()
    feed(agentStatus())
    feed(agentStatus({ updatedAt: 1_700_000_030_000 }))
    feed(agentStatus({ updatedAt: 1_700_000_060_000 }))
    expect(calls).toEqual(['noteGap', 'observe', 'observe', 'observe'])
  })

  it('gives the history each reading as a status of an online server', () => {
    const { feed, observe } = make()
    feed(agentStatus())
    expect(observe).toHaveBeenCalledWith(
      expect.objectContaining({ connection: 'online', updatedAt: 1_700_000_000_000 })
    )
  })
})
