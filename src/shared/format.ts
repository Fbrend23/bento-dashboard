import type { LoadAverage, OverallLevel, ServiceLevel } from './monitors'

const NBSP = ' '
const DASH = '—'

const decimal = (value: number, digits: number): string => value.toFixed(digits).replace('.', ',')

export function formatUptime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return DASH
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} j ${hours} h`
  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min`
  return "moins d'une minute"
}

export function formatPercent(value: number | null): string {
  return value === null ? DASH : `${Math.round(value)}${NBSP}%`
}

const BYTE_UNITS = ['o', 'Ko', 'Mo', 'Go', 'To', 'Po']

/** Decimal (SI) units, as shown by disks and file managers. */
export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000
    unit++
  }
  const text =
    unit === 0
      ? String(Math.round(value))
      : value < 100
        ? decimal(value, 1)
        : String(Math.round(value))
  return `${text}${NBSP}${BYTE_UNITS[unit]}`
}

/** A throughput; null (no previous sample yet, or counters reset) shows a dash. */
export function formatRate(bytesPerSec: number | null): string {
  return bytesPerSec === null ? DASH : `${formatBytes(bytesPerSec)}/s`
}

export function formatTemperature(celsius: number | null): string {
  return celsius === null ? DASH : `${Math.round(celsius)}${NBSP}°C`
}

/** Memory comes from /proc/meminfo in kibibytes. */
export function formatMemoryKb(kb: number | null): string {
  if (kb === null) return DASH
  const gibibytes = kb / 1048576
  return gibibytes >= 1
    ? `${decimal(gibibytes, 1)}${NBSP}Gio`
    : `${decimal(kb / 1024, 0)}${NBSP}Mio`
}

export function formatLoad(load: LoadAverage | null): string {
  if (!load) return DASH
  return [load.load1, load.load5, load.load15].map((n) => decimal(n, 2)).join(' / ')
}

export function formatAge(updatedAt: number | null, now: number): string {
  if (updatedAt === null) return 'jamais'
  const elapsed = now - updatedAt
  if (elapsed < 5000) return "à l'instant"
  if (elapsed < 60000) return `il y a ${Math.floor(elapsed / 1000)} s`
  if (elapsed < 3600000) return `il y a ${Math.floor(elapsed / 60000)} min`
  return `il y a ${Math.floor(elapsed / 3600000)} h`
}

const LEVEL_LABELS: Record<ServiceLevel, string> = {
  ok: 'Actif',
  degraded: 'Dégradé',
  down: 'Arrêté',
  absent: 'Introuvable',
  unknown: 'Inconnu',
  stopped: 'Inactif'
}

const OVERALL_LABELS: Record<OverallLevel, string> = {
  ok: 'Tout va bien',
  degraded: 'Attention',
  down: 'Panne',
  offline: 'Hors ligne',
  pending: 'Chargement…',
  unconfigured: 'À configurer'
}

export const levelLabel = (level: ServiceLevel): string => LEVEL_LABELS[level]
export const overallLabel = (level: OverallLevel): string => OVERALL_LABELS[level]

const DURATION_UNITS: Record<string, [one: string, many: string]> = {
  second: ['seconde', 'secondes'],
  minute: ['minute', 'minutes'],
  hour: ['heure', 'heures'],
  day: ['jour', 'jours'],
  week: ['semaine', 'semaines'],
  month: ['mois', 'mois'],
  year: ['an', 'ans']
}

/** Docker's human durations: "Less than a second", "About an hour", "4 days"… */
function translateDuration(text: string): string | null {
  if (text === 'Less than a second') return "moins d'une seconde"
  const about = text.match(/^About an? (second|minute|hour|day|week|month|year)$/)
  if (about) return `environ 1 ${DURATION_UNITS[about[1]][0]}`
  const counted = text.match(/^(\d+) (second|minute|hour|day|week|month|year)s?$/)
  if (!counted) return null
  const count = Number(counted[1])
  const [one, many] = DURATION_UNITS[counted[2]]
  return `${count} ${count > 1 ? many : one}`
}

const HEALTH_LABELS: Record<string, string> = {
  healthy: 'sain',
  unhealthy: 'non sain',
  'health: starting': 'démarrage',
  Paused: 'en pause'
}

const UNIT_WORDS: Record<string, string> = {
  active: 'actif',
  inactive: 'inactif',
  failed: 'en échec',
  activating: 'démarrage',
  deactivating: 'arrêt en cours',
  reloading: 'rechargement',
  running: 'en cours',
  dead: 'arrêté',
  exited: 'terminé',
  start: 'démarrage',
  waiting: 'en attente'
}

/** Translates docker `.Status` and systemd "state (substate)" texts; anything else is kept as is. */
export function translateServiceDetail(text: string): string {
  const up = text.match(/^Up (.+?)(?: \((healthy|unhealthy|health: starting|Paused)\))?$/)
  if (up) {
    const duration = translateDuration(up[1])
    if (duration) return `Actif depuis ${duration}${up[2] ? `, ${HEALTH_LABELS[up[2]]}` : ''}`
  }

  const ended = text.match(/^(Exited|Restarting) \((\d+)\) (.+) ago$/)
  if (ended) {
    const duration = translateDuration(ended[3])
    if (duration) {
      const state = ended[1] === 'Exited' ? 'Arrêté' : 'Redémarre en boucle'
      return `${state} (code ${ended[2]}) il y a ${duration}`
    }
  }

  const unit = text.match(/^(\w+) \((\w+)\)$/)
  if (unit && UNIT_WORDS[unit[1]] && UNIT_WORDS[unit[2]]) {
    return `${UNIT_WORDS[unit[1]]} (${UNIT_WORDS[unit[2]]})`
  }
  return text
}

/** Sub-line of a service row: the state word is already shown on the right of the row. */
export function rowDetail(detail: string): string {
  const text = translateServiceDetail(detail)
  const since = text.match(/^Actif depuis (.+)$/)
  if (since) return `Depuis ${since[1]}`
  const unit = text.match(/^actif \((.+)\)$/)
  if (unit) return unit[1].charAt(0).toUpperCase() + unit[1].slice(1)
  return text
}
