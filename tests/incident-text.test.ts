import { describe, expect, it } from 'vitest'
import type { Incident } from '@shared/history'
import { describeIncident, formatSpan } from '@shared/incident-text'
import { formatMoment } from '@shared/chart'

const at = (h: number, m = 0, d = 16): number => new Date(2026, 9, d, h, m).getTime()

const incident = (patch: Partial<Incident> = {}): Incident => ({
  key: 'service-down:series',
  kind: 'service-down',
  subject: 'Series',
  startedAt: at(14, 0),
  endedAt: at(14, 12),
  ...patch
})

describe('formatMoment', () => {
  it('shows the day and the time to the minute', () => {
    expect(formatMoment(at(14, 5))).toBe('ven. 16 · 14:05')
    expect(formatMoment(at(0, 0, 12))).toBe('lun. 12 · 00:00')
  })
})

describe('formatSpan', () => {
  it.each([
    [0, "moins d'une minute"],
    [59_000, "moins d'une minute"],
    [60_000, '1 min'],
    [12 * 60_000, '12 min'],
    [59 * 60_000, '59 min'],
    [60 * 60_000, '1 h'],
    [(2 * 60 + 5) * 60_000, '2 h 05'],
    [26 * 3_600_000, '1 j 2 h'],
    [3 * 86_400_000, '3 j']
  ])('writes %d ms as "%s"', (ms, expected) => {
    expect(formatSpan(ms)).toBe(expected)
  })

  it('never goes negative', () => {
    expect(formatSpan(-5000)).toBe("moins d'une minute")
  })
})

describe('describeIncident (closed)', () => {
  it('says what happened, when, and for how long', () => {
    expect(describeIncident(incident(), at(15))).toEqual({
      title: "Series était à l'arrêt",
      when: 'ven. 16 · 14:00',
      duration: 'pendant 12 min',
      open: false
    })
  })

  it('words each kind of incident', () => {
    expect(
      describeIncident(
        incident({ kind: 'unreachable', subject: 'bento', key: 'unreachable:bento' }),
        at(15)
      ).title
    ).toBe('Bento était injoignable')
    expect(
      describeIncident(
        incident({ kind: 'disk-full', subject: '/mnt/media', key: 'disk-full:/mnt/media' }),
        at(15)
      ).title
    ).toBe('Disque /mnt/media presque plein')
  })
})

describe('describeIncident (still going)', () => {
  it('is in the present tense, with the time elapsed so far', () => {
    expect(describeIncident(incident({ endedAt: null }), at(14, 30))).toEqual({
      title: "Series est à l'arrêt",
      when: 'ven. 16 · 14:00',
      duration: 'depuis 30 min',
      open: true
    })
  })

  it('words each kind in the present', () => {
    expect(
      describeIncident(incident({ kind: 'unreachable', subject: 'bento', endedAt: null }), at(15))
        .title
    ).toBe('Bento est injoignable')
    expect(
      describeIncident(incident({ kind: 'disk-full', subject: '/', endedAt: null }), at(15)).title
    ).toBe('Disque / presque plein')
  })

  it('shows a very recent one as lasting less than a minute', () => {
    expect(describeIncident(incident({ endedAt: null }), at(14, 0)).duration).toBe(
      "depuis moins d'une minute"
    )
  })
})
