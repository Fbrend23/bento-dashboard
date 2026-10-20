import { readFileSync } from 'fs'
import { resolve } from 'path'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  createRemoteHistory,
  HISTORY_CACHE_MS,
  HistoryUnavailableError,
  MAX_HISTORY_BYTES
} from '../src/main/history/remote'
import { HISTORY_COMMAND } from '../src/main/ssh/commands'
import type { ExecResult } from '../src/main/ssh/connection'

const FIXTURE = readFileSync(resolve(__dirname, 'fixtures/agent-history.json'), 'utf-8')
/** Two minutes after the last point of the fixture. */
const NOW = 1_787_000_160_000 + 120_000

let clock: number
let run: Mock<(command: string) => Promise<ExecResult>>

const ok = (stdout = FIXTURE): ExecResult => ({ stdout, stderr: '', code: 0 })
const make = (): ReturnType<typeof createRemoteHistory> =>
  createRemoteHistory({ run, now: () => clock })

beforeEach(() => {
  clock = NOW
  run = vi.fn(async () => ok())
})

describe('createRemoteHistory.query', () => {
  it('reads the agent file with the fixed command and answers for the range', async () => {
    const result = await make().query('1h')
    expect(run.mock.calls).toEqual([[HISTORY_COMMAND]])
    expect(result).toMatchObject({ range: '1h', now: NOW })
    expect(result?.points.map((p) => p.t)).toEqual([1787000040000, 1787000100000, 1787000160000])
    expect(result?.points[0]).toMatchObject({ cpu: 12.5, disks: { '/': 31.4, '/media': 62 } })
  })

  it('lists the incidents of the range, the open one included, newest first', async () => {
    const result = await make().query('24h')
    expect(result?.incidents.map((i) => [i.key, i.endedAt])).toEqual([
      ['disk-full:/media', null],
      ['service-down:app-1', 1787000130000]
    ])
  })

  it('leaves out what is older than the range', async () => {
    clock = NOW + 3_600_000
    const result = await make().query('1h')
    expect(result?.points).toEqual([])
  })

  it('answers null for a range it does not know, without reading anything', async () => {
    const history = make()
    for (const range of ['30d', '', undefined, { evil: true }, ['1h']]) {
      await expect(history.query(range)).resolves.toBeNull()
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('keeps the file for a minute: changing the range does not read it again', async () => {
    const history = make()
    await history.query('1h')
    clock += HISTORY_CACHE_MS - 1
    await history.query('24h')
    expect(run).toHaveBeenCalledTimes(1)
    clock += 1
    await history.query('7d')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('shares one read between simultaneous requests', async () => {
    const history = make()
    await Promise.all([history.query('1h'), history.query('24h'), history.query('7d')])
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('drops what is malformed instead of failing', async () => {
    run.mockResolvedValue(
      ok(JSON.stringify({ points: [{ t: 'x' }, JSON.parse(FIXTURE).points[0]], incidents: 'no' }))
    )
    const result = await make().query('7d')
    expect(result?.points).toHaveLength(1)
    expect(result?.incidents).toEqual([])
  })
})

describe('createRemoteHistory.query (unavailable)', () => {
  it.each([
    ['the file is missing', { stdout: '', stderr: 'cat: No such file', code: 1 }],
    ['the command timed out', { stdout: '', stderr: '', code: 124 }],
    ['the file is not JSON', { stdout: '{"points": [', stderr: '', code: 0 }],
    ['the file is empty', { stdout: '', stderr: '', code: 0 }]
  ])('throws a clear error when %s and nothing was read before', async (_name, result) => {
    run.mockResolvedValue(result)
    await expect(make().query('24h')).rejects.toBeInstanceOf(HistoryUnavailableError)
  })

  it('refuses a file bigger than the limit without parsing it', async () => {
    const parse = vi.spyOn(JSON, 'parse')
    run.mockResolvedValue(ok(' '.repeat(MAX_HISTORY_BYTES + 1)))
    await expect(make().query('24h')).rejects.toBeInstanceOf(HistoryUnavailableError)
    expect(parse).not.toHaveBeenCalled()
    parse.mockRestore()
  })

  it('accepts a file just under the limit', async () => {
    const padding = ' '.repeat(MAX_HISTORY_BYTES - FIXTURE.length)
    run.mockResolvedValue(ok(FIXTURE + padding))
    await expect(make().query('24h')).resolves.toMatchObject({ range: '24h' })
  })

  it('keeps serving the last copy when a later file is too big', async () => {
    const history = make()
    await history.query('1h')
    clock += HISTORY_CACHE_MS
    run.mockResolvedValue(ok(' '.repeat(MAX_HISTORY_BYTES + 1)))
    await expect(history.query('1h')).resolves.toMatchObject({ range: '1h' })
  })

  it('throws the same error when bento cannot be reached', async () => {
    run.mockRejectedValue(new Error('Not connected to bento'))
    await expect(make().query('24h')).rejects.toBeInstanceOf(HistoryUnavailableError)
  })

  it('does not forward the text of the underlying error', async () => {
    run.mockRejectedValue(new Error('connect ECONNREFUSED 100.64.0.1:22'))
    await expect(make().query('24h')).rejects.not.toThrow(/100\.64/)
  })

  it('serves the last file it read when a later read fails', async () => {
    const history = make()
    await history.query('24h')
    clock += HISTORY_CACHE_MS
    run.mockRejectedValue(new Error('Not connected to bento'))
    // 1h: one point per minute, nothing grouped.
    const result = await history.query('1h')
    expect(result?.points).toHaveLength(3)
    expect(result?.now).toBe(clock)
  })

  it('tries again at the next request after a failure', async () => {
    run.mockRejectedValueOnce(new Error('Not connected to bento'))
    const history = make()
    await expect(history.query('24h')).rejects.toBeInstanceOf(HistoryUnavailableError)
    await expect(history.query('24h')).resolves.toMatchObject({ range: '24h' })
    expect(run).toHaveBeenCalledTimes(2)
  })
})
