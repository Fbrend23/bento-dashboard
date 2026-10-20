import { isHistoryRange, type HistoryResult } from '@shared/history'
import { HISTORY_COMMAND } from '../ssh/commands'
import type { ExecResult } from '../ssh/connection'
import { incidentsInRange } from './incidents'
import { queryPoints } from './recorder'
import { parseHistory, type HistoryData } from './store'

/** The file is read at most this often: changing the range on screen costs no new read. */
export const HISTORY_CACHE_MS = 60_000

/**
 * Above this the file is not read at all. A full week is 2 to 3 MB; this leaves room for growth
 * (more disks) while a damaged or replaced file cannot fill the memory of the app.
 */
export const MAX_HISTORY_BYTES = 8 * 1024 * 1024

/** The history could not be read from bento and none was read before. Carries no detail. */
export class HistoryUnavailableError extends Error {
  constructor() {
    super("L'historique n'a pas pu être lu sur bento.")
    this.name = 'HistoryUnavailableError'
  }
}

export interface RemoteHistoryDeps {
  /** Runs a command on bento; the connection checks it against the allow-list. */
  run: (command: string) => Promise<ExecResult>
  now?: () => number
}

export interface RemoteHistory {
  /** `range` comes from the renderer: only the fixed ranges are answered, `null` otherwise. */
  query(range: unknown): Promise<HistoryResult | null>
}

/**
 * The history kept by the agent on bento, read over the SSH session. The file is the agent's: this
 * side only reads it, cuts it to the range asked, and keeps the last copy it got so that a dropped
 * connection shows the last known charts rather than nothing.
 */
export function createRemoteHistory(deps: RemoteHistoryDeps): RemoteHistory {
  const now = deps.now ?? Date.now
  let cache: { data: HistoryData; at: number } | null = null
  let inflight: Promise<HistoryData> | null = null

  async function read(): Promise<HistoryData> {
    const result = await deps.run(HISTORY_COMMAND)
    // A missing file (agent not installed yet) and a timeout both end up here.
    if (result.code !== 0) throw new Error('history not readable')
    // Checked before JSON.parse: the string is already in memory, but it is not parsed into objects.
    if (result.stdout.length > MAX_HISTORY_BYTES) throw new Error('history too big')
    return parseHistory(JSON.parse(result.stdout) as unknown)
  }

  function load(): Promise<HistoryData> {
    if (cache && now() - cache.at < HISTORY_CACHE_MS) return Promise.resolve(cache.data)
    inflight ??= read()
      .then((data) => {
        cache = { data, at: now() }
        return data
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  return {
    async query(range) {
      if (!isHistoryRange(range)) return null
      let data: HistoryData
      try {
        data = await load()
      } catch {
        // Never the underlying message: it may carry an address or a path.
        if (!cache) throw new HistoryUnavailableError()
        data = cache.data
      }
      const at = now()
      return {
        range,
        points: queryPoints(data.points, range, at),
        incidents: incidentsInRange(data.incidents, range, at),
        now: at
      }
    }
  }
}
