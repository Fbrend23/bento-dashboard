import { describe, expect, it } from 'vitest'
import { inQuietHours } from '../src/main/notifications/quiet-hours'

const at = (hour: number, minute = 0): number => new Date(2026, 9, 16, hour, minute).getTime()

describe('inQuietHours (crossing midnight)', () => {
  it.each([
    [22, 0, true], // the start is included
    [23, 30, true],
    [0, 0, true],
    [3, 15, true],
    [6, 59, true],
    [7, 0, false], // the end is excluded
    [12, 0, false],
    [21, 59, false]
  ])('22:00 to 07:00 at %i:%i is %s', (hour, minute, expected) => {
    expect(inQuietHours(at(hour, minute), '22:00', '07:00')).toBe(expected)
  })
})

describe('inQuietHours (same day)', () => {
  it.each([
    [13, 0, true],
    [13, 59, true],
    [14, 0, false],
    [12, 59, false],
    [0, 0, false]
  ])('13:00 to 14:00 at %i:%i is %s', (hour, minute, expected) => {
    expect(inQuietHours(at(hour, minute), '13:00', '14:00')).toBe(expected)
  })
})

describe('inQuietHours (edge cases)', () => {
  it('is never on when the start and the end are the same', () => {
    expect(inQuietHours(at(0), '08:00', '08:00')).toBe(false)
    expect(inQuietHours(at(8), '08:00', '08:00')).toBe(false)
    expect(inQuietHours(at(20), '08:00', '08:00')).toBe(false)
  })

  it('is never on for an unreadable time', () => {
    expect(inQuietHours(at(23), '', '07:00')).toBe(false)
    expect(inQuietHours(at(23), '22:00', 'x')).toBe(false)
    expect(inQuietHours(at(23), '24:00', '07:00')).toBe(false)
  })

  it('works to the minute', () => {
    expect(inQuietHours(at(22, 30), '22:30', '22:31')).toBe(true)
    expect(inQuietHours(at(22, 31), '22:30', '22:31')).toBe(false)
  })
})
