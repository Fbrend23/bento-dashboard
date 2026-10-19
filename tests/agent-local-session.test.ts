import { describe, expect, it } from 'vitest'
import { createLocalSession } from '../src/agent/local-session'

// The "shell" is node itself so the test needs no /bin/sh (it also runs on Windows):
// the command string is then plain JavaScript.
const node = [process.execPath, '-e'] as const

describe('createLocalSession', () => {
  it('returns stdout, stderr and the exit code', async () => {
    const session = createLocalSession({ shell: node })
    const result = await session.exec(
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)'
    )
    expect(result).toEqual({ stdout: 'out', stderr: 'err', code: 3 })
  })

  it('reports code 0 on success', async () => {
    const session = createLocalSession({ shell: node })
    expect((await session.exec('process.stdout.write("ok")')).code).toBe(0)
  })

  it('rejects with a "timed out" error when the command runs too long', async () => {
    const session = createLocalSession({ shell: node, timeoutMs: 5000 })
    await expect(session.exec('setTimeout(() => {}, 10000)', { timeoutMs: 200 })).rejects.toThrow(
      /timed out/i
    )
  })

  it('uses the session timeout when none is given per command', async () => {
    const session = createLocalSession({ shell: node, timeoutMs: 200 })
    await expect(session.exec('setTimeout(() => {}, 10000)')).rejects.toThrow(/timed out/i)
  })

  it('never closes by itself and close() is harmless', () => {
    const session = createLocalSession({ shell: node })
    let closed = false
    session.onClose(() => (closed = true))
    session.close()
    expect(closed).toBe(false)
  })
})
