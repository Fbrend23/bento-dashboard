import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HistoryPoint, Incident } from '@shared/history'
import { createHistoryStore, parseHistory } from '../src/main/history/store'

const point = (t: number, patch: Partial<HistoryPoint> = {}): HistoryPoint => ({
  t,
  cpu: 10,
  memory: 20,
  swap: null,
  down: 1000,
  up: 500,
  temperature: 50,
  disks: { '/': 30 },
  ...patch
})

const incident = (key: string, patch: Partial<Incident> = {}): Incident => ({
  key,
  kind: 'service-down',
  subject: 'Jellyfin',
  startedAt: 1000,
  endedAt: null,
  ...patch
})

describe('parseHistory', () => {
  it('reads a well-formed file', () => {
    const raw = { points: [point(60_000), point(120_000)], incidents: [incident('service-down:a')] }
    expect(parseHistory(raw)).toEqual(raw)
  })

  it.each([null, undefined, 'text', 42, [], {}, { points: 'x' }, { points: [], incidents: 3 }])(
    'gives empty history for %j',
    (raw) => {
      expect(parseHistory(raw)).toEqual({ points: [], incidents: [] })
    }
  )

  it('drops the points that are malformed and keeps the others', () => {
    const raw = {
      points: [
        point(60_000),
        { ...point(120_000), cpu: 'high' },
        { ...point(180_000), t: 'now' },
        { ...point(240_000), disks: { '/': 'full' } },
        { ...point(300_000), disks: null },
        { ...point(360_000), cpu: Number.NaN },
        null,
        'x',
        point(420_000)
      ],
      incidents: []
    }
    expect(parseHistory(raw).points.map((p) => p.t)).toEqual([60_000, 420_000])
  })

  it('accepts unknown values as null and refuses a missing field', () => {
    const noField: Record<string, unknown> = { ...point(60_000) }
    delete noField.cpu
    expect(parseHistory({ points: [noField], incidents: [] }).points).toEqual([])
    expect(
      parseHistory({ points: [point(60_000, { cpu: null })], incidents: [] }).points
    ).toHaveLength(1)
  })

  it('puts the points in time order and keeps one per minute', () => {
    const raw = {
      points: [point(180_000), point(60_000), point(120_000), point(60_000)],
      incidents: []
    }
    expect(parseHistory(raw).points.map((p) => p.t)).toEqual([60_000, 120_000, 180_000])
  })

  it('keeps only the fields it knows', () => {
    const raw = {
      points: [{ ...point(60_000), extra: 'x' }],
      incidents: [{ ...incident('k'), extra: 1 }]
    }
    const parsed = parseHistory(raw)
    expect(Object.keys(parsed.points[0]).sort()).toEqual([
      'cpu',
      'disks',
      'down',
      'memory',
      'swap',
      't',
      'temperature',
      'up'
    ])
    expect(Object.keys(parsed.incidents[0]).sort()).toEqual([
      'endedAt',
      'key',
      'kind',
      'startedAt',
      'subject'
    ])
  })

  it('drops the incidents that are malformed', () => {
    const raw = {
      points: [],
      incidents: [
        incident('service-down:a'),
        { ...incident('b'), kind: 'explosion' },
        { ...incident('c'), startedAt: 'yesterday' },
        { ...incident('d'), endedAt: 'later' },
        { ...incident('e'), endedAt: 500 },
        { ...incident(''), startedAt: 1 },
        { ...incident('f'), subject: 42 },
        incident('service-down:g', { endedAt: 5000 })
      ]
    }
    expect(parseHistory(raw).incidents.map((i) => i.key)).toEqual([
      'service-down:a',
      'service-down:g'
    ])
  })

  it('caps what it keeps, so a damaged file cannot grow the memory', () => {
    const points = Array.from({ length: 30_000 }, (_, i) => point((i + 1) * 60_000))
    const incidents = Array.from({ length: 3000 }, (_, i) => incident(`service-down:s${i}`))
    const parsed = parseHistory({ points, incidents })
    expect(parsed.points.length).toBeLessThanOrEqual(10_080)
    expect(parsed.incidents.length).toBeLessThanOrEqual(1000)
  })

  it('keeps the most recent points when it has to cap', () => {
    const points = Array.from({ length: 12_000 }, (_, i) => point((i + 1) * 60_000))
    expect(parseHistory({ points, incidents: [] }).points.at(-1)?.t).toBe(12_000 * 60_000)
  })
})

describe('history store', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bento-history-'))
    file = join(dir, 'history.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('starts empty when the file does not exist', async () => {
    expect(await createHistoryStore(file).load()).toEqual({ points: [], incidents: [] })
  })

  it('round-trips the history', async () => {
    const store = createHistoryStore(file)
    const data = { points: [point(60_000)], incidents: [incident('service-down:a')] }
    await store.save(data)
    expect(await store.load()).toEqual(data)
  })

  it('creates the folder and leaves no temporary file', async () => {
    const nested = join(dir, 'a', 'history.json')
    await createHistoryStore(nested).save({ points: [], incidents: [] })
    expect(await readdir(join(dir, 'a'))).toEqual(['history.json'])
  })

  it('starts empty from a corrupt file', async () => {
    await writeFile(file, '{ not json', 'utf-8')
    expect(await createHistoryStore(file).load()).toEqual({ points: [], incidents: [] })
  })

  it('writes the same file synchronously, for the moment the app quits', async () => {
    const store = createHistoryStore(file)
    const data = { points: [point(60_000)], incidents: [] }
    store.saveSync(data)
    expect(JSON.parse(await readFile(file, 'utf-8'))).toMatchObject({ points: [{ t: 60_000 }] })
    expect(await store.load()).toEqual(data)
    expect(await readdir(dir)).toEqual(['history.json'])
  })

  it('stores nothing but metrics and incidents: no secret, no address', async () => {
    await createHistoryStore(file).save({ points: [point(60_000)], incidents: [incident('k')] })
    expect(Object.keys(JSON.parse(await readFile(file, 'utf-8'))).sort()).toEqual([
      'incidents',
      'points',
      'version'
    ])
  })
})
