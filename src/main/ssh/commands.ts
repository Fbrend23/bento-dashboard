import {
  CONTAINER_NAME,
  isContainerAction,
  isContainerName,
  type ContainerAction
} from '@shared/actions'
import type { ParsedLogSource } from '@shared/logs'
import { SNAPSHOT_COMMAND } from '../monitors/snapshot'

// Every command ever sent to bento lives here. The fixed ones are exact strings; the container
// actions and the container logs are the two families built from a name. A name is validated
// several times (settings, service, builder below, allow-list pattern) and bento has the last
// word: a container action goes through a validating script, a container's logs need that
// container's own exact sudoers rule.

/** Remote limit of an action, so a stuck docker cannot hold the connection forever. */
export const CONTAINER_ACTION_TIMEOUT_S = 90

/**
 * Installed on bento by the README (root:root 0755) and allowed to bento-dash by one sudoers line
 * per action. It validates the action and the container name, then runs the docker command.
 */
export const CONTAINER_ACTION_SCRIPT = '/usr/local/bin/bento-docker-action'

/** `null` unless both the action and the name are well-formed. */
export function containerActionCommand(action: ContainerAction, name: string): string | null {
  if (!isContainerAction(action) || !isContainerName(name)) return null
  return `timeout ${CONTAINER_ACTION_TIMEOUT_S} sudo -n ${CONTAINER_ACTION_SCRIPT} ${action} ${name}`
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')

// One anchored pattern: exactly the output of containerActionCommand, nothing before or after.
const CONTAINER_ACTION_COMMAND = new RegExp(
  `^timeout ${CONTAINER_ACTION_TIMEOUT_S} sudo -n ${escapeRegExp(CONTAINER_ACTION_SCRIPT)} ` +
    `(?:start|stop|restart) ${CONTAINER_NAME.source.slice(1, -1)}$`
)

/** 200 last lines of the tailscaled journal (an exact sudoers rule on bento). */
export const TAILSCALED_LOG_COMMAND =
  'timeout 10 sudo -n journalctl -u tailscaled -n 200 --no-pager -o short-iso'

/** 200 last lines of a container; `2>&1` so docker's stderr (where most apps log) is captured. */
export function containerLogCommand(name: string): string | null {
  return isContainerName(name) ? `timeout 10 sudo -n docker logs --tail 200 ${name} 2>&1` : null
}

// One anchored pattern: exactly the output of containerLogCommand, nothing before or after.
const CONTAINER_LOG_COMMAND = new RegExp(
  `^timeout 10 sudo -n docker logs --tail 200 ${CONTAINER_NAME.source.slice(1, -1)} 2>&1$`
)

/** `null` when the source is a container with a malformed name. */
export function logCommand(source: ParsedLogSource): string | null {
  return source.kind === 'tailscaled' ? TAILSCALED_LOG_COMMAND : containerLogCommand(source.name)
}

/** "Tester la connexion": a no-op that only proves a command can run over the new settings. */
export const TEST_CONNECTION_COMMAND = 'true'

/** The fixed commands. Container actions and logs are matched by pattern, see `isAllowedCommand`. */
export const ALLOWED_COMMANDS: readonly string[] = Object.freeze([
  SNAPSHOT_COMMAND,
  TEST_CONNECTION_COMMAND,
  TAILSCALED_LOG_COMMAND
])

/** Allow-list enforced before anything is sent over SSH: exact match, or one of the two patterns. */
export function isAllowedCommand(command: string): boolean {
  return (
    typeof command === 'string' &&
    (ALLOWED_COMMANDS.includes(command) ||
      CONTAINER_ACTION_COMMAND.test(command) ||
      CONTAINER_LOG_COMMAND.test(command))
  )
}
