import { describe, expect, it } from 'vitest'
import { AgentConfigError, parseAgentConfig } from '../src/agent/config'

const minimal = { allowedLogin: 'owner@example.com' }

describe('parseAgentConfig', () => {
  it('needs only the allowed login and fills in the rest', () => {
    expect(parseAgentConfig(JSON.stringify(minimal))).toEqual({
      allowedLogin: 'owner@example.com',
      allowedOrigin: undefined,
      port: 8484,
      containerLabels: {},
      stackLabels: {},
      hiddenContainers: []
    })
  })

  it('reads every optional field', () => {
    const config = parseAgentConfig(
      JSON.stringify({
        ...minimal,
        allowedOrigin: 'https://bento.example.ts.net',
        port: 9000,
        containerLabels: { jellyfin: 'Jellyfin' },
        stackLabels: { media: 'Médias' },
        hiddenContainers: ['helper-1']
      })
    )
    expect(config).toMatchObject({
      allowedOrigin: 'https://bento.example.ts.net',
      port: 9000,
      containerLabels: { jellyfin: 'Jellyfin' },
      stackLabels: { media: 'Médias' },
      hiddenContainers: ['helper-1']
    })
  })

  it('refuses to start without a usable login', () => {
    for (const bad of [{}, { allowedLogin: '' }, { allowedLogin: '  ' }, { allowedLogin: 3 }]) {
      expect(() => parseAgentConfig(JSON.stringify(bad))).toThrow(AgentConfigError)
    }
  })

  it('refuses text that is not a JSON object', () => {
    for (const bad of ['', 'nope', '[]', 'null', '3']) {
      expect(() => parseAgentConfig(bad)).toThrow(AgentConfigError)
    }
  })

  it('refuses a bad port', () => {
    for (const port of [0, 80, 1023, 65536, 8484.5, '8484', null]) {
      expect(() => parseAgentConfig(JSON.stringify({ ...minimal, port }))).toThrow(AgentConfigError)
    }
  })

  it('refuses an origin that is not a bare https origin', () => {
    for (const allowedOrigin of [
      '',
      'bento.example.ts.net',
      'http://bento.example.ts.net',
      'https://bento.example.ts.net/',
      'https://bento.example.ts.net/path',
      3
    ]) {
      expect(() => parseAgentConfig(JSON.stringify({ ...minimal, allowedOrigin }))).toThrow(
        AgentConfigError
      )
    }
  })

  it('refuses malformed labels and hidden containers', () => {
    for (const extra of [
      { containerLabels: [] },
      { containerLabels: { jellyfin: 3 } },
      { stackLabels: 'media' },
      { stackLabels: { media: {} } },
      { hiddenContainers: 'x' },
      { hiddenContainers: [3] },
      { hiddenContainers: ['not a name; reboot'] }
    ]) {
      expect(() => parseAgentConfig(JSON.stringify({ ...minimal, ...extra }))).toThrow(
        AgentConfigError
      )
    }
  })

  it('ignores unknown fields instead of passing them on', () => {
    const config = parseAgentConfig(JSON.stringify({ ...minimal, listenHost: '0.0.0.0', extra: 1 }))
    expect(config).not.toHaveProperty('listenHost')
    expect(config).not.toHaveProperty('extra')
  })

  it('does not let a label table inherit from Object.prototype', () => {
    const config = parseAgentConfig(
      JSON.stringify({ ...minimal, containerLabels: { constructor: 'x' } })
    )
    expect(Object.getPrototypeOf(config.containerLabels)).toBe(Object.prototype)
    expect(Object.hasOwn(config.containerLabels, 'constructor')).toBe(true)
  })
})
