import { describe, expect, it } from 'vitest'
import { SNAPSHOT_COMMAND } from '../src/main/monitors/snapshot'
import {
  containerActionCommand,
  containerLogCommand,
  TAILSCALED_LOG_COMMAND,
  TEST_CONNECTION_COMMAND
} from '../src/main/ssh/commands'
import { isAgentCommand } from '../src/agent/commands'

describe('isAgentCommand', () => {
  it('allows the snapshot and the three container verbs, exactly', () => {
    expect(isAgentCommand(SNAPSHOT_COMMAND)).toBe(true)
    for (const action of ['start', 'stop', 'restart'] as const) {
      expect(isAgentCommand(containerActionCommand(action, 'jellyfin')!)).toBe(true)
    }
  })

  it('refuses logs, the connection test and anything else the desktop app may run', () => {
    expect(isAgentCommand(TAILSCALED_LOG_COMMAND)).toBe(false)
    expect(isAgentCommand(TEST_CONNECTION_COMMAND)).toBe(false)
    expect(isAgentCommand(containerLogCommand('jellyfin')!)).toBe(false)
  })

  it('refuses injections, variants and non-strings', () => {
    const restart = containerActionCommand('restart', 'jellyfin')!
    for (const command of [
      '',
      'reboot',
      `${SNAPSHOT_COMMAND}; reboot`,
      `${restart}; reboot`,
      `${restart} `,
      restart.replace('restart', 'rm'),
      restart.replace('jellyfin', 'jellyfin; reboot'),
      restart.replace('jellyfin', '-rf')
    ]) {
      expect(isAgentCommand(command)).toBe(false)
    }
    expect(isAgentCommand(undefined as unknown as string)).toBe(false)
  })
})
