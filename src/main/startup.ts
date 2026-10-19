/** Flag added to the login item so the app starts in the tray instead of opening a window. */
export const HIDDEN_ARG = '--hidden'

/**
 * Options for `app.setLoginItemSettings`. A development run is never registered: it would make
 * Windows start a bare electron.exe at login.
 */
export function loginItemOptions(
  enabled: boolean,
  isPackaged: boolean
): { openAtLogin: boolean; args: string[] } {
  return { openAtLogin: enabled && isPackaged, args: [HIDDEN_ARG] }
}

export function shouldStartHidden(argv: readonly string[], wasOpenedAtLogin: boolean): boolean {
  return wasOpenedAtLogin || argv.includes(HIDDEN_ARG)
}
