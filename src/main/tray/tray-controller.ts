import {
  Menu,
  nativeImage,
  Tray,
  type MenuItemConstructorOptions,
  type NativeImage
} from 'electron'
import type { BentoStatus } from '@shared/monitors'
import { buildVerdict, type Tone } from '@shared/verdict'
import { renderTrayIcon, rgbaToBgra } from './icon'
import { buildTrayMenu, buildTrayTooltip, type TrayMenuItem } from './menu'

export interface TrayActions {
  open(): void
  logs(): void
  refresh(): void
  /** The name comes from the menu built out of the status: main re-validates it anyway. */
  restartContainer(container: string): void
  quit(): void
}

export interface TrayController {
  update(status: BentoStatus): void
  destroy(): void
}

const iconCache = new Map<Tone, NativeImage>()

function iconFor(tone: Tone): NativeImage {
  let icon = iconCache.get(tone)
  if (!icon) {
    const bitmap = renderTrayIcon(tone)
    // The bitmap is 32 px drawn for a 16 px slot at 200 % scaling, so it stays sharp.
    icon = nativeImage.createFromBitmap(rgbaToBgra(bitmap.data), {
      width: bitmap.width,
      height: bitmap.height,
      scaleFactor: 2
    })
    iconCache.set(tone, icon)
  }
  return icon
}

/** Wiring only: the content of the icon, tooltip and menu comes from the tested builders. */
export function createTray(initial: BentoStatus, actions: TrayActions): TrayController {
  const tray = new Tray(iconFor(buildVerdict(initial).tone))
  tray.on('click', actions.open)

  const toMenuItem = (item: TrayMenuItem): MenuItemConstructorOptions => {
    if (item.type === 'separator') return { type: 'separator' }
    if (item.submenu) {
      return { label: item.label, enabled: item.enabled, submenu: item.submenu.map(toMenuItem) }
    }
    const container = item.container
    return {
      label: item.label,
      enabled: item.enabled,
      click: container
        ? () => actions.restartContainer(container)
        : item.id
          ? actions[item.id]
          : undefined
    }
  }

  const update = (status: BentoStatus): void => {
    tray.setImage(iconFor(buildVerdict(status).tone))
    tray.setToolTip(buildTrayTooltip(status))
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(status).map(toMenuItem)))
  }

  update(initial)
  return { update, destroy: () => tray.destroy() }
}
