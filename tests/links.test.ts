import { describe, expect, it } from 'vitest'
import { buildServiceUrl } from '../src/main/links'

describe('buildServiceUrl', () => {
  it('opens a published port over http on the configured host', () => {
    expect(buildServiceUrl('bento.example.ts.net', 8096)).toBe('http://bento.example.ts.net:8096/')
    expect(buildServiceUrl('100.64.0.7', 8989)).toBe('http://100.64.0.7:8989/')
  })

  it('uses https for the known https ports', () => {
    expect(buildServiceUrl('bento', 9443)).toBe('https://bento:9443/')
    expect(buildServiceUrl('bento', 8443)).toBe('https://bento:8443/')
    expect(buildServiceUrl('bento', 443)).toBe('https://bento:443/')
  })

  it('brackets an IPv6 address', () => {
    expect(buildServiceUrl('fd7a:115c:a1e0::1', 8096)).toBe('http://[fd7a:115c:a1e0::1]:8096/')
  })

  it.each([0, -1, 65536, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '8096', null, undefined])(
    'refuses the port %s',
    (port) => {
      expect(buildServiceUrl('bento', port as number)).toBeNull()
    }
  )

  it.each([
    '',
    ' ',
    'bento/evil',
    'user@bento',
    'bento#x',
    'bento?x=1',
    'bento evil',
    'bento\\evil',
    'http://bento',
    'bento:80:90:x/',
    '-bento',
    null,
    undefined,
    42
  ])('refuses the host %j', (host) => {
    expect(buildServiceUrl(host as string, 8096)).toBeNull()
  })

  it('always returns a plain http(s) URL pointing at the host and port asked for', () => {
    const url = new URL(buildServiceUrl('bento.ts.net', 8096) as string)
    expect(url.protocol).toBe('http:')
    expect(url.hostname).toBe('bento.ts.net')
    expect(url.port).toBe('8096')
    expect(url.pathname).toBe('/')
    expect(url.username + url.password + url.search + url.hash).toBe('')
  })
})
