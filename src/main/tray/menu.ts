import { availableActions } from '@shared/actions'
import type { BentoStatus } from '@shared/monitors'
import { buildVerdict } from '@shared/verdict'

export interface TrayMenuItem {
  type?: 'separator'
  id?: 'open' | 'logs' | 'refresh' | 'quit'
  label?: string
  enabled?: boolean
  /** Entries of a submenu; set only on the "restart a container" item. */
  submenu?: TrayMenuItem[]
  /** Set on a submenu entry: the container to restart (a name the status listed). */
  container?: string
}

const MAX_DETAIL_LINES = 5
/** A tray submenu this long is already unwieldy; the rest is reachable from the window. */
const MAX_RESTART_ENTRIES = 20
/** Windows truncates tray tooltips at 127 characters. */
const MAX_TOOLTIP_LENGTH = 127

/** "Redémarrer un conteneur": the running (or crash-looping) containers, never anything else. */
function restartEntry(status: BentoStatus): TrayMenuItem | null {
  const restartable = status.services
    .filter((s) => availableActions(s).includes('restart'))
    .sort((a, b) => a.label.localeCompare(b.label))
  if (restartable.length === 0) return null

  const entries: TrayMenuItem[] = restartable
    .slice(0, MAX_RESTART_ENTRIES)
    .map((s) => ({ label: s.label, container: s.id }))
  const hidden = restartable.length - entries.length
  if (hidden > 0) entries.push({ label: `et ${hidden} autres…`, enabled: false })
  return {
    label: 'Redémarrer un conteneur',
    enabled: status.connection === 'online',
    submenu: entries
  }
}

export function buildTrayMenu(status: BentoStatus): TrayMenuItem[] {
  const verdict = buildVerdict(status)
  const shown = verdict.details.slice(0, MAX_DETAIL_LINES)
  const hidden = verdict.details.length - shown.length
  const restart = restartEntry(status)

  return [
    { label: verdict.title, enabled: false },
    ...shown.map((label) => ({ label, enabled: false })),
    ...(hidden > 0 ? [{ label: `et ${hidden} autres…`, enabled: false }] : []),
    { type: 'separator' },
    { id: 'open', label: 'Ouvrir Bento' },
    { id: 'logs', label: 'Journaux' },
    { id: 'refresh', label: 'Actualiser', enabled: status.connection === 'online' },
    ...(restart ? [restart] : []),
    { type: 'separator' },
    { id: 'quit', label: 'Quitter' }
  ]
}

export function buildTrayTooltip(status: BentoStatus | null): string {
  if (!status) return 'Bento'
  const verdict = buildVerdict(status)
  const text = [verdict.title, verdict.details[0]].filter(Boolean).join(' ')
  return text.length <= MAX_TOOLTIP_LENGTH ? text : `${text.slice(0, MAX_TOOLTIP_LENGTH - 1)}…`
}
