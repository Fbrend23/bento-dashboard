import { describe, expect, it } from 'vitest'
import { staleness } from '@shared/staleness'
import { status } from './helpers/status'

const INTERVAL = 30 // seconds
const at = (secondsAfter: number): number => 1_000_000 + secondsAfter * 1000
const base = (patch: Partial<ReturnType<typeof status>> = {}): ReturnType<typeof status> =>
  status({ updatedAt: at(0), ...patch })

describe('staleness', () => {
  it('is null for fresh data', () => {
    expect(staleness(base(), INTERVAL, at(0))).toBeNull()
    expect(staleness(base(), INTERVAL, at(30))).toBeNull()
    expect(staleness(base(), INTERVAL, at(74))).toBeNull()
  })

  it('is null up to 2.5 intervals, and stale beyond', () => {
    expect(staleness(base(), INTERVAL, at(75))).toBeNull()
    expect(staleness(base(), INTERVAL, at(75.001))).not.toBeNull()
  })

  it('says how old the values are when no new reading arrived', () => {
    const result = staleness(base(), INTERVAL, at(180))
    expect(result).toEqual({
      message: 'Les valeurs affichées ont été relevées il y a 3 min.',
      cause: null,
      technical: null
    })
  })

  it('says the last reading failed, with the cause explained and the raw text kept apart', () => {
    const failing = base({ lastError: 'Command timed out after 20000 ms' })
    expect(staleness(failing, INTERVAL, at(40))).toEqual({
      message: 'Le dernier relevé a échoué : les valeurs affichées ont été relevées il y a 40 s.',
      cause: 'bento a mis trop de temps à répondre.',
      technical: 'Command timed out after 20000 ms'
    })
  })

  it('warns about a failing reading even when the data is still recent', () => {
    const failing = base({ lastError: 'Command timed out after 20000 ms' })
    expect(staleness(failing, INTERVAL, at(2))?.message).toContain('a échoué')
  })

  it('keeps the raw text when the error is not a known one', () => {
    const result = staleness(base({ lastError: 'weird failure' }), INTERVAL, at(10))
    expect(result?.cause).toBeNull()
    expect(result?.technical).toBe('weird failure')
  })

  it('follows the configured interval', () => {
    expect(staleness(base(), 120, at(250))).toBeNull()
    expect(staleness(base(), 120, at(301))).not.toBeNull()
    expect(staleness(base(), 10, at(26))).not.toBeNull()
  })

  it('is left to the main verdict when bento is unreachable or not set up', () => {
    const offline = base({ connection: 'offline', overall: 'offline', lastError: 'timeout' })
    expect(staleness(offline, INTERVAL, at(500))).toBeNull()
    expect(staleness(base({ configured: false }), INTERVAL, at(500))).toBeNull()
  })

  it('is null before any data has been read', () => {
    expect(staleness(status({ updatedAt: null }), INTERVAL, at(500))).toBeNull()
  })

  it('does not treat a reading from the future as old', () => {
    expect(staleness(base({ updatedAt: at(100) }), INTERVAL, at(0))).toBeNull()
  })
})
