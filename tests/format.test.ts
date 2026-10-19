import { describe, expect, it } from 'vitest'
import {
  formatAge,
  formatBytes,
  formatLoad,
  formatMemoryKb,
  formatPercent,
  formatRate,
  formatTemperature,
  formatUptime,
  levelLabel,
  overallLabel,
  rowDetail,
  translateServiceDetail
} from '@shared/format'

const NBSP = ' '

describe('formatUptime', () => {
  it('shows days and hours from one day on', () => {
    expect(formatUptime(344161.7)).toBe('3 j 23 h')
  })

  it('shows hours and minutes under a day', () => {
    expect(formatUptime(5 * 3600 + 12 * 60)).toBe('5 h 12 min')
  })

  it('shows minutes under an hour', () => {
    expect(formatUptime(720)).toBe('12 min')
  })

  it('handles under a minute and invalid values', () => {
    expect(formatUptime(30)).toBe("moins d'une minute")
    expect(formatUptime(null)).toBe('—')
    expect(formatUptime(-5)).toBe('—')
    expect(formatUptime(Number.NaN)).toBe('—')
  })
})

describe('formatPercent', () => {
  it('rounds to an integer with a non-breaking space', () => {
    expect(formatPercent(19.1395)).toBe(`19${NBSP}%`)
    expect(formatPercent(0)).toBe(`0${NBSP}%`)
    expect(formatPercent(99.6)).toBe(`100${NBSP}%`)
  })

  it('shows a dash when unknown', () => {
    expect(formatPercent(null)).toBe('—')
  })
})

describe('formatBytes', () => {
  it('uses decimal French units with one decimal under 100', () => {
    expect(formatBytes(2040373248)).toBe(`2,0${NBSP}Go`)
    expect(formatBytes(11490224111616)).toBe(`11,5${NBSP}To`)
  })

  it('drops the decimal from 100 on', () => {
    expect(formatBytes(980122034176)).toBe(`980${NBSP}Go`)
  })

  it('handles small values', () => {
    expect(formatBytes(0)).toBe(`0${NBSP}o`)
    expect(formatBytes(512)).toBe(`512${NBSP}o`)
  })
})

describe('formatMemoryKb', () => {
  it('converts kibibytes to Gio', () => {
    expect(formatMemoryKb(16251684)).toBe(`15,5${NBSP}Gio`)
  })

  it('shows a dash when unknown', () => {
    expect(formatMemoryKb(null)).toBe('—')
  })
})

describe('formatRate', () => {
  it('shows a throughput in decimal French units per second', () => {
    expect(formatRate(10000)).toBe(`10,0${NBSP}Ko/s`)
    expect(formatRate(2500000)).toBe(`2,5${NBSP}Mo/s`)
    expect(formatRate(125000000)).toBe(`125${NBSP}Mo/s`)
  })

  it('handles an idle or tiny flow', () => {
    expect(formatRate(0)).toBe(`0${NBSP}o/s`)
    expect(formatRate(0.4)).toBe(`0${NBSP}o/s`)
    expect(formatRate(512)).toBe(`512${NBSP}o/s`)
  })

  it('shows a dash when unknown', () => {
    expect(formatRate(null)).toBe('—')
  })
})

describe('formatTemperature', () => {
  it('rounds to whole degrees', () => {
    expect(formatTemperature(55)).toBe(`55${NBSP}°C`)
    expect(formatTemperature(61.5)).toBe(`62${NBSP}°C`)
  })

  it('shows a dash when unknown', () => {
    expect(formatTemperature(null)).toBe('—')
  })
})

describe('formatLoad', () => {
  it('shows the three averages with French decimals', () => {
    expect(formatLoad({ load1: 0.07, load5: 0.08, load15: 0.08 })).toBe('0,07 / 0,08 / 0,08')
    expect(formatLoad(null)).toBe('—')
  })
})

describe('formatAge', () => {
  const now = 1_000_000

  it('describes how long ago the data was fetched', () => {
    expect(formatAge(now - 2_000, now)).toBe("à l'instant")
    expect(formatAge(now - 12_000, now)).toBe('il y a 12 s')
    expect(formatAge(now - 5 * 60_000, now)).toBe('il y a 5 min')
    expect(formatAge(now - 2 * 3_600_000, now)).toBe('il y a 2 h')
  })

  it('handles missing data and clock skew', () => {
    expect(formatAge(null, now)).toBe('jamais')
    expect(formatAge(now + 5_000, now)).toBe("à l'instant")
  })
})

