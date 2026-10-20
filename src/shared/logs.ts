// Log sources shared by main, preload and renderer. A source id is either `tailscaled` (the
// systemd journal) or `container:<name>`. The renderer only ever sends such an id, never a command;
// main checks the name against the settings and the last poll before anything is sent to bento.

import { isContainerName } from './actions'
import { containerLabel, stackLabel, type LabelSettings } from './labels'
import type { ServiceLevel, ServiceStatus } from './monitors'
import type { Settings } from './settings'

export const TAILSCALED_SOURCE = 'tailscaled'

const CONTAINER_PREFIX = 'container:'

export type LogSourceId = typeof TAILSCALED_SOURCE | `${typeof CONTAINER_PREFIX}${string}`

export type ParsedLogSource = { kind: 'tailscaled' } | { kind: 'container'; name: string }

export interface LogSource {
  id: LogSourceId
  label: string
}

export const containerSource = (name: string): LogSourceId => `${CONTAINER_PREFIX}${name}`

/** `null` unless `value` is exactly `tailscaled` or `container:<well-formed name>`. */
export function parseLogSource(value: unknown): ParsedLogSource | null {
  if (typeof value !== 'string') return null
  if (value === TAILSCALED_SOURCE) return { kind: 'tailscaled' }
  if (!value.startsWith(CONTAINER_PREFIX)) return null
  const name = value.slice(CONTAINER_PREFIX.length)
  return isContainerName(name) ? { kind: 'container', name } : null
}

/** Default name of the file an export proposes; free of characters Windows refuses. */
export function logSourceFileName(source: LogSourceId): string {
  const parsed = parseLogSource(source)
  return `${parsed?.kind === 'container' ? parsed.name : TAILSCALED_SOURCE}.log`
}

/** What the logs screen offers: the containers chosen in the settings, then Tailscale. */
export function logSources(
  settings: Pick<Settings, 'logContainers' | 'containerLabels'>
): LogSource[] {
  return [
    ...settings.logContainers.map((name) => ({
      id: containerSource(name),
      label: containerLabel(name, settings)
    })),
    { id: TAILSCALED_SOURCE, label: 'Tailscale' }
  ]
}

export interface LogSourceItem extends LogSource {
  /** State of the container (or of tailscaled) at the last poll; null when it is not in it. */
  level: ServiceLevel | null
}

export interface LogSourceGroup {
  key: string
  /** Name of the stack; null for the containers outside any stack and for Tailscale. */
  label: string | null
  sources: LogSourceItem[]
}

/**
 * The sources of the logs screen grouped for a side list: one group per compose project (sorted by
 * label), then the containers outside any stack, then Tailscale alone. Without a poll (bento
 * unreachable) every container lands outside a stack, with no level.
 */
export function groupLogSources(
  sources: LogSource[],
  services: readonly ServiceStatus[],
  labels: Pick<LabelSettings, 'stackLabels'>
): LogSourceGroup[] {
  const byId = new Map(services.map((service) => [service.id, service]))
  const stacks = new Map<string, LogSourceItem[]>()
  const loose: LogSourceItem[] = []
  let tailscale: LogSourceItem | null = null

  for (const source of sources) {
    const parsed = parseLogSource(source.id)
    const service = byId.get(parsed?.kind === 'container' ? parsed.name : TAILSCALED_SOURCE)
    const item: LogSourceItem = { ...source, level: service?.level ?? null }
    if (parsed?.kind === 'tailscaled') tailscale = item
    else if (service?.project)
      stacks.set(service.project, [...(stacks.get(service.project) ?? []), item])
    else loose.push(item)
  }

  const groups: LogSourceGroup[] = [...stacks]
    .map(([project, items]) => ({
      key: `stack:${project}`,
      label: stackLabel(project, labels),
      sources: items
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  if (loose.length > 0) groups.push({ key: 'loose', label: null, sources: loose })
  if (tailscale) groups.push({ key: TAILSCALED_SOURCE, label: null, sources: [tailscale] })
  return groups
}

/** Outcome of saving the last lines read to a file; a cancelled dialog is a normal answer. */
export type ExportLogsResult =
  { ok: true } | { ok: false; cancelled: true } | { ok: false; cancelled?: false; error: string }

export type LogsResult =
  { ok: true; lines: string[]; fetchedAt: number } | { ok: false; error: string }
