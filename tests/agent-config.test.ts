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
      hiddenContainers: [],
      diskThresholdPercent: 85,
      discordWebhookUrl: undefined,
      discordMentionUserId: undefined
    })
  })

  it('reads the Discord user to mention, and refuses anything but a numeric id', () => {
    expect(
      parseAgentConfig(JSON.stringify({ ...minimal, discordMentionUserId: '123456789012345678' }))
        .discordMentionUserId
    ).toBe('123456789012345678')
    for (const discordMentionUserId of [
      '',
      '@yochy23',
      'yochy23',
      '<@123456789012345678>',
      '123',
      Number('123456789012345678'),
      null
    ]) {
      expect(() => parseAgentConfig(JSON.stringify({ ...minimal, discordMentionUserId }))).toThrow(
        AgentConfigError
      )
    }
  })

  it('reads a Discord webhook url', () => {
    const url = 'https://discord.com/api/webhooks/123456789/abc-DEF_123'
    expect(
      parseAgentConfig(JSON.stringify({ ...minimal, discordWebhookUrl: url })).discordWebhookUrl
    ).toBe(url)
  })

  it('refuses anything but a Discord webhook url, without echoing the value', () => {
    for (const discordWebhookUrl of [
      '',
      3,
      null,
      'http://discord.com/api/webhooks/1/abc',
      'https://evil.example/api/webhooks/1/abc',
      'https://discord.com.evil.example/api/webhooks/1/abc',
      'https://discord.com/api/webhooks/1/abc?wait=true',
      'https://discord.com/api/webhooks/x/abc',
      'https://user@discord.com/api/webhooks/1/abc'
    ]) {
      let message = ''
      try {
        parseAgentConfig(JSON.stringify({ ...minimal, discordWebhookUrl }))
      } catch (error) {
        expect(error).toBeInstanceOf(AgentConfigError)
        message = (error as Error).message
      }
      expect(message).toContain('discordWebhookUrl')
      if (typeof discordWebhookUrl === 'string' && discordWebhookUrl) {
        expect(message).not.toContain(discordWebhookUrl)
      }
    }
  })

  it('reads every optional field', () => {
    const config = parseAgentConfig(
      JSON.stringify({
        ...minimal,
        allowedOrigin: 'https://bento.example.ts.net',
        port: 9000,
        containerLabels: { jellyfin: 'Jellyfin' },
        stackLabels: { media: 'Médias' },
        hiddenContainers: ['helper-1'],
        diskThresholdPercent: 70
      })
    )
    expect(config).toMatchObject({
      allowedOrigin: 'https://bento.example.ts.net',
      port: 9000,
      containerLabels: { jellyfin: 'Jellyfin' },
      stackLabels: { media: 'Médias' },
      hiddenContainers: ['helper-1'],
      diskThresholdPercent: 70
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

  it('refuses a disk threshold that is not a whole percentage', () => {
    for (const diskThresholdPercent of [0, 101, 85.5, '85', null]) {
      expect(() => parseAgentConfig(JSON.stringify({ ...minimal, diskThresholdPercent }))).toThrow(
        AgentConfigError
      )
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
