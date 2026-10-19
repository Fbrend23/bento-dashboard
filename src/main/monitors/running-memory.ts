import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { DockerInventory } from '@shared/monitors'

const CONTAINER = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

/**
 * Remembers which containers were seen running. A container that stops while remembered raises an
 * alert; one that was never running (already stopped when first seen) stays neutral. Names only,
 * never used to build a command.
 */
export interface RunningMemory {
  names(): ReadonlySet<string>
  /** Call only with a readable docker inventory: an unreadable one must never reach here. */
  observe(inventory: DockerInventory): void
  /** "Ignore this stop": the container no longer alerts until it runs again. */
  forget(name: string): void
}

export interface FileRunningMemory extends RunningMemory {
  /** Resolves once every pending write has reached the disk. */
  flush(): Promise<void>
}

export function createRunningMemory(
  initial: Iterable<string> = [],
  onChange: () => void = () => {}
): RunningMemory {
  let remembered = new Set(initial)
  return {
    names: () => remembered,
    observe({ present, running }) {
      const known = new Set(present)
      const next = new Set([...remembered].filter((name) => known.has(name)))
      for (const name of running) next.add(name)
      if (next.size === remembered.size && [...next].every((n) => remembered.has(n))) return
      remembered = next
      onChange()
    },
    forget(name) {
      if (!remembered.has(name)) return
      remembered = new Set([...remembered].filter((n) => n !== name))
      onChange()
    }
  }
}

function parseNames(raw: unknown): string[] {
  const names = (raw as { names?: unknown } | null)?.names
  if (!Array.isArray(names)) return []
  return names.filter((n): n is string => typeof n === 'string' && CONTAINER.test(n))
}

/** Persists the memory in `filePath` so it survives a restart of the app. */
export async function createFileRunningMemory(filePath: string): Promise<FileRunningMemory> {
  let initial: string[] = []
  try {
    initial = parseNames(JSON.parse(await readFile(filePath, 'utf-8')) as unknown)
  } catch {
    // Missing or corrupt file is a normal first-run state: start with an empty memory.
  }

  let pending: Promise<void> = Promise.resolve()
  const save = (): void => {
    const names = [...memory.names()].sort()
    pending = pending
      .then(async () => {
        await mkdir(dirname(filePath), { recursive: true })
        const temp = `${filePath}.${process.pid}.tmp`
        try {
          await writeFile(temp, JSON.stringify({ names }), 'utf-8')
          await rename(temp, filePath)
        } catch (error) {
          await rm(temp, { force: true })
          throw error
        }
      })
      // A failed write must not stop the monitoring; the next change retries.
      .catch(() => {})
  }

  const memory = createRunningMemory(initial, save)
  return { ...memory, flush: () => pending }
}
