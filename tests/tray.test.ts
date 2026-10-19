import { describe, expect, it } from 'vitest'
import { renderTrayIcon, rgbaToBgra, TONE_COLORS } from '../src/main/tray/icon'
import { buildTrayMenu, buildTrayTooltip } from '../src/main/tray/menu'
import { disk, metrics, service, status, tailscale } from './helpers/status'

const pixel = (icon: ReturnType<typeof renderTrayIcon>, x: number, y: number): number[] => {
  const i = (y * icon.width + x) * 4
  return [...icon.data.subarray(i, i + 4)]
}

describe('renderTrayIcon', () => {
  const ok = renderTrayIcon('ok')

  it('produces a 32x32 RGBA bitmap', () => {
    expect(ok.width).toBe(32)
    expect(ok.height).toBe(32)
    expect(ok.data).toHaveLength(32 * 32 * 4)
  })

  it('fills the compartments with the tone colour', () => {
    const [r, g, b] = TONE_COLORS.ok
    expect(pixel(ok, 6, 6)).toEqual([r, g, b, 255])
    expect(pixel(ok, 24, 6)).toEqual([r, g, b, 255])
    expect(pixel(ok, 24, 24)).toEqual([r, g, b, 255])
  })

  it('draws the partitions in white so the icon reads on any taskbar', () => {
    expect(pixel(ok, 15, 6)).toEqual([255, 255, 255, 255])
    expect(pixel(ok, 16, 24)).toEqual([255, 255, 255, 255])
    expect(pixel(ok, 24, 15)).toEqual([255, 255, 255, 255])
  })

  it('keeps the left compartment unbroken by the horizontal partition', () => {
    expect(pixel(ok, 6, 15)).toEqual([...TONE_COLORS.ok, 255])
  })

  it('is transparent outside the rounded tray, including the corners', () => {
    expect(pixel(ok, 0, 0)[3]).toBe(0)
    expect(pixel(ok, 31, 31)[3]).toBe(0)
    expect(pixel(ok, 2, 2)[3]).toBe(0)
  })

  it('uses a distinct colour for each tone', () => {
    const colours = (['ok', 'warn', 'danger', 'idle'] as const).map((t) =>
      pixel(renderTrayIcon(t), 6, 6).join(',')
    )
    expect(new Set(colours).size).toBe(4)
  })
})

describe('rgbaToBgra', () => {
  it('swaps the red and blue channels for Electron bitmaps', () => {
    const rgba = Buffer.from([10, 20, 30, 255, 1, 2, 3, 0])
    expect([...rgbaToBgra(rgba)]).toEqual([30, 20, 10, 255, 3, 2, 1, 0])
  })

  it('does not modify its input', () => {
    const rgba = Buffer.from([10, 20, 30, 255])
    rgbaToBgra(rgba)
    expect([...rgba]).toEqual([10, 20, 30, 255])
  })
})

describe('buildTrayMenu', () => {
  it('summarises the state, then offers open, logs, refresh, restart and quit', () => {
    expect(buildTrayMenu(status())).toEqual([
      { label: 'Bento va bien.', enabled: false },
      { label: 'Tous les services répondent.', enabled: false },
      { type: 'separator' },
      { id: 'open', label: 'Ouvrir Bento' },
      { id: 'logs', label: 'Journaux' },
      { id: 'refresh', label: 'Actualiser', enabled: true },
      {
        label: 'Redémarrer un conteneur',
        enabled: true,
        submenu: [{ label: 'jellyfin', container: 'jellyfin' }]
      },
      { type: 'separator' },
      { id: 'quit', label: 'Quitter' }
    ])
  })

  it('lists what is wrong', () => {
    const down = status({
      overall: 'down',
      services: [service({ level: 'down', detail: 'Exited (137) 3 minutes ago' }), tailscale()]
    })
    const labels = buildTrayMenu(down).map((item) => item.label)
    expect(labels.slice(0, 2)).toEqual([
      "Un service est à l'arrêt.",
      'jellyfin : Arrêté (code 137) il y a 3 minutes'
    ])
  })

  it('caps the number of lines and says how many were left out', () => {
    const many = status({
      overall: 'down',
      services: Array.from({ length: 8 }, (_, i) =>
        service({ id: `c${i}`, label: `c${i}`, level: 'down', detail: 'Exited (0) 1 minute ago' })
      )
    })
    const summary = buildTrayMenu(many).filter((item) => item.enabled === false)
    expect(summary).toHaveLength(1 + 5 + 1)
    expect(summary.at(-1)?.label).toBe('et 3 autres…')
  })

  it('disables refresh while offline', () => {
    const items = buildTrayMenu(status({ connection: 'offline', overall: 'offline' }))
    expect(items.find((item) => item.id === 'refresh')?.enabled).toBe(false)
  })

  it('shows a configure hint before bento is set up', () => {
    const items = buildTrayMenu(
      status({
        configured: false,
        connection: 'offline',
        overall: 'unconfigured',
        services: [],
        metrics: null
      })
    )
    expect(items[0].label).toBe("Bento n'est pas encore configuré.")
  })

  it('mentions a disk over its threshold', () => {
    const items = buildTrayMenu(
      status({
        overall: 'degraded',
        metrics: metrics([disk({ mount: '/data', usedPercent: 90, overThreshold: true })])
      })
    )
    expect(items.some((item) => item.label?.startsWith('Le disque /data'))).toBe(true)
  })
})

