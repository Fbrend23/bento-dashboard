import { describe, expect, it } from 'vitest'
import { fingerprintOf, isTrustedHostKey } from '../src/main/ssh/hostkey'

const key = Buffer.from('test')
const expected = 'SHA256:n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg'

describe('fingerprintOf', () => {
  it('formats the SHA-256 of the key like OpenSSH (base64, no padding)', () => {
    expect(fingerprintOf(key)).toBe(expected)
  })
})

describe('isTrustedHostKey', () => {
  it('accepts the pinned fingerprint', () => {
    expect(isTrustedHostKey(key, expected)).toBe(true)
  })

  it('refuses a different key', () => {
    expect(isTrustedHostKey(Buffer.from('other'), expected)).toBe(false)
  })

  it('refuses everything when no fingerprint is pinned', () => {
    expect(isTrustedHostKey(key, undefined)).toBe(false)
    expect(isTrustedHostKey(key, '')).toBe(false)
  })

  it('is case sensitive', () => {
    expect(isTrustedHostKey(key, expected.toLowerCase())).toBe(false)
  })
})
