import { formatMoment } from './chart'
import type { Incident } from './history'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** A length of time as "12 min", "2 h 05" or "1 j 2 h". */
export function formatSpan(ms: number): string {
  if (ms < MINUTE) return "moins d'une minute"
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR)
    const minutes = Math.floor((ms % HOUR) / MINUTE)
    return minutes === 0 ? `${hours} h` : `${hours} h ${String(minutes).padStart(2, '0')}`
  }
  const days = Math.floor(ms / DAY)
  const hours = Math.floor((ms % DAY) / HOUR)
  return hours === 0 ? `${days} j` : `${days} j ${hours} h`
}

export interface IncidentText {
  title: string
  when: string
  duration: string
  open: boolean
}

/** One line of the incident list, in the past tense once it is over. */
export function describeIncident(incident: Incident, now: number): IncidentText {
  const open = incident.endedAt === null
  const span = formatSpan((incident.endedAt ?? now) - incident.startedAt)
  const title = (() => {
    switch (incident.kind) {
      case 'service-down':
        return `${incident.subject} ${open ? 'est' : 'était'} à l'arrêt`
      case 'unreachable':
        return `Bento ${open ? 'est' : 'était'} injoignable`
      case 'disk-full':
        return `Disque ${incident.subject} presque plein`
    }
  })()
  return {
    title,
    when: formatMoment(incident.startedAt),
    duration: open ? `depuis ${span}` : `pendant ${span}`,
    open
  }
}
