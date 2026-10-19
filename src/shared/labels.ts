// Friendly names for containers, compose projects and web ports. They come from the settings
// (nothing about a particular server lives in the code). Display only: the container name stays
// the identifier everywhere else.

import type { Settings } from './settings'

export type LabelSettings = Pick<Settings, 'containerLabels' | 'stackLabels' | 'portLabels'>

// Own properties only: a container named `constructor` must not find Object.prototype's.
const own = <V>(table: Readonly<Record<string, V>>, key: string): V | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined

export const containerLabel = (
  name: string,
  labels: Pick<LabelSettings, 'containerLabels'>
): string => own(labels.containerLabels, name) ?? name

/** Friendly name of a compose project; unknown projects are shown capitalised. */
export function stackLabel(project: string, labels: Pick<LabelSettings, 'stackLabels'>): string {
  return own(labels.stackLabels, project) ?? project.charAt(0).toUpperCase() + project.slice(1)
}

export const webPortLabel = (
  hostPort: number,
  labels: Pick<LabelSettings, 'portLabels'>
): string | null => own(labels.portLabels, String(hostPort)) ?? null
