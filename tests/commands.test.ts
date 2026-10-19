import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { CONTAINER_ACTIONS } from '@shared/actions'
import {
  ALLOWED_COMMANDS,
  CONTAINER_ACTION_SCRIPT,
  containerActionCommand,
  containerLogCommand,
  isAllowedCommand,
  logCommand,
  TAILSCALED_LOG_COMMAND
} from '../src/main/ssh/commands'
import { SNAPSHOT_COMMAND } from '../src/main/monitors/snapshot'

const restart = (name = 'jellyfin'): string => containerActionCommand('restart', name)!

describe('isAllowedCommand (fixed commands)', () => {
  it('allows every known fixed command, exactly', () => {
    expect(isAllowedCommand(SNAPSHOT_COMMAND)).toBe(true)
    expect(isAllowedCommand(TAILSCALED_LOG_COMMAND)).toBe(true)
  })

  it('refuses variants, additions and anything else', () => {
    for (const command of [
      '',
      'reboot',
      `${SNAPSHOT_COMMAND}; reboot`,
      `${SNAPSHOT_COMMAND} `,
      TAILSCALED_LOG_COMMAND.replace('-n 200', '-n 201'),
      TAILSCALED_LOG_COMMAND.replace('tailscaled', 'sshd'),
      `${TAILSCALED_LOG_COMMAND} `
    ]) {
      expect(isAllowedCommand(command)).toBe(false)
    }
  })

  it('no longer allows the old fixed restart of jellyfin', () => {
    expect(isAllowedCommand('timeout 90 sudo -n docker restart jellyfin')).toBe(false)
  })

  it('is not fooled by inherited object keys', () => {
    expect(isAllowedCommand('constructor')).toBe(false)
    expect(isAllowedCommand('__proto__')).toBe(false)
  })
})