describe('labels', () => {
  it('names every service level', () => {
    expect(levelLabel('ok')).toBe('Actif')
    expect(levelLabel('degraded')).toBe('Dégradé')
    expect(levelLabel('down')).toBe('Arrêté')
    expect(levelLabel('absent')).toBe('Introuvable')
    expect(levelLabel('unknown')).toBe('Inconnu')
    expect(levelLabel('stopped')).toBe('Inactif')
  })

  it('names every overall state', () => {
    expect(overallLabel('ok')).toBe('Tout va bien')
    expect(overallLabel('degraded')).toBe('Attention')
    expect(overallLabel('down')).toBe('Panne')
    expect(overallLabel('offline')).toBe('Hors ligne')
    expect(overallLabel('pending')).toBe('Chargement…')
    expect(overallLabel('unconfigured')).toBe('À configurer')
  })
})

describe('translateServiceDetail (docker and systemd status texts)', () => {
  it('translates running containers with their duration', () => {
    expect(translateServiceDetail('Up 4 days')).toBe('Actif depuis 4 jours')
    expect(translateServiceDetail('Up 1 day')).toBe('Actif depuis 1 jour')
    expect(translateServiceDetail('Up 2 months')).toBe('Actif depuis 2 mois')
    expect(translateServiceDetail('Up 3 weeks')).toBe('Actif depuis 3 semaines')
    expect(translateServiceDetail('Up 1 year')).toBe('Actif depuis 1 an')
    expect(translateServiceDetail('Up About an hour')).toBe('Actif depuis environ 1 heure')
    expect(translateServiceDetail('Up About a minute')).toBe('Actif depuis environ 1 minute')
    expect(translateServiceDetail('Up Less than a second')).toBe("Actif depuis moins d'une seconde")
  })

  it('translates the health status', () => {
    expect(translateServiceDetail('Up 4 days (healthy)')).toBe('Actif depuis 4 jours, sain')
    expect(translateServiceDetail('Up 4 days (unhealthy)')).toBe('Actif depuis 4 jours, non sain')
    expect(translateServiceDetail('Up 3 seconds (health: starting)')).toBe(
      'Actif depuis 3 secondes, démarrage'
    )
    expect(translateServiceDetail('Up 2 hours (Paused)')).toBe('Actif depuis 2 heures, en pause')
  })

  it('translates exited and restarting containers', () => {
    expect(translateServiceDetail('Exited (137) 2 months ago')).toBe(
      'Arrêté (code 137) il y a 2 mois'
    )
    expect(translateServiceDetail('Exited (0) 5 minutes ago')).toBe(
      'Arrêté (code 0) il y a 5 minutes'
    )
    expect(translateServiceDetail('Restarting (1) 5 seconds ago')).toBe(
      'Redémarre en boucle (code 1) il y a 5 secondes'
    )
  })

  it('translates systemd states', () => {
    expect(translateServiceDetail('active (running)')).toBe('actif (en cours)')
    expect(translateServiceDetail('inactive (dead)')).toBe('inactif (arrêté)')
    expect(translateServiceDetail('failed (failed)')).toBe('en échec (en échec)')
  })

  it('leaves unrecognised or already French texts unchanged', () => {
    expect(translateServiceDetail('Conteneur introuvable')).toBe('Conteneur introuvable')
    expect(translateServiceDetail('Lecture Docker impossible')).toBe('Lecture Docker impossible')
    expect(translateServiceDetail('Up a while')).toBe('Up a while')
    expect(translateServiceDetail('')).toBe('')
  })
})

describe('rowDetail (sub-line of a service row)', () => {
  it('drops the state word that the row already shows on its right', () => {
    expect(rowDetail('Up 4 days')).toBe('Depuis 4 jours')
    expect(rowDetail('Up 4 days (healthy)')).toBe('Depuis 4 jours, sain')
    expect(rowDetail('Up 4 days (unhealthy)')).toBe('Depuis 4 jours, non sain')
    expect(rowDetail('active (running)')).toBe('En cours')
  })

  it('keeps texts that carry information the state word does not', () => {
    expect(rowDetail('Exited (137) 2 months ago')).toBe('Arrêté (code 137) il y a 2 mois')
    expect(rowDetail('inactive (dead)')).toBe('inactif (arrêté)')
    expect(rowDetail('Conteneur introuvable')).toBe('Conteneur introuvable')
  })
})
