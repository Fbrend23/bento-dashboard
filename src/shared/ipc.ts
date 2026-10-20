// Single source of truth for the IPC contract shared by main, preload and renderer.

import type { ContainerAction, ContainerActionResult, OpenPortResult } from './actions'
import type { HistoryRange, HistoryResult } from './history'
import type { ExportLogsResult, LogSourceId, LogsResult } from './logs'
import type { BentoStatus } from './monitors'
import type { UpdateState } from './updates'
import type { AppView } from './views'
import type { ConnectionTestResult } from './connection-test'
import type { SaveSettingsResult, Settings } from './settings'

export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  getStatus: 'status:get',
  refresh: 'status:refresh',
  /** Pushed from main to the renderer each time the status changes. */
  statusChanged: 'status:changed',
  /** Pushed from main when the window must show another screen (tray menu). */
  navigate: 'ui:navigate',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  testConnection: 'settings:test-connection',
  getLogs: 'logs:get',
  getHistory: 'history:get',
  exportLogs: 'logs:export',
  containerAction: 'action:container',
  forgetContainer: 'action:forget-container',
  openContainerPort: 'action:open-container-port',
  getUpdateState: 'update:get',
  checkUpdate: 'update:check',
  downloadUpdate: 'update:download',
  installUpdate: 'update:install',
  /** Pushed from main to the renderer each time the update state changes. */
  updateChanged: 'update:changed'
} as const

export interface AppInfo {
  name: string
  version: string
}

/** The only surface exposed to the renderer as `window.bento`. */
export interface BentoApi {
  getAppInfo(): Promise<AppInfo>
  getStatus(): Promise<BentoStatus>
  refresh(): Promise<void>
  /** Returns the function that stops the subscription. */
  onStatus(listener: (status: BentoStatus) => void): () => void
  /** Main asks the window to show a screen. Returns the function that stops the subscription. */
  onNavigate(listener: (view: AppView) => void): () => void
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<SaveSettingsResult>
  /**
   * Tries the settings as typed (not saved): main validates them, connects with the agent key and
   * runs one fixed no-op command. Nothing the renderer sends becomes a command.
   */
  testConnection(settings: Settings): Promise<ConnectionTestResult>
  /**
   * The history of the metrics and incidents over one fixed range, or null when there is none
   * (an unknown range, or no history yet).
   */
  getHistory(range: HistoryRange): Promise<HistoryResult | null>
  /** Last 200 lines of one fixed log source; the id is looked up in a fixed table by main. */
  getLogs(source: LogSourceId): Promise<LogsResult>
  /**
   * Asks main to save the last lines it read for this source; main shows the save dialog and
   * writes its own copy. No path and no content ever come from the renderer.
   */
  exportLogs(source: LogSourceId): Promise<ExportLogsResult>
  /** Asks main to restart Jellyfin. No argument; the confirmation box is shown by main. */
  /**
   * Starts, stops or restarts one container. Only the verb and the container name are sent: main
   * validates both, shows the native confirmation for stop and restart, and builds the command.
   */
  containerAction(action: ContainerAction, container: string): Promise<ContainerActionResult>
  /** "Ignore this stop": a stopped container stops alerting until it runs again. */
  forgetContainer(name: string): Promise<void>
  /**
   * Opens a port published by a container in the browser. Only the container name and port are
   * sent: main checks them against the last poll and builds the URL itself from the settings.
   */
  openContainerPort(container: string, hostPort: number): Promise<OpenPortResult>
  getUpdateState(): Promise<UpdateState>
  /** Returns the function that stops the subscription. */
  onUpdate(listener: (state: UpdateState) => void): () => void
  checkForUpdate(): Promise<void>
  /** Downloads the offered version (the user's consent); a no-op unless one is available. */
  downloadUpdate(): Promise<void>
  /** Restarts on the downloaded version; a no-op unless one is ready. */
  installUpdate(): Promise<void>
}
