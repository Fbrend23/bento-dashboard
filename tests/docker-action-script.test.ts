import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The script is the security boundary on bento, so it is tested against a fake docker. The real
// check is the negative matrix run on bento itself (README); this one guards the logic locally.

const SCRIPT_PATH = resolve('scripts/bento-docker-action.sh')
const script = readFileSync(SCRIPT_PATH, 'utf-8')

/** Git Bash on Windows (plain `bash` could be WSL, which cannot see these paths); bash elsewhere. */
function findBash(): string | null {
  if (process.platform === 'win32') {
    const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
    return existsSync(gitBash) ? gitBash : null
  }
  return spawnSync('bash', ['-c', 'exit 0']).status === 0 ? 'bash' : null
}

const bash = findBash()
const posix = (path: string): string => path.split('\\').join('/')

let dir: string
let scriptCopy: string
let logFile: string

beforeAll(() => {
  if (!bash) return
  dir = mkdtempSync(join(tmpdir(), 'bento-action-'))
  logFile = join(dir, 'docker.log')

  const fakeDocker = join(dir, 'docker')
  writeFileSync(
    fakeDocker,
    [
      '#!/bin/bash',
      'echo "$*" >> "$FAKE_LOG"',
      'if [ "$1" = ps ]; then',
      '  [ "${FAKE_PS_FAIL:-}" = 1 ] && exit 1',
      "  printf 'jellyfin\\nseries\\nproxy-app-1\\n'",
      '  exit 0',
      'fi',
      'exit "${FAKE_ACTION_EXIT:-0}"',
      ''
    ].join('\n')
  )

  // Only the docker path differs from the real script; check the substitution really happened.
  const replaced = script.replace('DOCKER=/usr/bin/docker', `DOCKER='${posix(fakeDocker)}'`)
  if (replaced === script) throw new Error('DOCKER line not found in the script')
  scriptCopy = join(dir, 'bento-docker-action.sh')
  writeFileSync(scriptCopy, replaced)
})

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function run(args: string[], env: Record<string, string> = {}): { code: number; log: string[] } {
  writeFileSync(logFile, '')
  const result = spawnSync(bash!, [posix(scriptCopy), ...args], {
    env: { ...process.env, FAKE_LOG: posix(logFile), ...env },
    encoding: 'utf-8'
  })
  const log = readFileSync(logFile, 'utf-8').split('\n').filter(Boolean)
  return { code: result.status ?? -1, log }
}

const PS = 'ps -a --format {{.Names}}'

describe('bento-docker-action.sh (file)', () => {
  it('is a strict bash script with LF line endings only', () => {
    expect(script.startsWith('#!/bin/bash\n')).toBe(true)
    expect(script).toContain('set -euo pipefail')
    expect(script).not.toContain(String.fromCharCode(13))
  })

  it('fixes PATH and calls docker by its absolute path', () => {
    expect(script).toContain('PATH=/usr/bin:/bin')
    expect(script).toContain('DOCKER=/usr/bin/docker')
  })

  it('only ever runs start, stop or restart', () => {
    expect(script).toContain('start | stop | restart')
    expect(script).toContain('exec "$DOCKER" "$action" "$name"')
  })
})

// Each case starts a bash process (about 170 ms with Git Bash): under the load of the whole suite
// the default 5 s per test can be missed, so this series gets a generous limit.
describe.skipIf(!bash)(
  'bento-docker-action.sh (run against a fake docker)',
  { timeout: 30_000 },
  () => {
    it.each(['start', 'stop', 'restart'])(
      '%s runs the one docker command for a known container',
      (action) => {
        const { code, log } = run([action, 'jellyfin'])
        expect(code).toBe(0)
        expect(log).toEqual([PS, `${action} jellyfin`])
      }
    )

    it('works on every container docker lists', () => {
      expect(run(['stop', 'proxy-app-1']).log).toEqual([PS, 'stop proxy-app-1'])
      expect(run(['restart', 'series']).log).toEqual([PS, 'restart series'])
    })

    it("passes docker's own exit code through", () => {
      expect(run(['restart', 'jellyfin'], { FAKE_ACTION_EXIT: '3' }).code).toBe(3)
    })

    const badUsage: [string, string[]][] = [
      ['no argument', []],
      ['no name', ['restart']],
      ['an extra argument', ['restart', 'jellyfin', 'extra']],
      ['a docker option as the name', ['restart', '--help']],
      ['a short option as the name', ['restart', '-f']],
      ['a command separator', ['restart', 'jellyfin;id']],
      ['a command substitution', ['restart', '$(id)']],
      ['a backtick', ['restart', '`id`']],
      ['a pipe', ['restart', 'jellyfin|id']],
      ['a space in the name', ['restart', 'jelly fin']],
      ['a trailing space', ['restart', 'jellyfin ']],
      ['an empty name', ['restart', '']],
      ['a newline', ['restart', 'jellyfin\nseries']],
      ['a path', ['restart', '../etc/passwd']],
      ['a slash', ['restart', 'a/b']],
      ['a name that is too long', ['restart', 'a'.repeat(129)]],
      ['an action in capitals', ['Restart', 'jellyfin']],
      ['rm', ['rm', 'jellyfin']],
      ['kill', ['kill', 'jellyfin']],
      ['exec', ['exec', 'jellyfin']],
      ['run', ['run', 'jellyfin']],
      ['an empty action', ['', 'jellyfin']]
    ]

    it.each(badUsage)('refuses %s with code 64, without calling docker at all', (_label, args) => {
      const { code, log } = run(args)
      expect(code).toBe(64)
      expect(log).toEqual([])
    })

    it('accepts the longest valid name', () => {
      const name = 'a'.repeat(128)
      expect(run(['start', name]).code).toBe(65) // valid shape, but docker does not list it
    })

    it.each(['nope', 'jelly', 'JELLYFIN', 'jellyfin2', 'ellyfin'])(
      'refuses the unknown container %s with code 65 and only lists containers',
      (name) => {
        const { code, log } = run(['restart', name])
        expect(code).toBe(65)
        expect(log).toEqual([PS])
      }
    )

    it('refuses with code 66 when docker cannot list containers, and acts on nothing', () => {
      const { code, log } = run(['restart', 'jellyfin'], { FAKE_PS_FAIL: '1' })
      expect(code).toBe(66)
      expect(log).toEqual([PS])
    })
  }
)
