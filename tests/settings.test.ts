import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { isConfigured, validateSettings } from '../src/main/settings/validate'
import { toSshConfig } from '../src/main/settings/ssh-config'

const valid: Settings = {
  host: 'bento.example.ts.net',
  port: 2222,
  username: 'bento-dash',
  hostFingerprint: 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  refreshIntervalSec: 60,
  hiddenContainers: ['scratch', 'old-test'],
  containerLabels: { 'app-1': 'Mon appli', whoami: 'Test' },
  stackLabels: { media: 'Médias' },
  portLabels: { 8096: 'Jellyfin', 9000: 'Console' },
  logContainers: ['app-1', 'jellyfin'],
  diskThresholdPercent: 90,
  excludedMounts: ['/boot/efi', '/mnt/old'],
  notifyUnhealthy: false,
  launchAtStartup: true,
  notifyRecovery: false,
  notifyCpu: false,
  cpuThresholdPercent: 75,
  notifyMemory: false,
  memoryThresholdPercent: 80,
  notifyLoad: true,
  loadThreshold: 12,
  sustainedSamples: 5,
  quietHoursEnabled: true,
  quietHoursStart: '23:30',
  quietHoursEnd: '06:15'
}

describe('DEFAULT_SETTINGS', () => {
  it('matches the agreed defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      host: '',
      port: 22,
      username: 'bento-dash',
      hostFingerprint: '',
      refreshIntervalSec: 30,
      hiddenContainers: [],
      containerLabels: { jellyfin: 'Jellyfin' },
      stackLabels: {},
      portLabels: { 8096: 'Jellyfin' },
      logContainers: [],
      diskThresholdPercent: 85,
      excludedMounts: ['/boot/efi'],
      notifyUnhealthy: true,
      launchAtStartup: false,
      notifyRecovery: true,
      notifyCpu: true,
      cpuThresholdPercent: 90,
      notifyMemory: true,
      memoryThresholdPercent: 90,
      notifyLoad: false,
      loadThreshold: 8,
      sustainedSamples: 3,
      quietHoursEnabled: false,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00'
    })
  })
})

describe('validateSettings (valid input)', () => {
  it('accepts the defaults', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual({ settings: DEFAULT_SETTINGS, errors: {} })
  })

  it('accepts a fully custom configuration unchanged', () => {
    expect(validateSettings(valid)).toEqual({ settings: valid, errors: {} })
  })

  it('fills missing fields with defaults', () => {
    const { settings, errors } = validateSettings({ host: '192.0.2.10' })
    expect(errors).toEqual({})
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, host: '192.0.2.10' })
  })

  it('trims text fields and drops unknown keys', () => {
    const { settings } = validateSettings({ host: '  bento.ts.net  ', extra: 'x', __proto__: 1 })
    expect(settings.host).toBe('bento.ts.net')
    expect(settings).not.toHaveProperty('extra')
  })

  it('accepts an unconfigured empty host and fingerprint', () => {
    expect(validateSettings({ host: '', hostFingerprint: '' }).errors).toEqual({})
  })
})

