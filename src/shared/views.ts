// The screens of the window, shared so that main can ask the renderer to show one (tray menu).

export const APP_VIEWS = ['dashboard', 'history', 'logs', 'settings'] as const

export type AppView = (typeof APP_VIEWS)[number]

export function isAppView(value: unknown): value is AppView {
  return typeof value === 'string' && (APP_VIEWS as readonly string[]).includes(value)
}
