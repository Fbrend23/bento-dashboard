import { spawnSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// The script is the security boundary of the logs: one sudoers line lets bento-dash call it with any
// argument, so it is tested against a fake docker. Same method as docker-action-script.test.ts.

const SCRIPT_PATH = resolve('scripts/bento-docker-logs.sh')
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
  dir = mkdtempSync(join(tmpdir(), 'bento-logs-'))
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
      'echo "line from $4"',
      'exit "${FAKE_LOGS_EXIT:-0}"',
      ''
    ].join('\n')
  )

  const replaced = script.replace('DOCKER=/usr/bin/docker', `DOCKER='${posix(fakeDocker)}'`)
  if (replaced === script) throw new Error('DOCKER line not found in the script')
  scriptCopy = join(dir, 'bento-docker-logs.sh')
  writeFileSync(scriptCopy, replaced)
})

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function run(
  args: string[],
  env: Record<string, string> = {}
): { code: number; log: string[]; stdout: string } {
  writeFileSync(logFile, '')
  const result = spawnSync(bash!, [posix(scriptCopy), ...args], {
    env: { ...process.env, FAKE_LOG: posix(logFile), ...env },
    encoding: 'utf-8'
  })
  const log = readFileSync(logFile, 'utf-8').split('\n').filter(Boolean)
  return { code: result.status ?? -1, log, stdout: result.stdout }
}

const PS = 'ps -a --format {{.Names}}'

describe('bento-docker-logs.sh (file)', () => {
  it('is a strict bash script with LF line endings only', () => {
    expect(script.startsWith('#!/bin/bash\n')).toBe(true)
    expect(script).toContain('set -euo pipefail')
    expect(script).not.toContain(String.fromCharCode(13))
  })

  it('fixes PATH and calls docker by its absolute path', () => {
    expect(script).toContain('PATH=/usr/bin:/bin')
    expect(script).toContain('DOCKER=/usr/bin/docker')
  })

  it('only ever reads the last 200 lines', () => {
    expect(script).toContain('exec "$DOCKER" logs --tail 200 "$name"')
  })
})

describe.skipIf(!bash)(
  'bento-docker-logs.sh (run against a fake docker)',
  { timeout: 30_000 },
  () => {
    it('reads the last 200 lines of a known container', () => {
      const { code, log, stdout } = run(['jellyfin'])
      expect(code).toBe(0)
      expect(log).toEqual([PS, 'logs --tail 200 jellyfin'])
      expect(stdout).toContain('line from jellyfin')
    })

    it('works on every container docker lists', () => {
      expect(run(['proxy-app-1']).log).toEqual([PS, 'logs --tail 200 proxy-app-1'])
      expect(run(['series']).log).toEqual([PS, 'logs --tail 200 series'])
    })

    it("passes docker's own exit code through", () => {
      expect(run(['jellyfin'], { FAKE_LOGS_EXIT: '3' }).code).toBe(3)
    })

    const badUsage: [string, string[]][] = [
      ['no argument', []],
      ['an extra argument', ['jellyfin', 'extra']],
      ['a docker option as an extra argument', ['jellyfin', '--follow']],
      ['an option before the name', ['--follow', 'jellyfin']],
      ['a docker option as the name', ['--help']],
      ['a short option as the name', ['-f']],
      ['a command separator', ['jellyfin;id']],
      ['a command substitution', ['$(id)']],
      ['a backtick', ['`id`']],
      ['a pipe', ['jellyfin|id']],
      ['a space in the name', ['jelly fin']],
      ['a trailing space', ['jellyfin ']],
      ['an empty name', ['']],
      ['a newline', ['jellyfin\nseries']],
      ['a path', ['../etc/passwd']],
      ['a slash', ['a/b']],
      ['a name that is too long', ['a'.repeat(129)]]
    ]

    it.each(badUsage)('refuses %s with code 64, without calling docker at all', (_label, args) => {
      const { code, log } = run(args)
      expect(code).toBe(64)
      expect(log).toEqual([])
    })

    it('accepts the longest valid name', () => {
      expect(run(['a'.repeat(128)]).code).toBe(65) // valid shape, but docker does not list it
    })

    it.each(['nope', 'jelly', 'JELLYFIN', 'jellyfin2', 'ellyfin'])(
      'refuses the unknown container %s with code 65 and only lists containers',
      (name) => {
        const { code, log } = run([name])
        expect(code).toBe(65)
        expect(log).toEqual([PS])
      }
    )

    it('refuses with code 66 when docker cannot list containers, and reads nothing', () => {
      const { code, log } = run(['jellyfin'], { FAKE_PS_FAIL: '1' })
      expect(code).toBe(66)
      expect(log).toEqual([PS])
    })
  }
)
