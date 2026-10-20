import type { SaveSettingsResult, Settings } from '@shared/settings'
import type { BentoStatus } from '@shared/monitors'
import {
  logSourceFileName,
  type LogSourceId,
  parseLogSource,
  type ExportLogsResult,
  type LogsResult
} from '@shared/logs'
import type { ContainerAction, ContainerActionResult, OpenPortResult } from '@shared/actions'
import { containerLabel } from '@shared/labels'
import type { ConnectionTestResult } from '@shared/connection-test'
import type { HistoryResult } from '@shared/history'
import { runContainerAction } from './actions/container-action'
import { buildServiceUrl } from './links'
import { describeExecError, isSudoersRefusal, toLogsResult } from './monitors/logs'
import { StatusPoller } from './monitors/poller'
import { createRemoteHistory, type RemoteHistory } from './history/remote'
import type { RunningMemory } from './monitors/running-memory'
import { toSshConfig } from './settings/ssh-config'
import { SettingsValidationError, type SettingsStore } from './settings/store'
import { isConfigured } from './settings/validate'
import { logCommand } from './ssh/commands'
import { ConnectionManager, type Connector } from './ssh/connection'
import { testConnection } from './ssh/test-connection'
import type { SshConfig } from './ssh/ssh2-connector'

export interface ServiceDeps {
  store: SettingsStore
  createConnector: (config: SshConfig) => Connector
  /** Called with the settings loaded at startup and after each successful save. */
  onSettings?: (settings: Settings) => void
  /**
   * Native confirmation box for stopping or restarting, given the friendly name of the container.
   * Without it, such an action is always declined.
   */
  confirmAction?: (action: ContainerAction, label: string) => Promise<boolean>
  /**
   * Shows the save dialog for a log file and writes `text` there. Resolves false when the user
   * cancels. Without it, an export is always cancelled.
   */
  saveLogsFile?: (defaultName: string, text: string) => Promise<boolean>
  /** Holds back the "service down" notification of one service for a while. */
  quietNotifications?: (serviceId: string, durationMs: number) => void
  /** Which containers were seen running (persisted by the app); in memory only when absent. */
  runningMemory?: RunningMemory
  /** Opens a URL in the default browser. Without it, opening a port is always declined. */
  openExternal?: (url: string) => Promise<void>
}

/** Used only until the settings are complete; never actually called. */
const notConfigured: Connector = () => Promise.reject(new Error('Not configured'))

function sameConnection(a: Settings, b: Settings): boolean {
  return (
    a.host === b.host &&
    a.port === b.port &&
    a.username === b.username &&
    a.hostFingerprint === b.hostFingerprint
  )
}

/** Owns the connection, the polling loop and the settings for the whole app. */
export class BentoService {
  private readonly manager: ConnectionManager
  private readonly poller: StatusPoller
  /** The history kept by the agent on bento: this app only reads it. */
  private readonly history: RemoteHistory
  private testing = false
  /** Last successful read per source: what an export writes. */
  private readonly lastLogs = new Map<string, string>()

  constructor(
    private readonly deps: ServiceDeps,
    private settings: Settings
  ) {
    this.manager = new ConnectionManager(
      isConfigured(settings) ? deps.createConnector(toSshConfig(settings)) : notConfigured
    )
    this.poller = new StatusPoller({
      connection: this.manager,
      getSettings: () => this.settings,
      runningMemory: deps.runningMemory
    })
    this.history = createRemoteHistory({ run: (command) => this.manager.run(command) })
    this.poller.start()
    if (isConfigured(settings)) this.manager.start()
    deps.onSettings?.(structuredClone(settings))
  }

  get status(): BentoStatus {
    return this.poller.status
  }

  onStatus(listener: (status: BentoStatus) => void): () => void {
    return this.poller.onStatus(listener)
  }

  refresh(): Promise<void> {
    return this.poller.refresh()
  }

  /**
   * `source` is untrusted (it comes from the renderer). Tailscale is always readable; a container
   * only if the settings chose it for its logs AND the last poll listed it, so the name that
   * reaches a command is one this app has seen on bento. Bento still has the last word: each
   * container needs its own exact sudoers rule.
   */
  async getLogs(source: unknown): Promise<LogsResult> {
    const parsed = parseLogSource(source)
    if (!parsed || !this.canReadLogs(parsed)) {
      return { ok: false, error: 'Source de journaux inconnue.' }
    }
    const command = logCommand(parsed)
    if (command === null) return { ok: false, error: 'Source de journaux inconnue.' }
    try {
      const output = await this.manager.run(command)
      if (parsed.kind === 'container' && isSudoersRefusal(output)) {
        return {
          ok: false,
          error: "Ce conteneur n'a pas de règle sudoers sur bento (voir le README)."
        }
      }
      const result = toLogsResult(output, Date.now())
      if (result.ok) this.lastLogs.set(source as string, result.lines.join('\n') + '\n')
      return result
    } catch (error) {
      return { ok: false, error: describeExecError(error, 'Lecture des journaux impossible.') }
    }
  }

