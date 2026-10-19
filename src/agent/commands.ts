import { SNAPSHOT_COMMAND } from '../main/monitors/snapshot'
import { isAllowedCommand, isContainerActionCommand } from '../main/ssh/commands'

/**
 * What the agent may run on bento: the snapshot and the three container verbs, nothing else.
 * Narrower than the desktop allow-list on purpose (no logs, no connection test), and it still
 * has to pass `isAllowedCommand` too, so the two lists can never drift apart.
 */
export function isAgentCommand(command: string): boolean {
  return (
    typeof command === 'string' &&
    isAllowedCommand(command) &&
    (command === SNAPSHOT_COMMAND || isContainerActionCommand(command))
  )
}
