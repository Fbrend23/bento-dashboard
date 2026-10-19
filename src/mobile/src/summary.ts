import type { AgentStatus } from '@shared/agent'
import { translateServiceDetail } from '@shared/format'
import type { ServiceStatus } from '@shared/monitors'
import type { Tone } from '@shared/verdict'

/** The one-sentence answer to "is bento fine?" shown at the top of the page. */
export interface Summary {
  tone: Tone
  title: string
  details: string[]
}

const isDown = (s: ServiceStatus): boolean => s.level === 'down' || s.level === 'absent'
const isSoft = (s: ServiceStatus): boolean => s.level === 'degraded' || s.level === 'unknown'
const line = (s: ServiceStatus): string => `${s.label} : ${translateServiceDetail(s.detail)}`

/**
 * `error` is why the last refresh failed, if it did; the last known status stays on screen
 * with a warning that it may be old, so a flaky connection never blanks the page.
 */
export function summarize(status: AgentStatus | null, error: string | null): Summary {
  if (error) {
    return {
      tone: 'idle',
      title: error,
      details: status ? ['Les dernières valeurs connues restent affichées.'] : []
    }
  }
  if (!status) return { tone: 'idle', title: 'Lecture en cours…', details: [] }

  const down = status.services.filter(isDown)
  const soft = status.services.filter(isSoft)
  if (down.length > 0) {
    return {
      tone: 'danger',
      title: down.length > 1 ? "Plusieurs services sont à l'arrêt." : "Un service est à l'arrêt.",
      details: [...down.map(line), ...soft.map(line)]
    }
  }
  if (soft.length > 0) {
    return { tone: 'warn', title: 'Bento demande votre attention.', details: soft.map(line) }
  }
  return { tone: 'ok', title: 'Bento va bien.', details: ['Tous les services répondent.'] }
}
