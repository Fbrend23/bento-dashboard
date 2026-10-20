import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { BentoStatus } from '@shared/monitors'
import { IPC_CHANNELS } from '@shared/ipc'
import { createHandlers, getAppInfo } from '../src/main/ipc'
import { buildBentoApi } from '../src/preload/api'

const fakeUpdates = (): Parameters<typeof createHandlers>[2] => ({
  state: { phase: 'idle', currentVersion: '1.0.0' } as never,
  check: vi.fn().mockResolvedValue(undefined),
  download: vi.fn().mockResolvedValue(undefined),
  install: vi.fn()
})

const status = { connection: 'online', overall: 'ok' } as BentoStatus

describe('getAppInfo', () => {
  it('returns the app name and version', () => {
    const info = getAppInfo({ getName: () => 'Bento Dashboard', getVersion: () => '1.2.3' })
    expect(info).toEqual({ name: 'Bento Dashboard', version: '1.2.3' })
  })
})

describe('createHandlers', () => {
  const service = {
    status,
    refresh: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockReturnValue(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockResolvedValue({ ok: true, settings: DEFAULT_SETTINGS }),
    getLogs: vi.fn().mockResolvedValue({ ok: true, lines: ['x'], fetchedAt: 1 }),
    containerAction: vi.fn().mockResolvedValue({ ok: true }),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    getHistory: vi.fn().mockReturnValue(null),
    forgetContainer: vi.fn(),
    openContainerPort: vi.fn().mockResolvedValue({ ok: true }),
    exportLogs: vi.fn().mockResolvedValue({ ok: true })
  }
  const updates = fakeUpdates()
  const handlers = createHandlers(
    service,
    { getName: () => 'Bento Dashboard', getVersion: () => '1.0.0' },
    updates
  )

  it('handles exactly the invokable channels', () => {
    expect(Object.keys(handlers).sort()).toEqual(
      [
        IPC_CHANNELS.getAppInfo,
        IPC_CHANNELS.getStatus,
        IPC_CHANNELS.refresh,
        IPC_CHANNELS.getSettings,
        IPC_CHANNELS.saveSettings,
        IPC_CHANNELS.testConnection,
        IPC_CHANNELS.getLogs,
        IPC_CHANNELS.getHistory,
        IPC_CHANNELS.exportLogs,
        IPC_CHANNELS.containerAction,
        IPC_CHANNELS.forgetContainer,
        IPC_CHANNELS.openContainerPort,
        IPC_CHANNELS.getUpdateState,
        IPC_CHANNELS.checkUpdate,
        IPC_CHANNELS.downloadUpdate,
        IPC_CHANNELS.installUpdate
      ].sort()
    )
  })

  it('serves app info, status and settings', () => {
    expect(handlers[IPC_CHANNELS.getAppInfo]()).toEqual({
      name: 'Bento Dashboard',
      version: '1.0.0'
    })
    expect(handlers[IPC_CHANNELS.getStatus]()).toBe(status)
    expect(handlers[IPC_CHANNELS.getSettings]()).toEqual(DEFAULT_SETTINGS)
  })

  it('forwards an untrusted draft to the connection test, which validates it', async () => {
    const draft = { host: '-oProxyCommand=calc', evil: true }
    await handlers[IPC_CHANNELS.testConnection](draft)
    expect(service.testConnection).toHaveBeenCalledExactlyOnceWith(draft)
  })

  it('forwards the untrusted range to the history, which validates it', () => {
    handlers[IPC_CHANNELS.getHistory]('7d')
    handlers[IPC_CHANNELS.getHistory]({ evil: true })
    expect(service.getHistory).toHaveBeenNthCalledWith(1, '7d')
    expect(service.getHistory).toHaveBeenNthCalledWith(2, { evil: true })
  })

  it('refresh triggers a poll', async () => {
    await handlers[IPC_CHANNELS.refresh]()
    expect(service.refresh).toHaveBeenCalledTimes(1)
  })

  it('forwards untrusted settings to the service, which validates them', async () => {
    const untrusted = { port: 'oops', evil: true }
    await expect(handlers[IPC_CHANNELS.saveSettings](untrusted)).resolves.toEqual({
      ok: true,
      settings: DEFAULT_SETTINGS
    })
    expect(service.saveSettings).toHaveBeenCalledExactlyOnceWith(untrusted)
  })
})

describe('createHandlers logs and restart', () => {
  const service = {
    status,
    refresh: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    getLogs: vi.fn().mockResolvedValue({ ok: true, lines: [], fetchedAt: 1 }),
    containerAction: vi.fn().mockResolvedValue({ ok: true }),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    getHistory: vi.fn().mockReturnValue(null),
    forgetContainer: vi.fn(),
    openContainerPort: vi.fn().mockResolvedValue({ ok: true }),
    exportLogs: vi.fn().mockResolvedValue({ ok: true })
  }
  const handlers = createHandlers(
    service,
    { getName: () => 'x', getVersion: () => '1' },
    fakeUpdates()
  )

  it('forwards the untrusted source id to the service, which validates it', async () => {
    await handlers[IPC_CHANNELS.getLogs]('jellyfin')
    await handlers[IPC_CHANNELS.getLogs]({ evil: true })
    expect(service.getLogs).toHaveBeenNthCalledWith(1, 'jellyfin')
    expect(service.getLogs).toHaveBeenNthCalledWith(2, { evil: true })
  })

  it('forwards the untrusted argument as is to the export, which validates it', async () => {
    await handlers[IPC_CHANNELS.exportLogs]({ path: '/etc/passwd' })
    expect(service.exportLogs).toHaveBeenCalledExactlyOnceWith({ path: '/etc/passwd' })
  })

  it('forwards the untrusted action and container to the service, which validates them', async () => {
    await handlers[IPC_CHANNELS.containerAction]({
      action: 'restart',
      container: 'series',
      command: 'rm -rf /'
    })
    expect(service.containerAction).toHaveBeenCalledExactlyOnceWith('restart', 'series')
  })

  it('passes nothing usable on when the container action payload is not an object', async () => {
    service.containerAction.mockClear()
    await handlers[IPC_CHANNELS.containerAction]('restart jellyfin')
    await handlers[IPC_CHANNELS.containerAction](null)
    await handlers[IPC_CHANNELS.containerAction]()
    expect(service.containerAction).toHaveBeenCalledTimes(3)
    for (const call of service.containerAction.mock.calls)
      expect(call).toEqual([undefined, undefined])
  })

  it('forwards the untrusted container name to the service, which validates it', () => {
    handlers[IPC_CHANNELS.forgetContainer]('stream')
    handlers[IPC_CHANNELS.forgetContainer]({ evil: true })
    expect(service.forgetContainer).toHaveBeenNthCalledWith(1, 'stream')
    expect(service.forgetContainer).toHaveBeenNthCalledWith(2, { evil: true })
  })

  it('opens a port from a container name and a port number, never from a url', async () => {
    await handlers[IPC_CHANNELS.openContainerPort]({
      container: 'jellyfin',
      hostPort: 8096,
      url: 'http://evil'
    })
    expect(service.openContainerPort).toHaveBeenCalledExactlyOnceWith('jellyfin', 8096)
  })

  it('passes nothing usable on when the payload is not an object', async () => {
    service.openContainerPort.mockClear()
    await handlers[IPC_CHANNELS.openContainerPort]('http://evil')
    await handlers[IPC_CHANNELS.openContainerPort](null)
    expect(service.openContainerPort).toHaveBeenNthCalledWith(1, undefined, undefined)
    expect(service.openContainerPort).toHaveBeenNthCalledWith(2, undefined, undefined)
  })
})

describe('createHandlers updates', () => {
  const service = {
    status,
    refresh: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    getLogs: vi.fn(),
    containerAction: vi.fn(),
    testConnection: vi.fn(),
    getHistory: vi.fn(),
    forgetContainer: vi.fn(),
    openContainerPort: vi.fn(),
    exportLogs: vi.fn().mockResolvedValue({ ok: true })
  }
  const setup = (): {
    updates: ReturnType<typeof fakeUpdates>
    handlers: ReturnType<typeof createHandlers>
  } => {
    const updates = fakeUpdates()
    return {
      updates,
      handlers: createHandlers(service, { getName: () => 'x', getVersion: () => '1' }, updates)
    }
  }

  it('serves the update state', () => {
    const { handlers, updates } = setup()
    expect(handlers[IPC_CHANNELS.getUpdateState]()).toBe(updates.state)
  })

  it('check, download and install take no argument from the renderer', async () => {
    const { handlers, updates } = setup()
    await handlers[IPC_CHANNELS.checkUpdate]('x')
    await handlers[IPC_CHANNELS.downloadUpdate]('x')
    handlers[IPC_CHANNELS.installUpdate]('x')
    expect(updates.check).toHaveBeenCalledExactlyOnceWith()
    expect(updates.download).toHaveBeenCalledExactlyOnceWith()
    expect(updates.install).toHaveBeenCalledExactlyOnceWith()
  })
})

describe('buildBentoApi', () => {
  const setup = (): {
    invoke: ReturnType<typeof vi.fn>
    subscribe: ReturnType<typeof vi.fn>
    api: ReturnType<typeof buildBentoApi>
  } => {
    const invoke = vi.fn().mockResolvedValue('result')
    const subscribe = vi.fn().mockReturnValue(vi.fn())
    return { invoke, subscribe, api: buildBentoApi(invoke, subscribe) }
  }

  it('exposes exactly the whitelisted functions', () => {
    expect(Object.keys(setup().api).sort()).toEqual([
      'checkForUpdate',
      'containerAction',
      'downloadUpdate',
      'exportLogs',
      'forgetContainer',
      'getAppInfo',
      'getHistory',
      'getLogs',
      'getSettings',
      'getStatus',
      'getUpdateState',
      'installUpdate',
      'onNavigate',
      'onStatus',
      'onUpdate',
      'openContainerPort',
      'refresh',
      'saveSettings',
      'testConnection'
    ])
  })

  it.each([
    ['getAppInfo', IPC_CHANNELS.getAppInfo],
    ['getStatus', IPC_CHANNELS.getStatus],
    ['refresh', IPC_CHANNELS.refresh],
    ['getSettings', IPC_CHANNELS.getSettings],
    ['getUpdateState', IPC_CHANNELS.getUpdateState],
    ['checkForUpdate', IPC_CHANNELS.checkUpdate],
    ['downloadUpdate', IPC_CHANNELS.downloadUpdate],
    ['installUpdate', IPC_CHANNELS.installUpdate]
  ] as const)('%s invokes its channel without arguments', async (method, channel) => {
    const { api, invoke } = setup()
    await expect(api[method]()).resolves.toBe('result')
    expect(invoke).toHaveBeenCalledExactlyOnceWith(channel)
  })

  it('saveSettings sends the settings on its channel', async () => {
    const { api, invoke } = setup()
    await api.saveSettings(DEFAULT_SETTINGS)
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.saveSettings, DEFAULT_SETTINGS)
  })

  it('testConnection sends the draft settings on its channel', async () => {
    const { api, invoke } = setup()
    await api.testConnection(DEFAULT_SETTINGS)
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.testConnection, DEFAULT_SETTINGS)
  })

  it('getHistory sends only the range on its channel', async () => {
    const { api, invoke } = setup()
    await api.getHistory('1h')
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.getHistory, '1h')
  })

  it('getLogs sends only the source id on its channel', async () => {
    const { api, invoke } = setup()
    await api.getLogs('tailscaled')
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.getLogs, 'tailscaled')
  })

  it('containerAction sends only the action and the container on its channel', async () => {
    const { api, invoke } = setup()
    await api.containerAction('stop', 'series')
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.containerAction, {
      action: 'stop',
      container: 'series'
    })
  })

  it('forgetContainer sends only the container name on its channel', async () => {
    const { api, invoke } = setup()
    await api.forgetContainer('stream')
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.forgetContainer, 'stream')
  })

  it('openContainerPort sends only the container and the port on its channel', async () => {
    const { api, invoke } = setup()
    await api.openContainerPort('jellyfin', 8096)
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.openContainerPort, {
      container: 'jellyfin',
      hostPort: 8096
    })
  })

  it('exportLogs sends only the source id on its channel', async () => {
    const { api, invoke } = setup()
    await api.exportLogs('container:jellyfin')
    expect(invoke).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.exportLogs, 'container:jellyfin')
  })

  it('onNavigate subscribes to the navigate push channel and forwards known views only', () => {
    const { api, subscribe } = setup()
    const listener = vi.fn()
    api.onNavigate(listener)
    const [channel, handler] = subscribe.mock.calls[0]
    expect(channel).toBe(IPC_CHANNELS.navigate)

    handler('logs')
    handler('admin')
    handler({ view: 'logs' })
    handler(undefined)
    expect(listener).toHaveBeenCalledExactlyOnceWith('logs')
  })

  it('onUpdate subscribes to the update push channel', () => {
    const { api, subscribe } = setup()
    const listener = vi.fn()
    api.onUpdate(listener)
    const [channel, handler] = subscribe.mock.calls[0]
    expect(channel).toBe(IPC_CHANNELS.updateChanged)
    handler({ phase: 'ready' })
    expect(listener).toHaveBeenCalledExactlyOnceWith({ phase: 'ready' })
  })

  it('onStatus subscribes to the push channel and forwards payloads', () => {
    const { api, subscribe } = setup()
    const listener = vi.fn()
    api.onStatus(listener)

    expect(subscribe).toHaveBeenCalledTimes(1)
    const [channel, handler] = subscribe.mock.calls[0]
    expect(channel).toBe(IPC_CHANNELS.statusChanged)
    handler(status)
    expect(listener).toHaveBeenCalledExactlyOnceWith(status)
  })

  it('onStatus returns the unsubscribe function', () => {
    const unsubscribe = vi.fn()
    const api = buildBentoApi(vi.fn(), vi.fn().mockReturnValue(unsubscribe))
    api.onStatus(vi.fn())()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
