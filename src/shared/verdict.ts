import type { BentoStatus, ServiceStatus } from './monitors'
import { formatPercent, translateServiceDetail } from './format'
import { explainSshError } from './ssh-errors'

export type Tone = 'ok' | 'warn' | 'danger' | 'idle'

/** The one-sentence answer to "is bento fine?", plus what is behind it. */
export interface Verdict {
  tone: Tone
  title: string
  details: string[]
  /** Raw error text for the curious; never the main message. */
  technical: string | null
  action: 'configure' | null
}

const isDown = (s: ServiceStatus): boolean => s.level === 'down' || s.level === 'absent'
const isSoft = (s: ServiceStatus): boolean => s.level === 'degraded' || s.level === 'unknown'
const serviceLine = (s: ServiceStatus): string => `${s.label} : ${translateServiceDetail(s.detail)}`

export function buildVerdict(status: BentoStatus): Verdict {
  const hasData = status.services.length > 0 || status.metrics !== null

  switch (status.overall) {
    case 'unconfigured':
      return {
        tone: 'idle',
        title: "Bento n'est pas encore configuré.",
        details: ["Renseignez l'hôte et l'empreinte du serveur pour démarrer la surveillance."],
        technical: null,
        action: 'configure'
      }
    case 'offline': {
      const connecting = status.connection === 'connecting'
      const cause = connecting ? null : explainSshError(status.lastError)
      return {
        tone: 'idle',
        title: 'Bento est injoignable.',
        details: [
          connecting ? 'Connexion en cours…' : 'Nouvelle tentative automatique.',
          ...(cause ? [cause] : []),
          ...(hasData ? ['Les dernières valeurs connues restent affichées.'] : [])
        ],
        technical: status.lastError,
        action: null
      }
    }
    case 'pending':
      return {
        tone: 'idle',
        title: 'Première lecture en cours…',
        details: [],
        technical: null,
        action: null
      }
    case 'ok':
      return {
        tone: 'ok',
        title: 'Bento va bien.',
        details: ['Tous les services répondent.'],
        technical: null,
        action: null
      }
    default: {
      const down = status.services.filter(isDown)
      const disks = status.metrics?.disks.filter((d) => d.overThreshold) ?? []
      return {
        tone: status.overall === 'down' ? 'danger' : 'warn',
        title:
          status.overall === 'down'
            ? down.length > 1
              ? "Plusieurs services sont à l'arrêt."
              : "Un service est à l'arrêt."
            : 'Bento demande votre attention.',
        details: [
          ...down.map(serviceLine),
          ...status.services.filter(isSoft).map(serviceLine),
          ...disks.map((d) => `Le disque ${d.mount} est rempli à ${formatPercent(d.usedPercent)}.`)
        ],
        technical: null,
        action: null
      }
    }
  }
}