describe('validateSettings (invalid input)', () => {
  it.each([null, 'text', 42, [], undefined])('falls back to defaults for %j', (input) => {
    const { settings, errors } = validateSettings(input)
    expect(settings).toEqual(DEFAULT_SETTINGS)
    expect(errors.settings).toBeTypeOf('string')
  })

  it.each([
    ['host', 'bad host'],
    ['host', '-oProxyCommand=calc'],
    ['host', 'a;b'],
    ['host', 'x'.repeat(300)],
    ['host', 42],
    ['port', 0],
    ['port', 70000],
    ['port', 22.5],
    ['port', '22'],
    ['username', 'Bad User'],
    ['username', ''],
    ['username', 'root;ls'],
    ['hostFingerprint', 'abc'],
    ['hostFingerprint', 'SHA256:short'],
    ['hostFingerprint', 'MD5:aa:bb'],
    ['refreshIntervalSec', 5],
    ['refreshIntervalSec', 5000],
    ['refreshIntervalSec', 'fast'],
    ['diskThresholdPercent', 0],
    ['diskThresholdPercent', 101],
    ['diskThresholdPercent', Number.NaN],
    ['hiddenContainers', 'jellyfin'],
    ['hiddenContainers', ['bad name']],
    ['hiddenContainers', ['-rm']],
    ['hiddenContainers', ['a', 'a']],
    ['hiddenContainers', Array.from({ length: 101 }, (_, i) => `c${i}`)],
    ['containerLabels', 'app'],
    ['containerLabels', ['app']],
    ['containerLabels', { 'bad name': 'App' }],
    ['containerLabels', { '-rm': 'App' }],
    ['containerLabels', { 'app-1': '' }],
    ['containerLabels', { 'app-1': '   ' }],
    ['containerLabels', { 'app-1': 'x'.repeat(41) }],
    ['containerLabels', { 'app-1': 'multi\nline' }],
    ['containerLabels', { 'app-1': 42 }],
    ['containerLabels', Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`c${i}`, 'x']))],
    ['stackLabels', { 'bad;name': 'Stack' }],
    ['stackLabels', { media: '' }],
    ['portLabels', { abc: 'Web' }],
    ['portLabels', { 0: 'Web' }],
    ['portLabels', { 70000: 'Web' }],
    ['portLabels', { '80.5': 'Web' }],
    ['portLabels', { 8080: '' }],
    ['portLabels', { 8080: 'a\u0007b' }],
    ['logContainers', 'app-1'],
    ['logContainers', ['bad name']],
    ['logContainers', ['a;id']],
    ['logContainers', ['$(id)']],
    ['logContainers', ['--help']],
    ['logContainers', ['tailscaled:x']],
    ['logContainers', ['a', 'a']],
    ['logContainers', Array.from({ length: 33 }, (_, i) => `c${i}`)],
    ['excludedMounts', ['boot']],
    ['excludedMounts', 'boot'],
    ['excludedMounts', ['/ok', '/bad\nline']],
    ['notifyUnhealthy', 'yes'],
    ['launchAtStartup', 1],
    ['notifyRecovery', 'yes'],
    ['notifyCpu', 1],
    ['notifyMemory', null],
    ['notifyLoad', 'true'],
    ['cpuThresholdPercent', 49],
    ['cpuThresholdPercent', 101],
    ['cpuThresholdPercent', 90.5],
    ['memoryThresholdPercent', 10],
    ['memoryThresholdPercent', '90'],
    ['loadThreshold', 0],
    ['loadThreshold', 1001],
    ['loadThreshold', Number.NaN],
    ['sustainedSamples', 0],
    ['sustainedSamples', 21],
    ['sustainedSamples', 2.5],
    ['quietHoursEnabled', 'yes'],
    ['quietHoursStart', '24:00'],
    ['quietHoursStart', '9:00'],
    ['quietHoursStart', '09:60'],
    ['quietHoursStart', '22h00'],
    ['quietHoursStart', 2200],
    ['quietHoursEnd', ''],
    ['quietHoursEnd', '07:00 ']
  ])('rejects %s = %j and falls back to the default for that field only', (key, value) => {
    const { settings, errors } = validateSettings({ ...valid, [key]: value })
    expect(Object.keys(errors)).toEqual([key])
    expect(errors[key as keyof Settings]).toBeTypeOf('string')
    expect(settings[key as keyof Settings]).toEqual(DEFAULT_SETTINGS[key as keyof Settings])
    expect(settings.diskThresholdPercent).toBe(
      key === 'diskThresholdPercent' ? 85 : valid.diskThresholdPercent
    )
  })

  it('reports every invalid field at once', () => {
    const { errors } = validateSettings({ ...valid, port: 0, username: '', refreshIntervalSec: 1 })
    expect(Object.keys(errors).sort()).toEqual(['port', 'refreshIntervalSec', 'username'])
  })
})

describe('validateSettings (labels and log containers)', () => {
  it('trims labels and keeps container names untouched', () => {
    const { settings, errors } = validateSettings({
      containerLabels: { 'app-1': '  Mon appli  ' },
      logContainers: [' app-1 ']
    })
    expect(errors).toEqual({})
    expect(settings.containerLabels).toEqual({ 'app-1': 'Mon appli' })
    expect(settings.logContainers).toEqual(['app-1'])
  })

  it('keeps a container named like an inherited property as plain data', () => {
    const { settings, errors } = validateSettings({ containerLabels: { constructor: 'Ctor' } })
    expect(errors).toEqual({})
    expect(Object.hasOwn(settings.containerLabels, 'constructor')).toBe(true)
  })

  it('rejects a __proto__ key without polluting anything', () => {
    const input = JSON.parse('{"containerLabels": {"__proto__": "Pwned"}}')
    const { settings, errors } = validateSettings(input)
    expect(errors.containerLabels).toBeTypeOf('string')
    expect(settings.containerLabels).toEqual(DEFAULT_SETTINGS.containerLabels)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it('lets the user empty every table', () => {
    const { settings, errors } = validateSettings({
      containerLabels: {},
      stackLabels: {},
      portLabels: {},
      logContainers: []
    })
    expect(errors).toEqual({})
    expect(settings.containerLabels).toEqual({})
    expect(settings.portLabels).toEqual({})
  })
})

describe('isConfigured', () => {
  it('needs both a host and a pinned fingerprint', () => {
    expect(isConfigured(DEFAULT_SETTINGS)).toBe(false)
    expect(isConfigured({ ...DEFAULT_SETTINGS, host: 'bento.ts.net' })).toBe(false)
    expect(isConfigured({ ...DEFAULT_SETTINGS, hostFingerprint: valid.hostFingerprint })).toBe(
      false
    )
    expect(isConfigured(valid)).toBe(true)
  })
})

describe('toSshConfig', () => {
  it('maps settings to an agent-authenticated ssh config', () => {
    expect(toSshConfig(valid)).toEqual({
      host: 'bento.example.ts.net',
      port: 2222,
      username: 'bento-dash',
      hostFingerprint: valid.hostFingerprint,
      auth: { kind: 'agent' }
    })
  })
})
