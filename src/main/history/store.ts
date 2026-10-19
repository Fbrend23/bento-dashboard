import { mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'
import {
  INCIDENT_KINDS,
  type HistoryPoint,
  type Incident,
  type IncidentKind
} from '@shared/history'
import { BUCKET_MS, RETENTION_MS } from './recorder'

export interface HistoryData {
  points: HistoryPoint[]
  incidents: Incident[]
}

/** A week of one-minute points; a file holding more is damaged, and is cut rather than loaded. */
const MAX_POINTS = RETENTION_MS / BUCKET_MS
const MAX_INCIDENTS = 1000
const MAX_TEXT = 300
const FIELDS = ['cpu', 'memory', 'swap', 'down', 'up', 'temperature'] as const

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

function parsePoint(raw: unknown): HistoryPoint | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  if (!Number.isInteger(record.t) || (record.t as number) <= 0) return null

  const values: Partial<Record<(typeof FIELDS)[number], number | null>> = {}
  for (const field of FIELDS) {
    const value = record[field]
    if (value !== null && !isNumber(value)) return null
    values[field] = value
  }

  const rawDisks = record.disks
  if (typeof rawDisks !== 'object' || rawDisks === null || Array.isArray(rawDisks)) return null
  const disks: Record<string, number> = {}
  for (const [mount, percent] of Object.entries(rawDisks)) {
    if (!isNumber(percent)) return null
    disks[mount] = percent
  }

  return { t: record.t as number, ...(values as Omit<HistoryPoint, 't' | 'disks'>), disks }
}

function parseIncident(raw: unknown): Incident | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { key, kind, subject, startedAt, endedAt } = raw as Record<string, unknown>
  if (typeof key !== 'string' || key === '' || key.length > MAX_TEXT) return null
  if (!(INCIDENT_KINDS as readonly unknown[]).includes(kind)) return null
  if (typeof subject !== 'string' || subject.length > MAX_TEXT) return null
  if (!isNumber(startedAt)) return null
  if (endedAt !== null && (!isNumber(endedAt) || endedAt < startedAt)) return null
  return { key, kind: kind as IncidentKind, subject, startedAt, endedAt }
}

/**
 * Lenient on purpose: always returns usable history. Anything malformed is dropped, the points are
 * put in time order with one per minute, and the sizes are capped.
 */
export function parseHistory(raw: unknown): HistoryData {
  const record =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}

  const byMinute = new Map<number, HistoryPoint>()
  for (const item of Array.isArray(record.points) ? record.points : []) {
    const point = parsePoint(item)
    if (point) byMinute.set(point.t, point)
  }
  const points = [...byMinute.values()].sort((a, b) => a.t - b.t).slice(-MAX_POINTS)

  const incidents = (Array.isArray(record.incidents) ? record.incidents : [])
    .map(parseIncident)
    .filter((i): i is Incident => i !== null)
    .slice(-MAX_INCIDENTS)

  return { points, incidents }
}

export interface HistoryStore {
  load(): Promise<HistoryData>
  save(data: HistoryData): Promise<void>
  /** Same as save, but synchronous: the last write, when the app is quitting. */
  saveSync(data: HistoryData): void
}

export function createHistoryStore(filePath: string): HistoryStore {
  const serialise = (data: HistoryData): string =>
    JSON.stringify({ version: 1, ...parseHistory(data) })

  return {
    async load() {
      try {
        return parseHistory(JSON.parse(await readFile(filePath, 'utf-8')) as unknown)
      } catch {
        // Missing or corrupt file is a normal first-run state, not an error.
        return { points: [], incidents: [] }
      }
    },

    async save(data) {
      await mkdir(dirname(filePath), { recursive: true })
      const temp = `${filePath}.${process.pid}.tmp`
      try {
        await writeFile(temp, serialise(data), 'utf-8')
        await rename(temp, filePath)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
    },

    saveSync(data) {
      mkdirSync(dirname(filePath), { recursive: true })
      const temp = `${filePath}.${process.pid}.tmp`
      try {
        writeFileSync(temp, serialise(data), 'utf-8')
        renameSync(temp, filePath)
      } catch (error) {
        rmSync(temp, { force: true })
        throw error
      }
    }
  }
}
