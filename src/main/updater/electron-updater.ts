import { autoUpdater } from 'electron-updater'
import type { UpdaterLike } from './controller'

/**
 * Wiring only: adapts electron-updater's `autoUpdater` to the small interface the controller uses.
 * The feed (the public GitHub repository) comes from `app-update.yml`, written by electron-builder
 * from the `publish` section of electron-builder.yml.
 */
export function createElectronUpdater(): UpdaterLike {
  return {
    get autoDownload() {
      return autoUpdater.autoDownload
    },
    set autoDownload(value) {
      autoUpdater.autoDownload = value
    },
    get autoInstallOnAppQuit() {
      return autoUpdater.autoInstallOnAppQuit
    },
    set autoInstallOnAppQuit(value) {
      autoUpdater.autoInstallOnAppQuit = value
    },
    checkForUpdates: () => autoUpdater.checkForUpdates(),
    // Silent install, then relaunch the app.
    quitAndInstall: () => autoUpdater.quitAndInstall(true, true),
    on: (event, listener) => {
      autoUpdater.on(event as 'error', listener as never)
    }
  }
}
