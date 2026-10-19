import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { buildBentoApi } from './api'

// Only the whitelisted functions of BentoApi are exposed; never ipcRenderer itself.
contextBridge.exposeInMainWorld(
  'bento',
  buildBentoApi(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (channel, handler) => {
      const wrapped = (_event: IpcRendererEvent, payload: unknown): void => handler(payload)
      ipcRenderer.on(channel, wrapped)
      return () => {
        ipcRenderer.removeListener(channel, wrapped)
      }
    }
  )
)
