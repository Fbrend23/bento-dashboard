import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { useLogsStore, AUTO_REFRESH_MS } from '../src/renderer/src/stores/logs'

const LINES = [
  '[01:00:00] [INF] [1] Hello World',
  '[01:00:01] [WRN] [1] careful',
  '[01:00:02] [ERR] [1] broken'
]

let getLogs: Mock
let exportLogs: Mock
let writeText: Mock

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  getLogs = vi.fn().mockResolvedValue({ ok: true, lines: LINES, fetchedAt: 1 })
  exportLogs = vi.fn().mockResolvedValue({ ok: true })
  writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('window', { bento: { getLogs, exportLogs } })
  vi.stubGlobal('navigator', { clipboard: { writeText } })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('logs store filtering', () => {
  it('shows every line, with a total, before any filter', async () => {
    const store = useLogsStore()
    expect(store.filtered).toEqual([])
    expect(store.total).toBe(0)
    await store.load()
    expect(store.filtered).toEqual(LINES)
    expect(store.total).toBe(3)
  })

  it('filters by text and by level, and counts what is shown', async () => {
    const store = useLogsStore()
    await store.load()
    store.query = 'CAREFUL'
    expect(store.filtered).toEqual([LINES[1]])
    store.query = ''
    store.level = 'errors'
    expect(store.filtered).toEqual([LINES[2]])
    store.level = 'warnings'
    expect(store.filtered).toEqual([LINES[1], LINES[2]])
    expect(store.total).toBe(3)
  })

  it('has no lines after a failed read', async () => {
    getLogs.mockResolvedValue({ ok: false, error: 'x' })
    const store = useLogsStore()
    await store.load()
    expect(store.filtered).toEqual([])
    expect(store.total).toBe(0)
  })

  it('wraps lines only when asked', () => {
    const store = useLogsStore()
    expect(store.wrap).toBe(false)
  })
})

describe('logs store auto refresh', () => {
  it('is off by default and does not poll', async () => {
    const store = useLogsStore()
    expect(store.autoRefresh).toBe(false)
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_MS * 3)
    expect(getLogs).not.toHaveBeenCalled()
  })

  it('reloads every 10 seconds once enabled, and stops when disabled', async () => {
    expect(AUTO_REFRESH_MS).toBe(10_000)
    const store = useLogsStore()
    store.setAutoRefresh(true)
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_MS)
    expect(getLogs).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_MS)
    expect(getLogs).toHaveBeenCalledTimes(2)

    store.setAutoRefresh(false)
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_MS * 3)
    expect(getLogs).toHaveBeenCalledTimes(2)
  })

  it('stopAutoRefresh clears the timer and the flag (leaving the tab)', async () => {
    const store = useLogsStore()
    store.setAutoRefresh(true)
    store.stopAutoRefresh()
    expect(store.autoRefresh).toBe(false)
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_MS * 3)
    expect(getLogs).not.toHaveBeenCalled()
  })

  it('never stacks two timers', async () => {
    const store = useLogsStore()
    store.setAutoRefresh(true)
    store.setAutoRefresh(true)
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_MS)
    expect(getLogs).toHaveBeenCalledTimes(1)
    store.stopAutoRefresh()
  })

  it('skips a tick while a read is still pending', async () => {
    getLogs.mockReturnValue(new Promise(() => {}))
    const store = useLogsStore()
    store.setAutoRefresh(true)
    await vi.advanceTimersByTimeAsync(AUTO_REFRESH_MS * 3)
    expect(getLogs).toHaveBeenCalledTimes(1)
    store.stopAutoRefresh()
  })
})

describe('logs store copy', () => {
  it('copies exactly the filtered lines', async () => {
    const store = useLogsStore()
    await store.load()
    store.level = 'warnings'
    await expect(store.copy()).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(`${LINES[1]}\n${LINES[2]}`)
  })

  it('copies nothing when no line is shown', async () => {
    const store = useLogsStore()
    await expect(store.copy()).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('reports a refused clipboard instead of throwing', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    const store = useLogsStore()
    await store.load()
    await expect(store.copy()).resolves.toBe(false)
  })
})

describe('logs store export', () => {
  it('sends only the selected source id and reports success', async () => {
    const store = useLogsStore()
    await store.select('tailscaled')
    await store.exportLogs()
    expect(exportLogs).toHaveBeenCalledExactlyOnceWith('tailscaled')
    expect(store.notice).toEqual({ kind: 'ok', text: 'Journal enregistré.' })
  })

  it('says nothing when the dialog is cancelled', async () => {
    exportLogs.mockResolvedValue({ ok: false, cancelled: true })
    const store = useLogsStore()
    await store.exportLogs()
    expect(store.notice).toBeNull()
  })

  it('shows the error returned by main, or a fallback when the call fails', async () => {
    exportLogs.mockResolvedValueOnce({ ok: false, error: "Aucun journal n'a encore été lu." })
    const store = useLogsStore()
    await store.exportLogs()
    expect(store.notice).toEqual({ kind: 'error', text: "Aucun journal n'a encore été lu." })

    exportLogs.mockRejectedValueOnce(new Error('ipc'))
    await store.exportLogs()
    expect(store.notice).toEqual({ kind: 'error', text: "Impossible d'enregistrer le fichier." })
  })

  it('clears the notice when the source changes', async () => {
    const store = useLogsStore()
    await store.exportLogs()
    await store.select('container:proxy-app-1')
    expect(store.notice).toBeNull()
  })
})
