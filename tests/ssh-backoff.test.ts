import { describe, expect, it } from 'vitest'
import { reconnectDelay } from '../src/main/ssh/backoff'

describe('reconnectDelay', () => {
  it('starts at one second and doubles on each consecutive failure', () => {
    expect([0, 1, 2, 3].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000])
  })

  it('is capped at one minute', () => {
    expect(reconnectDelay(6)).toBe(60000)
    expect(reconnectDelay(50)).toBe(60000)
  })

  it('treats invalid attempts as the first one', () => {
    expect(reconnectDelay(-1)).toBe(1000)
    expect(reconnectDelay(Number.NaN)).toBe(1000)
  })
})
