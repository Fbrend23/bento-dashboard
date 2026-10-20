import { DEFAULT_SETTINGS, type Settings, type SettingsErrors } from '@shared/settings'

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const fail = (error: string): Parsed<never> => ({ ok: false, error })

const HOST = /^[A-Za-z0-9][A-Za-z0-9.:-]*$/
const USERNAME = /^[a-z_][a-z0-9_-]{0,31}$/
const FINGERPRINT = /^SHA256:[A-Za-z0-9+/]{43}$/
const CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/
// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

function trimmedString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null
}

function integerInRange(value: unknown, min: number, max: number): Parsed<number> {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? ok(value)
    : fail(`Entrez un nombre entier entre ${min} et ${max}.`)
}

const MAX_LABEL_LENGTH = 40
const MAX_LABELS = 64
const MAX_LOG_CONTAINERS = 32

function labelText(value: unknown): string | null {
  const text = trimmedString(value)
  return text !== null &&
    text.length >= 1 &&
    text.length <= MAX_LABEL_LENGTH &&
    !CONTROL_CHARS.test(text)
    ? text
    : null
}

/** An object of `key -> label` pairs; every key must pass `validKey`. Built as plain own data. */
function labelTable(
  value: unknown,
  validKey: (key: string) => boolean,
  what: string
): Parsed<Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('Liste de libellés attendue.')
  }
  const entries = Object.entries(value)
  if (entries.length > MAX_LABELS) return fail(`${MAX_LABELS} libellés au maximum.`)
  const table: Record<string, string> = {}
  for (const [key, raw] of entries) {
    if (!validKey(key)) return fail(`${what} invalide : « ${key.slice(0, 40)} ».`)
    const label = labelText(raw)
    if (label === null) {
      return fail(
        `Libellé de « ${key.slice(0, 40)} » invalide (1 à ${MAX_LABEL_LENGTH} caractères).`
      )
    }
    table[key] = label
  }
  return ok(table)
}

const isContainerKey = (key: string): boolean => key.length <= 128 && CONTAINER.test(key)
const isPortKey = (key: string): boolean => {
  const port = Number(key)
  return /^\d{1,5}$/.test(key) && port >= 1 && port <= 65535
}

const yesNo = (value: unknown): Parsed<boolean> =>
  typeof value === 'boolean' ? ok(value) : fail('Valeur oui / non attendue.')

const timeOfDay = (value: unknown): Parsed<string> =>
  typeof value === 'string' && TIME_OF_DAY.test(value)
    ? ok(value)
    : fail('Heure invalide : attendue au format HH:MM, par exemple 22:30.')

const parsers: { [K in keyof Settings]: (value: unknown) => Parsed<Settings[K]> } = {
  host(value) {
    const host = trimmedString(value)
    if (host === null) return fail("L'hôte doit être du texte.")
    if (host === '') return ok(host)
    return host.length <= 253 && HOST.test(host)
      ? ok(host)
      : fail('Hôte invalide : lettres, chiffres, points, tirets et deux-points uniquement.')
  },
  port: (value) => integerInRange(value, 1, 65535),
  username(value) {
    const username = trimmedString(value)
    return username !== null && USERNAME.test(username)
      ? ok(username)
      : fail("Nom d'utilisateur invalide (minuscules, chiffres, - et _).")
  },
  hostFingerprint(value) {
    const fingerprint = trimmedString(value)
    return fingerprint !== null && (fingerprint === '' || FINGERPRINT.test(fingerprint))
      ? ok(fingerprint)
      : fail('Empreinte invalide : attendue au format « SHA256:… » (43 caractères).')
  },
  refreshIntervalSec: (value) => integerInRange(value, 10, 3600),
  hiddenContainers(value) {
    if (!Array.isArray(value) || value.length > 100) {
      return fail('Liste de 100 conteneurs au maximum.')
    }
    const names = value.map(trimmedString)
    const valid = names.every((n) => n !== null && n.length <= 128 && CONTAINER.test(n))
    if (!valid) return fail('Nom de conteneur invalide.')
    return new Set(names).size === names.length
      ? ok(names as string[])
      : fail('Un conteneur est listé plusieurs fois.')
  },
  containerLabels: (value) => labelTable(value, isContainerKey, 'Nom de conteneur'),
  stackLabels: (value) => labelTable(value, isContainerKey, 'Nom de stack'),
  portLabels: (value) => labelTable(value, isPortKey, 'Port') as Parsed<Record<number, string>>,
  logContainers(value) {
    if (!Array.isArray(value) || value.length > MAX_LOG_CONTAINERS) {
      return fail(`Liste de ${MAX_LOG_CONTAINERS} conteneurs au maximum.`)
    }
    const names = value.map(trimmedString)
    if (!names.every((n) => n !== null && isContainerKey(n)))
      return fail('Nom de conteneur invalide.')
    return new Set(names).size === names.length
      ? ok(names as string[])
      : fail('Un conteneur est listé plusieurs fois.')
  },
  diskThresholdPercent: (value) => integerInRange(value, 1, 100),
  excludedMounts(value) {
    if (!Array.isArray(value) || value.length > 50)
      return fail('Liste de 50 points de montage au maximum.')
    const valid = value.every(
      (m) => typeof m === 'string' && m.startsWith('/') && m.length <= 200 && !CONTROL_CHARS.test(m)
    )
    return valid ? ok(value as string[]) : fail('Chaque point de montage doit commencer par « / ».')
  },
  notifyUnhealthy: yesNo,
  launchAtStartup: yesNo,
  autoUpdate: yesNo,
  notifyRecovery: yesNo,
  notifyCpu: yesNo,
  cpuThresholdPercent: (value) => integerInRange(value, 50, 100),
  notifyMemory: yesNo,
  memoryThresholdPercent: (value) => integerInRange(value, 50, 100),
  notifyLoad: yesNo,
  loadThreshold: (value) => integerInRange(value, 1, 1000),
  sustainedSamples: (value) => integerInRange(value, 1, 20),
  quietHoursEnabled: yesNo,
  quietHoursStart: timeOfDay,
  quietHoursEnd: timeOfDay
}

const KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]

/**
 * Lenient on purpose: always returns usable settings (invalid or missing fields fall back to
 * their default) plus the errors to show in the form. Unknown keys are dropped.
 */
export function validateSettings(input: unknown): { settings: Settings; errors: SettingsErrors } {
  const settings: Settings = structuredClone(DEFAULT_SETTINGS)
  const errors: SettingsErrors = {}

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    errors.settings = 'Réglages illisibles : valeurs par défaut utilisées.'
    return { settings, errors }
  }

  const record = input as Record<string, unknown>
  const apply = <K extends keyof Settings>(key: K): void => {
    const raw = record[key]
    if (raw === undefined) return
    const parsed = parsers[key](raw)
    if (parsed.ok) settings[key] = parsed.value
    else errors[key] = parsed.error
  }
  KEYS.forEach(apply)
  return { settings, errors }
}

/** Enough information to attempt a connection. */
export function isConfigured(settings: Settings): boolean {
  return settings.host !== '' && settings.hostFingerprint !== ''
}