describe('containerActionCommand', () => {
  it('runs the validating script through sudo, with a remote timeout', () => {
    expect(restart()).toBe(`timeout 90 sudo -n ${CONTAINER_ACTION_SCRIPT} restart jellyfin`)
    expect(containerActionCommand('stop', 'proxy-app-1')).toBe(
      `timeout 90 sudo -n ${CONTAINER_ACTION_SCRIPT} stop proxy-app-1`
    )
    expect(containerActionCommand('start', 'game_container')).toBe(
      `timeout 90 sudo -n ${CONTAINER_ACTION_SCRIPT} start game_container`
    )
  })

  it('points at the script installed by the README', () => {
    expect(CONTAINER_ACTION_SCRIPT).toBe('/usr/local/bin/bento-docker-action')
  })

  it.each(['rm', 'kill', 'exec', 'run', 'Restart', '', 'restart jellyfin', null, undefined, 3])(
    'refuses the action %j',
    (action) => {
      expect(containerActionCommand(action as never, 'jellyfin')).toBeNull()
    }
  )

  it.each([
    '',
    '-rf',
    '--help',
    'a b',
    'a;b',
    'a&&b',
    'a|b',
    '$(id)',
    '`id`',
    'a/b',
    'a\nb',
    'a'.repeat(129),
    null,
    undefined,
    7
  ])('refuses the container name %j', (name) => {
    expect(containerActionCommand('restart', name as never)).toBeNull()
  })

  it('has no shell metacharacter in any command it can build', () => {
    for (const action of CONTAINER_ACTIONS) {
      for (const name of ['jellyfin', 'proxy-app-1', 'a.b_c-d', 'A1', 'a'.repeat(128)]) {
        expect(containerActionCommand(action, name)).not.toMatch(/[;&|<>`$()'"\\\n\r*?{}[\]~#!]/)
      }
    }
  })
})

describe('isAllowedCommand (container actions)', () => {
  it('allows each action on any well-formed container name', () => {
    for (const action of CONTAINER_ACTIONS) {
      for (const name of ['jellyfin', 'series', 'proxy-app-1', '56d385c967ac_camera', 'a']) {
        expect(isAllowedCommand(containerActionCommand(action, name)!)).toBe(true)
      }
    }
  })

  it('refuses every way of changing it', () => {
    const ok = restart()
    for (const command of [
      ` ${ok}`,
      `${ok} `,
      `${ok}\n`,
      `${ok}\nreboot`,
      `${ok}; reboot`,
      `${ok} && reboot`,
      `${ok} | cat`,
      `${ok} extra`,
      `${ok}$(id)`,
      `${ok} 2>&1`,
      ok.replace('restart', 'Restart'),
      ok.replace('restart', 'rm'),
      ok.replace('restart', 'exec'),
      ok.replace('restart', 'restart --time=0'),
      ok.replace('jellyfin', '-f'),
      ok.replace('jellyfin', '--help'),
      ok.replace('jellyfin', 'a b'),
      ok.replace('jellyfin', 'a;b'),
      ok.replace('jellyfin', 'a'.repeat(129)),
      ok.replace('sudo -n', 'sudo'),
      ok.replace('timeout 90', 'timeout 91'),
      ok.replace('timeout 90 ', ''),
      ok.replace('/usr/local/bin/', '/tmp/'),
      ok.replace('/usr/local/bin/bento-docker-action', '/usr/bin/docker'),
      `timeout 90 sudo -n ${CONTAINER_ACTION_SCRIPT} restart`,
      `timeout 90 sudo -n ${CONTAINER_ACTION_SCRIPT}  restart jellyfin`
    ]) {
      expect(isAllowedCommand(command)).toBe(false)
    }
  })

  it('only the single anchored pattern is open: every fixed command stays an exact string', () => {
    const writes = ALLOWED_COMMANDS.filter((c) => /\b(restart|stop|start|kill|rm)\b/.test(c))
    expect(writes).toEqual([])
  })
})

describe('known commands', () => {
  it('the tailscaled journal is read with fixed arguments', () => {
    expect(TAILSCALED_LOG_COMMAND).toBe(
      'timeout 10 sudo -n journalctl -u tailscaled -n 200 --no-pager -o short-iso'
    )
  })

  it('has no shell metacharacter in the fixed log command', () => {
    expect(TAILSCALED_LOG_COMMAND).not.toMatch(/[;&|<>`$()]/)
  })
})

describe('containerLogCommand', () => {
  it('reads 200 lines through sudo -n, with stderr merged', () => {
    expect(containerLogCommand('jellyfin')).toBe(
      'timeout 10 sudo -n docker logs --tail 200 jellyfin 2>&1'
    )
    expect(containerLogCommand('proxy-app-1')).toBe(
      'timeout 10 sudo -n docker logs --tail 200 proxy-app-1 2>&1'
    )
  })

  it.each([
    '',
    '-f',
    '--help',
    'a b',
    'a;id',
    'a&&b',
    'a|b',
    '$(id)',
    '`id`',
    'a/b',
    'a\nb',
    'a'.repeat(129),
    null,
    undefined,
    7
  ])('refuses the container name %j', (name) => {
    expect(containerLogCommand(name as never)).toBeNull()
  })

  it('has no shell metacharacter other than the stderr merge', () => {
    for (const name of ['jellyfin', 'proxy-app-1', 'a.b_c-d', 'A1', 'a'.repeat(128)]) {
      expect(containerLogCommand(name)!.replace(' 2>&1', '')).not.toMatch(/[;&|<>`$()]/)
    }
  })
})

describe('logCommand', () => {
  it('maps a parsed source to its command', () => {
    expect(logCommand({ kind: 'tailscaled' })).toBe(TAILSCALED_LOG_COMMAND)
    expect(logCommand({ kind: 'container', name: 'jellyfin' })).toBe(
      containerLogCommand('jellyfin')
    )
  })

  it('builds nothing from a malformed name', () => {
    expect(logCommand({ kind: 'container', name: 'a;id' })).toBeNull()
  })
})

describe('isAllowedCommand (container logs)', () => {
  it('allows the log command of any well-formed container name', () => {
    for (const name of ['jellyfin', 'proxy-app-1', '56d385c967ac_camera', 'a']) {
      expect(isAllowedCommand(containerLogCommand(name)!)).toBe(true)
    }
  })

  it('refuses every way of changing it', () => {
    const ok = containerLogCommand('jellyfin')!
    for (const command of [
      ` ${ok}`,
      `${ok} `,
      `${ok}
`,
      `${ok}
reboot`,
      `${ok}; reboot`,
      `${ok} && reboot`,
      `${ok} | cat`,
      `${ok} extra`,
      `${ok}$(id)`,
      ok.replace(' 2>&1', ''),
      ok.replace('--tail 200', '--tail 201'),
      ok.replace('--tail 200', '--follow'),
      ok.replace('--tail 200', '--tail 200 --details'),
      ok.replace('docker logs', 'docker rm'),
      ok.replace('docker logs', 'docker exec'),
      ok.replace('jellyfin', '-f'),
      ok.replace('jellyfin', '--help'),
      ok.replace('jellyfin', 'a b'),
      ok.replace('jellyfin', 'a;b'),
      ok.replace('jellyfin', 'a'.repeat(129)),
      ok.replace('sudo -n', 'sudo'),
      ok.replace('timeout 10', 'timeout 11'),
      ok.replace('timeout 10 ', '')
    ]) {
      expect(isAllowedCommand(command)).toBe(false)
    }
  })
})

describe('README sudoers lines', () => {
  const readme = readFileSync(resolve('README.md'), 'utf-8')

  it('give bento-dash exactly one line per action on the script', () => {
    for (const action of CONTAINER_ACTIONS) {
      expect(readme).toContain(`NOPASSWD: ${CONTAINER_ACTION_SCRIPT} ${action} *`)
    }
    const lines = readme
      .split('\n')
      .filter((l) => l.includes(`NOPASSWD: ${CONTAINER_ACTION_SCRIPT}`))
    expect(lines).toHaveLength(CONTAINER_ACTIONS.length)
  })

  it('only offer exact "docker logs" rules, one container each, with no wildcard', () => {
    const rules = readme
      .split(/\r?\n/)
      .filter((l) => l.startsWith('bento-dash ALL=') && l.includes('docker logs'))
    expect(rules.length).toBeGreaterThan(0)
    for (const rule of rules) {
      expect(rule).toMatch(
        /^bento-dash ALL=\(root\) NOPASSWD: \/usr\/bin\/docker logs --tail 200 [A-Za-z0-9][A-Za-z0-9_.-]*$/
      )
    }
  })

  it('no longer offer a plain "docker restart" rule as part of the setup', () => {
    const rules = readme.split('\n').filter((l) => l.startsWith('bento-dash ALL='))
    expect(rules.some((l) => /docker (restart|stop|start|kill|rm|run|exec)\b/.test(l))).toBe(false)
  })
})
