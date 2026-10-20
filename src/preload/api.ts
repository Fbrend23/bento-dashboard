import { IPC_CHANNELS, type BentoApi } from '@shared/ipc'
import type { BentoStatus } from '@shared/monitors'
import type { UpdateState } from '@shared/updates'
import { isAppView } from '@shared/views'

type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>
type Subscribe = (channel: string, handler: (payload: unknown) => void) => () => void

export function buildBentoApi(invoke: Invoke, subscribe: Subscribe): BentoApi {
  return {
    getAppInfo: () => invoke(IPC_CHANNELS.getAppInfo) as ReturnType<BentoApi['getAppInfo']>,
    getStatus: () => invoke(IPC_CHANNELS.getStatus) as ReturnType<BentoApi['getStatus']>,
    refresh: () => invoke(IPC_CHANNELS.refresh) as ReturnType<BentoApi['refresh']>,
    onStatus: (listener) =>
      subscribe(IPC_CHANNELS.statusChanged, (payload) => listener(payload as BentoStatus)),
    onNavigate: (listener) =>
      subscribe(IPC_CHANNELS.navigate, (payload) => {
        if (isAppView(payload)) listener(payload)
      }),
    getSettings: () => invoke(IPC_CHANNELS.getSettings) as ReturnType<BentoApi['getSettings']>,
    saveSettings: (settings) =>
      invoke(IPC_CHANNELS.saveSettings, settings) as ReturnType<BentoApi['saveSettings']>,
    testConnection: (settings) =>
      invoke(IPC_CHANNELS.testConnection, settings) as ReturnType<BentoApi['testConnection']>,
    getHistory: (range) =>
      invoke(IPC_CHANNELS.getHistory, range) as ReturnType<BentoApi['getHistory']>,
    getLogs: (source) => invoke(IPC_CHANNELS.getLogs, source) as ReturnType<BentoApi['getLogs']>,
    exportLogs: (source) =>
      invoke(IPC_CHANNELS.exportLogs, source) as ReturnType<BentoApi['exportLogs']>,
    containerAction: (action, container) =>
      invoke(IPC_CHANNELS.containerAction, { action, container }) as ReturnType<
        BentoApi['containerAction']
      >,
    forgetContainer: (name) =>
      invoke(IPC_CHANNELS.forgetContainer, name) as ReturnType<BentoApi['forgetContainer']>,
    openContainerPort: (container, hostPort) =>
      invoke(IPC_CHANNELS.openContainerPort, { container, hostPort }) as ReturnType<
        BentoApi['openContainerPort']
      >,
    getUpdateState: () =>
      invoke(IPC_CHANNELS.getUpdateState) as ReturnType<BentoApi['getUpdateState']>,
    onUpdate: (listener) =>
      subscribe(IPC_CHANNELS.updateChanged, (payload) => listener(payload as UpdateState)),
    checkForUpdate: () =>
      invoke(IPC_CHANNELS.checkUpdate) as ReturnType<BentoApi['checkForUpdate']>,
    downloadUpdate: () =>
      invoke(IPC_CHANNELS.downloadUpdate) as ReturnType<BentoApi['downloadUpdate']>,
    installUpdate: () => invoke(IPC_CHANNELS.installUpdate) as ReturnType<BentoApi['installUpdate']>
  }
}
