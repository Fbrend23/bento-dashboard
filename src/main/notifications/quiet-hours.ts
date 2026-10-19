const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/

function minutesOfDay(text: string): number | null {
  const match = text.match(TIME_OF_DAY)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/**
 * True when `now` (ms since epoch, read in local time) falls in [start, end). The period may cross
 * midnight ("22:00" to "07:00"). Equal or unreadable bounds mean there are no quiet hours.
 */
export function inQuietHours(now: number, start: string, end: string): boolean {
  const from = minutesOfDay(start)
  const to = minutesOfDay(end)
  if (from === null || to === null || from === to) return false

  const date = new Date(now)
  const minute = date.getHours() * 60 + date.getMinutes()
  return from < to ? minute >= from && minute < to : minute >= from || minute < to
}
