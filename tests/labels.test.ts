import { describe, expect, it } from 'vitest'
import { containerLabel, stackLabel, webPortLabel, type LabelSettings } from '@shared/labels'
import { DEFAULT_SETTINGS } from '@shared/settings'

const labels: LabelSettings = {
  containerLabels: { 'app-1': 'Mon appli', jellyfin: 'Jellyfin' },
  stackLabels: { media: 'Médias' },
  portLabels: { 8096: 'Jellyfin', 9000: 'Console' }
}

describe('containerLabel', () => {
  it('uses the name configured in the settings', () => {
    expect(containerLabel('app-1', labels)).toBe('Mon appli')
    expect(containerLabel('jellyfin', labels)).toBe('Jellyfin')
  })

  it('keeps the docker name of containers without a label', () => {
    expect(containerLabel('my-new-app', labels)).toBe('my-new-app')
    expect(containerLabel('56d385c967ac_worker', labels)).toBe('56d385c967ac_worker')
  })

  it('does not look up inherited object properties', () => {
    expect(containerLabel('constructor', labels)).toBe('constructor')
    expect(containerLabel('__proto__', labels)).toBe('__proto__')
    expect(containerLabel('toString', labels)).toBe('toString')
  })

  it('shows a configured label for a container named like a property', () => {
    const own = { ...labels, containerLabels: { constructor: 'Ctor' } }
    expect(containerLabel('constructor', own)).toBe('Ctor')
  })

  it('ships with a friendly name for jellyfin only', () => {
    expect(containerLabel('jellyfin', DEFAULT_SETTINGS)).toBe('Jellyfin')
    expect(containerLabel('app-1', DEFAULT_SETTINGS)).toBe('app-1')
  })
})

describe('stackLabel', () => {
  it('uses the configured name', () => {
    expect(stackLabel('media', labels)).toBe('Médias')
  })

  it('capitalises the compose project otherwise', () => {
    expect(stackLabel('tools', labels)).toBe('Tools')
    expect(stackLabel('constructor', labels)).toBe('Constructor')
  })
})

describe('webPortLabel', () => {
  it('names a published port from the settings', () => {
    expect(webPortLabel(8096, labels)).toBe('Jellyfin')
    expect(webPortLabel(9000, labels)).toBe('Console')
  })

  it('has no name for an unknown port', () => {
    expect(webPortLabel(1234, labels)).toBeNull()
  })
})
