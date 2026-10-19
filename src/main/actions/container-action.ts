import {
  isContainerAction,
  isContainerName,
  needsConfirmation,
  type ContainerAction,
  type ContainerActionResult
} from '@shared/actions'
import { describeCommandFailure, describeExecError } from '../monitors/logs'
import { containerActionCommand } from '../ssh/commands'
import type { ExecOptions, ExecResult } from '../ssh/connection'

/** Above the remote `timeout 90`, so the remote side answers (code 124) before we give up. */
export const ACTION_EXEC_TIMEOUT_MS = 100_000

/** How long a "service down" notification is held back after our own stop or restart. */
export const ACTION_QUIET_MS = 180_000

export interface ContainerActionDeps {
  isOnline(): boolean
  /** True only for a container listed by the last readable poll. */
  knows(container: string): boolean
  /** Native confirmation box, shown by the main process; the renderer cannot answer it. */
  confirm(action: ContainerAction, container: string): Promise<boolean>
  run(command: string, options: ExecOptions): Promise<ExecResult>
  refresh(): Promise<void>
  /** Holds back the "service down" notification of one container for this many ms. */
  quiet(container: string, durationMs: number): void
  /** The container was stopped on purpose: it must not alert as "was running, now down". */
  forget(container: string): void
}

const FALLBACK: Record<ContainerAction, string> = {
  start: 'Le démarrage a échoué.',
  stop: "L'arrêt a échoué.",
  restart: 'Le redémarrage a échoué.'
}

/** Exit codes of scripts/bento-docker-action.sh, then the generic command failures. */
export function describeActionFailure(result: ExecResult): string {
  switch (result.code) {
    case 64:
      return 'Action refusée par bento.'
    case 65:
      return 'Conteneur introuvable sur bento.'
    case 66:
      return 'Docker est indisponible sur bento.'
    default:
      return describeCommandFailure(result)
  }
}

// Module-level on purpose: one action at a time, from confirmation to end of command.
let inProgress = false

/**
 * Starts, stops or restarts one container, after a confirmation owned by the main process for
 * anything that interrupts a service. `action` and `container` come from the renderer: both are
 * validated here, and the container must be one the last poll listed.
 */
export async function runContainerAction(
  deps: ContainerActionDeps,
  action: unknown,
  container: unknown
): Promise<ContainerActionResult> {
  if (!isContainerAction(action)) return { ok: false, error: 'Action inconnue.' }
  if (!isContainerName(container) || !deps.knows(container)) {
    return { ok: false, error: 'Conteneur inconnu.' }
  }
  const command = containerActionCommand(action, container)
  if (!command) return { ok: false, error: 'Action inconnue.' }

  if (inProgress) return { ok: false, error: 'Une action est déjà en cours.' }
  if (!deps.isOnline()) return { ok: false, error: 'Bento est injoignable.' }

  inProgress = true
  try {
    if (needsConfirmation(action) && !(await deps.confirm(action, container))) {
      return { ok: false, cancelled: true }
    }

    // Before the command, so a poll landing mid-stop cannot raise a "down" notification.
    if (action !== 'start') deps.quiet(container, ACTION_QUIET_MS)
    try {
      const result = await deps.run(command, { timeoutMs: ACTION_EXEC_TIMEOUT_MS })
      if (result.code !== 0) return { ok: false, error: describeActionFailure(result) }
      if (action === 'stop') deps.forget(container)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: describeExecError(error, FALLBACK[action]) }
    } finally {
      await deps.refresh().catch(() => {})
    }
  } finally {
    inProgress = false
  }
}
