import type { Settings } from '@shared/settings'

/**
 * Settings as edited in the form: lists are one entry per line, and the label tables are one
 * "name = label" per line. The log containers stay a list (they are ticked, not typed).
 */
export type SettingsForm = Omit<
  Settings,
  'hiddenContainers' | 'excludedMounts' | 'containerLabels' | 'stackLabels' | 'portLabels'
> & {
  hiddenContainers: string
  excludedMounts: string
  containerLabels: string
  stackLabels: string
  portLabels: string
}

const FINGERPRINT = /SHA256:[A-Za-z0-9+/]{43}/

/** Accepts a whole `ssh-keygen -lf` line and keeps only the fingerprint. */
export function extractFingerprint(text: string): string {
  return text.match(FINGERPRINT)?.[0] ?? text.trim()
}

const toLines = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

const tableToText = (table: Readonly<Record<string, string>>): string =>
  Object.entries(table)
    .map(([key, label]) => `${key} = ${label}`)
    .join('\n')

/** A line without "=" gets an empty label, which the validation reports. */
function textToTable(text: string): Record<string, string> {
  // fromEntries defines own properties: a "__proto__" line stays data (and is refused later).
  return Object.fromEntries(
    toLines(text).map((line) => {
      const at = line.indexOf('=')
      return at < 0 ? [line, ''] : [line.slice(0, at).trim(), line.slice(at + 1).trim()]
    })
  )
}

export function toForm(settings: Settings): SettingsForm {
  return {
    ...settings,
    hiddenContainers: settings.hiddenContainers.join('\n'),
    excludedMounts: settings.excludedMounts.join('\n'),
    containerLabels: tableToText(settings.containerLabels),
    stackLabels: tableToText(settings.stackLabels),
    portLabels: tableToText(settings.portLabels)
  }
}

export function fromForm(form: SettingsForm): Settings {
  return {
    ...form,
    hostFingerprint: extractFingerprint(form.hostFingerprint),
    hiddenContainers: toLines(form.hiddenContainers),
    excludedMounts: toLines(form.excludedMounts),
    // A reactive (Proxy) array cannot cross the IPC: send a plain copy.
    logContainers: [...form.logContainers],
    containerLabels: textToTable(form.containerLabels),
    stackLabels: textToTable(form.stackLabels),
    // The keys are port numbers: validation checks them, JSON turns them into text anyway.
    portLabels: textToTable(form.portLabels) as Record<number, string>
  }
}
