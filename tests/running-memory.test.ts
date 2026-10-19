import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileRunningMemory, createRunningMemory } from '../src/main/monitors/running-memory'

describe('RunningMemory', () => {
  it('starts empty', () => {
    expect([...createRunningMemory().names()]).toEqual([])
  })

  it('remembers the containers seen running', () => {
    const memory = createRunningMemory()
    memory.observe({ present: ['a', 'b', 'c'], running: ['a', 'b'] })
    expect([...memory.names()].sort()).toEqual(['a', 'b'])
  })

  it('keeps a container that stopped, so its stop can raise an alert', () => {
    const memory = createRunningMemory()
    memory.observe({ present: ['a', 'b'], running: ['a', 'b'] })
    memory.observe({ present: ['a', 'b'], running: ['a'] })
    expect([...memory.names()].sort()).toEqual(['a', 'b'])
  })

  it('forgets a container docker no longer knows (removed)', () => {
    const memory = createRunningMemory()
    memory.observe({ present: ['a', 'b'], running: ['a', 'b'] })
    memory.observe({ present: ['a'], running: ['a'] })
    expect([...memory.names()]).toEqual(['a'])
  })

  it('forgets a container on request', () => {
    const memory = createRunningMemory(['a', 'b'])
    memory.forget('a')
    expect([...memory.names()]).toEqual(['b'])
  })

  it('never lets a container that is not running join the memory', () => {
    const memory = createRunningMemory()
    memory.observe({ present: ['a'], running: [] })
    expect(memory.names().size).toBe(0)
  })

  it('notifies listeners only when the memory actually changes', () => {
    let changes = 0
    const memory = createRunningMemory([], () => changes++)
    memory.observe({ present: ['a'], running: ['a'] })
    memory.observe({ present: ['a'], running: ['a'] })
    memory.forget('missing')
    expect(changes).toBe(1)
    memory.forget('a')
    expect(changes).toBe(2)
  })
})

describe('file running memory', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bento-running-'))
    file = join(dir, 'running-containers.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('starts empty when the file does not exist', async () => {
    expect((await createFileRunningMemory(file)).names().size).toBe(0)
  })

  it('persists changes and reloads them', async () => {
    const memory = await createFileRunningMemory(file)
    memory.observe({ present: ['a', 'b'], running: ['a', 'b'] })
    memory.forget('b')
    await memory.flush()
    expect([...(await createFileRunningMemory(file)).names()]).toEqual(['a'])
  })

  it('leaves no temporary file behind', async () => {
    const memory = await createFileRunningMemory(file)
    memory.observe({ present: ['a'], running: ['a'] })
    await memory.flush()
    expect(await readdir(dir)).toEqual(['running-containers.json'])
  })

  it('starts empty from a corrupt or unexpected file', async () => {
    await writeFile(file, '{ not json', 'utf-8')
    expect((await createFileRunningMemory(file)).names().size).toBe(0)
    await writeFile(file, JSON.stringify({ names: 'a' }), 'utf-8')
    expect((await createFileRunningMemory(file)).names().size).toBe(0)
  })

  it('ignores entries that are not valid container names', async () => {
    await writeFile(file, JSON.stringify({ names: ['ok', 42, '-rm -rf', ''] }), 'utf-8')
    expect([...(await createFileRunningMemory(file)).names()]).toEqual(['ok'])
  })

  it('stores only container names', async () => {
    const memory = await createFileRunningMemory(file)
    memory.observe({ present: ['a'], running: ['a'] })
    await memory.flush()
    expect(JSON.parse(await readFile(file, 'utf-8'))).toEqual({ names: ['a'] })
  })
})