  private canReadLogs(source: NonNullable<ReturnType<typeof parseLogSource>>): boolean {
    return (
      source.kind === 'tailscaled' ||
      (this.settings.logContainers.includes(source.name) &&
        // Offline there is no poll to compare with, and nothing can be sent anyway: let the
        // connection report "injoignable" instead of a misleading "unknown source".
        (this.poller.knowsContainer(source.name) || this.manager.state !== 'online'))
    )
  }

  /** `source` is untrusted: only a well-formed id selects the cached text and the file name. */
  async exportLogs(source: unknown): Promise<ExportLogsResult> {
    if (!parseLogSource(source)) return { ok: false, error: 'Source de journaux inconnue.' }
    const text = this.lastLogs.get(source as string)
    if (text === undefined) return { ok: false, error: "Aucun journal n'a encore été lu." }
    try {
      const saved =
        (await this.deps.saveLogsFile?.(logSourceFileName(source as LogSourceId), text)) ?? false
      return saved ? { ok: true } : { ok: false, cancelled: true }
    } catch {
      return { ok: false, error: "Impossible d'enregistrer le fichier." }
    }
  }

  /**
   * Starts, stops or restarts one container. Both values come from the renderer and are validated
   * by the action: a known action and a container listed by the last poll, nothing else.
   */
  containerAction(action: unknown, container: unknown): Promise<ContainerActionResult> {
    return runContainerAction(
      {
        isOnline: () => this.manager.state === 'online',
        knows: (name) => this.poller.knowsContainer(name),
        confirm: async (verb, name) =>
          (await this.deps.confirmAction?.(verb, containerLabel(name, this.settings))) ?? false,
        run: (command, options) => this.manager.run(command, options),
        refresh: () => this.poller.refresh(),
        quiet: (name, durationMs) => this.deps.quietNotifications?.(name, durationMs),
        forget: (name) => this.poller.forgetContainer(name)
      },
      action,
      container
    )
  }

  /** "Ignore this stop". `name` is untrusted: the poller only accepts a container it listed. */
  forgetContainer(name: unknown): void {
    if (typeof name === 'string') this.poller.forgetContainer(name)
  }

  /**
   * Opens a published port of a container in the browser. Both arguments are untrusted: they only
   * select a port the last poll listed as published, and the URL is built here from the host in
   * the settings, never from what the renderer sent.
   */
  async openContainerPort(container: unknown, hostPort: unknown): Promise<OpenPortResult> {
    if (typeof container !== 'string' || typeof hostPort !== 'number') {
      return { ok: false, error: 'Port inconnu.' }
    }
    const service = this.poller.status.services.find(
      (s) => s.kind === 'container' && s.id === container
    )
    const port = service?.ports.find((p) => p.hostPort === hostPort && p.linkable)
    if (!port) return { ok: false, error: "Ce port n'est pas publié par ce conteneur." }

    const url = buildServiceUrl(this.settings.host, port.hostPort)
    if (!url || !this.deps.openExternal) return { ok: false, error: "Impossible d'ouvrir ce lien." }
    try {
      await this.deps.openExternal(url)
      return { ok: true }
    } catch {
      return { ok: false, error: "Impossible d'ouvrir le navigateur." }
    }
  }

  /**
   * Tries a draft of the settings with a connection of its own: the running one is not touched and
   * nothing is saved. One test at a time.
   */
  async testConnection(draft: unknown): Promise<ConnectionTestResult> {
    if (this.testing) return { ok: false, message: 'Un test est déjà en cours.', technical: null }
    this.testing = true
    try {
      return await testConnection(draft, { createConnector: this.deps.createConnector })
    } finally {
      this.testing = false
    }
  }

  /**
   * `range` is untrusted: only the fixed ranges are answered, and null otherwise. Fails when bento
   * cannot be read and no earlier copy exists (the renderer shows that as a notice).
   */
  getHistory(range: unknown): Promise<HistoryResult | null> {
    return this.history.query(range)
  }

  getSettings(): Settings {
    return structuredClone(this.settings)
  }

  async saveSettings(input: unknown): Promise<SaveSettingsResult> {
    try {
      await this.deps.store.save(input as Settings)
    } catch (error) {
      if (error instanceof SettingsValidationError) return { ok: false, errors: error.errors }
      throw error
    }

    const previous = this.settings
    this.settings = await this.deps.store.load()

    if (!sameConnection(previous, this.settings)) {
      if (isConfigured(this.settings)) {
        this.manager.replaceConnector(this.deps.createConnector(toSshConfig(this.settings)))
        this.manager.start()
      } else {
        this.manager.stop()
      }
    }
    this.poller.reconfigure()
    this.deps.onSettings?.(this.getSettings())
    return { ok: true, settings: this.getSettings() }
  }

  dispose(): void {
    this.poller.stop()
    this.manager.stop()
  }
}

export async function createBentoService(deps: ServiceDeps): Promise<BentoService> {
  return new BentoService(deps, await deps.store.load())
}
