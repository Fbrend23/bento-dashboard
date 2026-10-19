import { describe, expect, it } from 'vitest'
import { systemFigures } from '../src/mobile/src/system'
import { disk, metrics } from './helpers/status'

describe('systemFigures', () => {
  it('lists processor, memory, uptime and load with their French labels', () => {
    const { rows } = systemFigures(metrics())
    expect(rows.map((row) => row.label)).toEqual([
      'Processeur',
      'Mémoire',
      'Disponibilité',
      'Charge'
    ])
    expect(rows[0].value).toBe('5 %')
    expect(rows[1].value).toContain('20 %')
    expect(rows[1].value).toContain('Gio')
    expect(rows[2].value).toBe('16 min')
    expect(rows[3].value).toBe('0,10 / 0,10 / 0,10')
  })

  it('shows a dash for what is not known yet', () => {
    const { rows } = systemFigures({ ...metrics(), cpuPercent: null, load: null })
    expect(rows[0].value).toBe('—')
    expect(rows[3].value).toBe('—')
  })

  it('adds the temperature only when the server exposes one', () => {
    expect(systemFigures(metrics()).rows.some((row) => row.label === 'Température')).toBe(false)
    const hot = systemFigures({ ...metrics(), temperatureC: 54.2 }).rows
    expect(hot.find((row) => row.label === 'Température')?.value).toBe('54 °C')
  })

  it('gives each disk its mount, its fill and whether it is over the threshold', () => {
    const { disks } = systemFigures(
      metrics([disk(), disk({ mount: '/data', usedPercent: 91, overThreshold: true })])
    )
    expect(disks).toHaveLength(2)
    expect(disks[0]).toMatchObject({ mount: '/', percent: 30, alert: false })
    expect(disks[1]).toMatchObject({ mount: '/data', percent: 91, alert: true })
    expect(disks[1].value).toContain('91 %')
  })
})
