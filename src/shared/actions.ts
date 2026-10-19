// Write actions on containers, shared by main, preload and renderer.

import type { ServiceStatus } from './monitors'

/** The only verbs: bento-docker-action on the server refuses anything else. */
export const CONTAINER_ACTIONS = ['start', 'stop', 'restart'] as const

export type ContainerAction = (typeof CONTAINER_ACTIONS)[number]

export function isContainerAction(value: unknown): value is ContainerAction {
  return typeof value === 'string' && (CONTAINER_ACTIONS as readonly string[]).includes(value)
}

/**
 * The shape of a container name. The same pattern is enforced by scripts/bento-docker-action.sh on
 * bento (a test keeps them identical): no leading dash, no space, nothing a shell would interpret.
 */
export const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/

export function isContainerName(value: unknown): value is string {
  return typeof value === 'string' && CONTAINER_NAME.test(value)
}

/** Interrupting a service asks for a native confirmation; starting one does not. */
export const needsConfirmation = (action: ContainerAction): boolean => action !== 'start'

const LABELS: Record<ContainerAction, [idle: string, busy: string]> = {
  start: ['Démarrer', 'Démarrage…'],
  stop: ['Arrêter', 'Arrêt…'],
  restart: ['Redémarrer', 'Redémarrage…']
}

export const actionLabel = (action: ContainerAction): string => LABELS[action][0]
export const actionBusyLabel = (action: ContainerAction): string => LABELS[action][1]

/**
 * What can be done to a service right now, from the raw docker state (not the level: a crash-looping
 * container is "down" for the alerts, yet it is the one that most needs a stop).
 * A paused container gets nothing: docker refuses `start` on it, and stop/restart there is not
 * verified.
 */
export function availableActions(service: ServiceStatus): ContainerAction[] {
  if (service.kind !== 'container') return []
  switch (service.state) {
    case 'running':
    case 'restarting':
      return ['restart', 'stop']
    case 'exited':
    case 'created':
      return ['start']
    default:
      return []
  }
}

export type ContainerActionResult =
  { ok: true } | { ok: false; cancelled: true } | { ok: false; error: string }

/** Result of opening a container's published port in the browser. */
export type OpenPortResult = { ok: true } | { ok: false; error: string }
