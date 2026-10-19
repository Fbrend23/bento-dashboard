import type { UpdatePhase, UpdateState } from '@shared/updates'

/** The subset of electron-updater's `autoUpdater` that we use (also what the tests fake). */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
  on(event: string, listener: (...args: unknown[]) => void): void
}

export interface UpdateControllerDeps {
  updater: UpdaterLike
  /** Updates only exist in the installed app, not in `npm run dev`. */
  isPackaged: boolean
  currentVersion: string
  now?: () => number
}

export const FIRST_CHECK_DELAY_MS = 15_000
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

type StateListener = (state: UpdateState) => void

/** Fixed French messages only: the raw error (which could echo a header) is never shown. */
function describeUpdateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/\b(401|403|429)\b|unauthori[sz]ed|forbidden|rate limit/i.test(message)) {
    return 'GitHub refuse la vérification pour le moment. Réessayez plus tard.'
  }
  if (/\b404\b|not found/i.test(message)) {
    return 'Aucune version trouvée sur GitHub.'
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET|ERR_NETWORK|ERR_CONNECTION|ERR_NAME|timed out/i.test(
      message
    )
  ) {
    return 'GitHub est injoignable pour le moment.'
  }
  return 'La vérification des mises à jour a échoué.'
}

/**
 * Checks GitHub Releases for a new version, downloads it quietly and leaves the installation to
 * the user (or to the next quit). A failing check is a normal state: it is reported, never retried
 * in a loop.
 */
export class UpdateController {
  private current: UpdateState
  private inflight: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly listeners = new Set<StateListener>()
  private readonly now: () => number

  constructor(private readonly deps: UpdateControllerDeps) {
    this.now = deps.now ?? Date.now
    this.current = {
      phase: deps.isPackaged ? 'idle' : 'unavailable',
      currentVersion: deps.currentVersion,
      version: null,
      percent: null,
      error: null,
      checkedAt: null
    }

    const { updater } = deps
    // Download in the background; installing is the user's choice (button) or happens on quit.
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.on('update-available', (info) =>
      this.set({
        phase: 'downloading',
        version: (info as { version: string }).version,
        percent: 0,
        error: null
      })
    )
    updater.on('download-progress', (progress) =>
      this.set({
        phase: 'downloading',
        percent: Math.round((progress as { percent: number }).percent)
      })
    )
    updater.on('update-downloaded', (info) =>
      this.set({
        phase: 'ready',
        version: (info as { version: string }).version,
        percent: null,
        error: null
      })
    )
    updater.on('update-not-available', () =>
      this.set({ phase: 'up-to-date', checkedAt: this.now(), error: null })
    )
    updater.on('error', (error) => this.fail(error))
  }

  get state(): UpdateState {
    return { ...this.current }
  }

  onState(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** First check shortly after startup, then every few hours. */
  start(): void {
    if (!this.deps.isPackaged || this.timer) return
    this.timer = setTimeout(() => {
      void this.check()
      this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
    }, FIRST_CHECK_DELAY_MS)
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      clearInterval(this.timer)
    }
    this.timer = null
  }

  check(): Promise<void> {
    if (this.inflight) return this.inflight
    const run = this.runCheck().finally(() => {
      if (this.inflight === run) this.inflight = null
    })
    this.inflight = run
    return run
  }

  /** Restarts the app on the downloaded version. Only possible once the download is complete. */
  install(): void {
    if (this.current.phase === 'ready') this.deps.updater.quitAndInstall()
  }

  private async runCheck(): Promise<void> {
    if (!this.deps.isPackaged) {
      this.set({ phase: 'unavailable' })
      return
    }
    const { phase } = this.current
    if (phase === 'ready' || phase === 'downloading') return

    this.set({ phase: 'checking', error: null })
    try {
      await this.deps.updater.checkForUpdates()
      // The updater reports its outcome through events; never leave a spinner behind.
      if (this.current.phase === 'checking') this.set({ phase: 'idle', checkedAt: this.now() })
    } catch (error) {
      this.fail(error)
    }
  }

  private fail(error: unknown): void {
    this.set({
      phase: 'error',
      error: describeUpdateError(error),
      percent: null,
      checkedAt: this.now()
    })
  }

  private set(patch: Partial<UpdateState> & { phase?: UpdatePhase }): void {
    this.current = { ...this.current, ...patch }
    const snapshot = this.state
    for (const listener of this.listeners) listener(snapshot)
  }
}
