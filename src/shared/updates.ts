// Update state shared by main, preload and renderer.

export type UpdatePhase =
  | 'unavailable' // development build: updates only exist in the installed app
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'downloading'
  | 'ready'
  | 'error'

export interface UpdateState {
  phase: UpdatePhase
  currentVersion: string
  /** Version being downloaded or ready to install. */
  version: string | null
  /** Download progress, 0 to 100, while downloading. */
  percent: number | null
  /** User-facing (French) explanation when `phase` is `error`. */
  error: string | null
  checkedAt: number | null
}
