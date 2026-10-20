import { app, BrowserWindow, ipcMain } from 'electron'
import { IPC_CHANNELS, type AppInfo } from '@shared/ipc'
import type { ConnectionTestResult } from '@shared/connection-test'
import type { SaveSettingsResult, Settings } from '@shared/settings'
import type { BentoStatus } from '@shared/monitors'
import type { HistoryResult } from '@shared/history'
import type { ExportLogsResult, LogsResult } from '@shared/logs'
import type { ContainerActionResult, OpenPortResult } from '@shared/actions'
import type { UpdateState } from '@shared/updates'
import { isAllowedNavigation } from './security'

interface AppInfoSource {
  getName(): string
  getVersion(): string
}

export function getAppInfo(source: AppInfoSource): AppInfo {
  return { name: source.getName(), version: source.getVersion() }
}

interface IpcService {
  readonly status: BentoStatus
  refresh(): Promise<void>
  getSettings(): Settings
  saveSettings(input: unknown): Promise<SaveSettingsResult>
  /** Receives an untrusted draft and validates it itself. */
  testConnection(draft: unknown): Promise<ConnectionTestResult>
  /** Receives an untrusted value and validates it itself. */
  getLogs(source: unknown): Promise<LogsResult>
  /** Receives an untrusted value and validates it itself. */
  getHistory(range: unknown): Promise<HistoryResult | null>
  /** Receives an untrusted value and validates it itself. */
  exportLogs(source: unknown): Promise<ExportLogsResult>
  /** Receives untrusted values and validates them itself. */
  containerAction(action: unknown, container: unknown): Promise<ContainerActionResult>
  /** Receives an untrusted value and validates it itself. */
  forgetContainer(name: unknown): void
  /** Receives untrusted values and validates them itself. */
  openContainerPort(container: unknown, hostPort: unknown): Promise<OpenPortResult>
}

export interface IpcUpdates {
  readonly state: UpdateState
  check(): Promise<void>
  install(): void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- handlers return heterogeneous payloads
export type Handler = (arg?: unknown) => any

/** One handler per invokable channel; arguments from the renderer are untrusted. */
export function createHandlers(
  service: IpcService,
  appInfo: AppInfoSource,
  updates: IpcUpdates
): Record<string, Handler> {
  return {
    [IPC_CHANNELS.getAppInfo]: () => getAppInfo(appInfo),
    [IPC_CHANNELS.getStatus]: () => service.status,
    [IPC_CHANNELS.refresh]: () => service.refresh(),
    [IPC_CHANNELS.getSettings]: () => service.getSettings(),
    [IPC_CHANNELS.saveSettings]: (settings) => service.saveSettings(settings),
    [IPC_CHANNELS.testConnection]: (draft) => service.testConnection(draft),
    [IPC_CHANNELS.getLogs]: (source) => service.getLogs(source),
    [IPC_CHANNELS.getHistory]: (range) => service.getHistory(range),
    // Only the source id is forwarded: the path and the content are decided by main.
    [IPC_CHANNELS.exportLogs]: (source) => service.exportLogs(source),
    // Nothing from the renderer reaches the action: no argument is forwarded.
    [IPC_CHANNELS.containerAction]: (payload) => {
      const { action, container } = (
        typeof payload === 'object' && payload !== null ? payload : {}
      ) as { action?: unknown; container?: unknown }
      return service.containerAction(action, container)
    },
    [IPC_CHANNELS.forgetContainer]: (name) => service.forgetContainer(name),
    [IPC_CHANNELS.openContainerPort]: (payload) => {
      const { container, hostPort } = (
        typeof payload === 'object' && payload !== null ? payload : {}
      ) as { container?: unknown; hostPort?: unknown }
      return service.openContainerPort(container, hostPort)
    },
    [IPC_CHANNELS.getUpdateState]: () => updates.state,
    [IPC_CHANNELS.checkUpdate]: () => updates.check(),
    [IPC_CHANNELS.installUpdate]: () => updates.install()
  }
}

/** Wiring: registers the handlers (only for our own page) and pushes status changes. */
export function registerIpc(
  service: IpcService & { onStatus: (l: (s: BentoStatus) => void) => () => void },
  updates: IpcUpdates & { onState: (l: (s: UpdateState) => void) => () => void },
  getAppUrl: () => string
): void {
  for (const [channel, handler] of Object.entries(createHandlers(service, app, updates))) {
    ipcMain.handle(channel, (event, arg: unknown) => {
      if (!isAllowedNavigation(event.senderFrame?.url ?? '', getAppUrl())) {
        throw new Error('Untrusted IPC sender')
      }
      return handler(arg)
    })
  }
  service.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.statusChanged, status)
    }
  })
  updates.onState((state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.updateChanged, state)
    }
  })
}