describe('buildTrayTooltip', () => {
  it('shows the verdict and its first detail', () => {
    expect(buildTrayTooltip(status())).toBe('Bento va bien. Tous les services répondent.')
  })

  it('shows only the verdict when there is no detail', () => {
    const pending = status({ overall: 'pending', services: [], metrics: null })
    expect(buildTrayTooltip(pending)).toBe('Première lecture en cours…')
  })

  it('stays within the 127 characters Windows displays', () => {
    const long = status({
      overall: 'down',
      services: [
        service({ label: 'x'.repeat(200), level: 'down', detail: 'Exited (0) 1 minute ago' })
      ]
    })
    const tooltip = buildTrayTooltip(long)
    expect(tooltip.length).toBeLessThanOrEqual(127)
    expect(tooltip.endsWith('…')).toBe(true)
  })

  it('has a neutral text when there is no status yet', () => {
    expect(buildTrayTooltip(null)).toBe('Bento')
  })
})

describe('buildTrayMenu (restart submenu)', () => {
  const restartMenu = (
    s: ReturnType<typeof status>
  ): ReturnType<typeof buildTrayMenu>[number] | undefined =>
    buildTrayMenu(s).find((item) => item.submenu !== undefined)

  const running = (id: string, label = id): ReturnType<typeof service> =>
    service({ id, label, level: 'ok', state: 'running' })

  it('lists the containers that can be restarted, by name, with their friendly label', () => {
    const s = status({
      services: [running('series', 'Series'), running('subtitles', 'Subtitles'), tailscale()]
    })
    expect(restartMenu(s)?.submenu).toEqual([
      { label: 'Series', container: 'series' },
      { label: 'Subtitles', container: 'subtitles' }
    ])
  })

  it('includes a container that keeps crashing, which is the one to restart', () => {
    const s = status({
      services: [service({ id: 'loop', label: 'loop', level: 'down', state: 'restarting' })]
    })
    expect(restartMenu(s)?.submenu).toEqual([{ label: 'loop', container: 'loop' }])
  })

  it('leaves out stopped, paused and unreadable containers and the systemd unit', () => {
    const s = status({
      services: [
        running('up'),
        service({ id: 'off', label: 'off', level: 'stopped', state: 'exited' }),
        service({ id: 'paused', label: 'paused', level: 'down', state: 'paused' }),
        service({ id: 'docker', label: 'Docker', level: 'unknown', state: null }),
        tailscale()
      ]
    })
    expect(restartMenu(s)?.submenu?.map((i) => i.container)).toEqual(['up'])
  })

  it('has no restart entry when nothing can be restarted', () => {
    const s = status({
      services: [service({ id: 'off', label: 'off', level: 'stopped', state: 'exited' })]
    })
    expect(restartMenu(s)).toBeUndefined()
    expect(buildTrayMenu(s).some((item) => item.id === 'logs')).toBe(true)
  })

  it('is disabled while bento is unreachable', () => {
    const s = status({ connection: 'offline', overall: 'offline' })
    expect(restartMenu(s)?.enabled).toBe(false)
  })

  it('caps a long list and says how many were left out', () => {
    const s = status({
      services: Array.from({ length: 24 }, (_, i) => running(`c${String(i).padStart(2, '0')}`))
    })
    const submenu = restartMenu(s)?.submenu ?? []
    expect(submenu).toHaveLength(21)
    expect(submenu.at(-1)).toEqual({ label: 'et 4 autres…', enabled: false })
    expect(submenu.slice(0, 20).every((i) => i.container !== undefined)).toBe(true)
  })

  it('only ever carries container names that the status listed', () => {
    const s = status({ services: [running('series'), running('movies'), tailscale()] })
    const names = restartMenu(s)?.submenu?.map((i) => i.container)
    expect(names?.every((n) => ['series', 'movies'].includes(n as string))).toBe(true)
  })
})
