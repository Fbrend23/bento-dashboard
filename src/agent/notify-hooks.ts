import { INFO_PREFIX, type OutboundNotification } from './notification'

// Turns what a script or a media app posts into a notification. Nothing here trusts the shape:
// every field is checked, and a payload that is not understood is `null` (the caller answers 400).
// `'ignore'` is a payload that is understood and not worth a push (a rename, a grab, a health event).

export type HookResult = OutboundNotification | 'ignore' | null

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, max = 300): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null

const withYear = (title: string, year: unknown): string =>
  typeof year === 'number' && year > 0 ? `${title} (${year})` : title

const info = (kind: string, title: string, body: string): OutboundNotification => ({
  id: `${INFO_PREFIX}${kind}`,
  title,
  body,
  priority: 'default',
  tags: ['clapper']
})

const TEST: OutboundNotification = {
  id: `${INFO_PREFIX}test`,
  title: 'Test réussi',
  body: 'bento reçoit bien les notifications de cette application.',
  priority: 'default',
  tags: ['white_check_mark']
}

/** `{title, body, priority?}` from a script. */
export function fromNotifyBody(value: unknown): HookResult {
  if (!isRecord(value)) return null
  const title = text(value.title, 250)
  const body = text(value.body, 3000)
  if (!title || !body) return null
  const priority = value.priority
  if (
    priority !== undefined &&
    priority !== 'low' &&
    priority !== 'default' &&
    priority !== 'high'
  ) {
    return null
  }
  return {
    id: `${INFO_PREFIX}script`,
    title,
    body,
    priority: priority ?? (title.startsWith('❌') ? 'high' : 'default'),
    tags: title.startsWith('❌') ? ['rotating_light'] : []
  }
}

/** Sonarr: an episode imported (`Download`), possibly replacing a worse file. */
export function fromSonarr(value: unknown): HookResult {
  if (!isRecord(value)) return null
  if (value.eventType === 'Test') return TEST
  if (value.eventType !== 'Download') return typeof value.eventType === 'string' ? 'ignore' : null
  const series = isRecord(value.series) ? text(value.series.title) : null
  if (!series) return null
  const episodes = Array.isArray(value.episodes) ? value.episodes.filter(isRecord) : []
  const labels = episodes.slice(0, 4).map((episode) => {
    const season = typeof episode.seasonNumber === 'number' ? episode.seasonNumber : null
    const number = typeof episode.episodeNumber === 'number' ? episode.episodeNumber : null
    const code =
      season !== null && number !== null
        ? `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`
        : ''
    const name = text(episode.title, 120)
    return [code, name].filter(Boolean).join(' · ')
  })
  const more = episodes.length > labels.length ? ` (+${episodes.length - labels.length})` : ''
  const upgrade = value.isUpgrade === true
  return info(
    'sonarr',
    upgrade ? `📺 ${series} : meilleure version` : `📺 ${series} est disponible`,
    labels.filter(Boolean).join('\n') + more || 'Nouvel épisode importé.'
  )
}

/** Radarr: a film imported (`Download`), possibly replacing a worse file. */
export function fromRadarr(value: unknown): HookResult {
  if (!isRecord(value)) return null
  if (value.eventType === 'Test') return TEST
  if (value.eventType !== 'Download') return typeof value.eventType === 'string' ? 'ignore' : null
  const movie = isRecord(value.movie) ? text(value.movie.title) : null
  if (!movie) return null
  const title = withYear(movie, isRecord(value.movie) ? value.movie.year : undefined)
  const upgrade = value.isUpgrade === true
  return info(
    'radarr',
    upgrade ? `🎬 ${title} : meilleure version` : `🎬 ${title} est disponible`,
    upgrade ? 'Le fichier a été remplacé par une meilleure qualité.' : 'Bonne séance.'
  )
}

/** Jellyseerr's default webhook payload: a request approved or available. */
export function fromJellyseerr(value: unknown): HookResult {
  if (!isRecord(value)) return null
  const type = value.notification_type
  if (type === 'TEST_NOTIFICATION') return TEST
  if (type !== 'MEDIA_AVAILABLE' && type !== 'MEDIA_APPROVED' && type !== 'MEDIA_AUTO_APPROVED') {
    return typeof type === 'string' ? 'ignore' : null
  }
  const subject = text(value.subject)
  if (!subject) return null
  const requester =
    isRecord(value.request) && text(value.request.requestedBy_username)
      ? ` pour ${text(value.request.requestedBy_username)}`
      : ''
  const available = type === 'MEDIA_AVAILABLE'
  return info(
    'jellyseerr',
    available ? `🍿 ${subject} est disponible` : `✅ ${subject} : demande acceptée`,
    available ? `La demande${requester} est prête.` : `La demande${requester} est en cours.`
  )
}
