import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import { extractFingerprint, fromForm, toForm } from '../src/renderer/src/settings-form'

const FINGERPRINT = 'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

describe('toForm', () => {
  it('turns lists into one entry per line', () => {
    const form = toForm({
      ...DEFAULT_SETTINGS,
      hiddenContainers: ['homepage', 'stream'],
      excludedMounts: ['/boot/efi', '/mnt/old']
    })
    expect(form.hiddenContainers).toBe('homepage\nstream')
    expect(form.excludedMounts).toBe('/boot/efi\n/mnt/old')
  })

  it('writes the label tables as one "name = label" per line', () => {
    const form = toForm({
      ...DEFAULT_SETTINGS,
      containerLabels: { 'app-1': 'Mon appli', jellyfin: 'Jellyfin' },
      stackLabels: { media: 'Médias' },
      portLabels: { 8096: 'Jellyfin', 9000: 'Console' }
    })
    expect(form.containerLabels).toBe('app-1 = Mon appli\njellyfin = Jellyfin')
    expect(form.stackLabels).toBe('media = Médias')
    expect(form.portLabels).toBe('8096 = Jellyfin\n9000 = Console')
  })

  it('keeps the chosen log containers as a list', () => {
    expect(toForm({ ...DEFAULT_SETTINGS, logContainers: ['app-1'] }).logContainers).toEqual([
      'app-1'
    ])
  })

  it('keeps scalar fields as they are', () => {
    const form = toForm({ ...DEFAULT_SETTINGS, host: 'bento.ts.net', port: 2222 })
    expect(form).toMatchObject({ host: 'bento.ts.net', port: 2222, diskThresholdPercent: 85 })
  })
})

describe('fromForm', () => {
  const base: Settings = { ...DEFAULT_SETTINGS, notifyUnhealthy: false, launchAtStartup: true }

  it('round-trips the settings', () => {
    expect(fromForm(toForm(base))).toEqual(base)
  })

  it('splits lists on lines, trimming and dropping blanks', () => {
    const form = { ...toForm(base), hiddenContainers: ' homepage \r\n\r\nstream\n  \n' }
    expect(fromForm(form).hiddenContainers).toEqual(['homepage', 'stream'])
  })

  it('reads label tables, splitting each line at the first equals sign', () => {
    const form = {
      ...toForm(base),
      containerLabels: ' app-1 =  Mon appli \r\n\r\nwhoami=A = B\n  \n',
      stackLabels: 'media = Médias',
      portLabels: '8096 = Jellyfin\n9000=Console'
    }
    const settings = fromForm(form)
    expect(settings.containerLabels).toEqual({ 'app-1': 'Mon appli', whoami: 'A = B' })
    expect(settings.stackLabels).toEqual({ media: 'Médias' })
    expect(settings.portLabels).toEqual({ 8096: 'Jellyfin', 9000: 'Console' })
  })

  it('leaves a line without a label for the validation to flag', () => {
    const settings = fromForm({ ...toForm(base), containerLabels: 'app-1' })
    expect(settings.containerLabels).toEqual({ 'app-1': '' })
  })

  it('keeps a __proto__ line as plain data for the validation to refuse', () => {
    const settings = fromForm({ ...toForm(base), containerLabels: '__proto__ = x' })
    expect(Object.keys(settings.containerLabels)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(settings.containerLabels)).toBe(Object.prototype)
  })

  it('keeps mount paths untouched apart from outer whitespace', () => {
    const form = { ...toForm(base), excludedMounts: '/mnt/my disk\n/boot/efi' }
    expect(fromForm(form).excludedMounts).toEqual(['/mnt/my disk', '/boot/efi'])
  })

  it('carries the notification and startup toggles in both directions', () => {
    const form = toForm(base)
    expect(form.notifyUnhealthy).toBe(false)
    expect(form.launchAtStartup).toBe(true)

    const edited = fromForm({ ...form, notifyUnhealthy: true, launchAtStartup: false })
    expect(edited.notifyUnhealthy).toBe(true)
    expect(edited.launchAtStartup).toBe(false)
  })

  it('extracts the fingerprint from a pasted ssh-keygen line', () => {
    const form = {
      ...toForm(base),
      hostFingerprint: `256 ${FINGERPRINT} root@bento (ED25519)`
    }
    expect(fromForm(form).hostFingerprint).toBe(FINGERPRINT)
  })
})

describe('extractFingerprint', () => {
  it('finds the fingerprint inside surrounding text', () => {
    expect(extractFingerprint(`256 ${FINGERPRINT} root@host (ED25519)`)).toBe(FINGERPRINT)
  })

  it('returns plain input trimmed when nothing matches, so validation can flag it', () => {
    expect(extractFingerprint('  not a fingerprint ')).toBe('not a fingerprint')
    expect(extractFingerprint('')).toBe('')
  })
})

describe('fromForm with a reactive form (what the settings screen sends over IPC)', () => {
  it('returns plain data that structuredClone accepts', async () => {
    const { reactive } = await import('vue')
    const form = reactive(toForm({ ...DEFAULT_SETTINGS, logContainers: ['app-1'] }))
    form.logContainers.push('jellyfin')
    const settings = fromForm(form)
    expect(() => structuredClone(settings)).not.toThrow()
    expect(structuredClone(settings).logContainers).toEqual(['app-1', 'jellyfin'])
  })
})
