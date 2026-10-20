export type MobileTab = 'services' | 'system' | 'history'

/** In display order: also the order a swipe walks through. */
export const MOBILE_TABS: readonly { id: MobileTab; label: string }[] = [
  { id: 'services', label: 'Services' },
  { id: 'system', label: 'Système' },
  { id: 'history', label: 'Historique' }
]

/** A swipe must travel at least this far sideways... */
export const SWIPE_MIN_PX = 60
/** ...and mostly sideways: a vertical drift above this ratio of the sideways one is a scroll. */
const SWIPE_MAX_SLOPE = 1.5
/** A touch starting this close to a side edge belongs to Android's back gesture. */
export const EDGE_GUARD_PX = 24

const isTab = (value: string): value is MobileTab => MOBILE_TABS.some((tab) => tab.id === value)

/** The tab a swipe of (`dx`, `dy`) leads to, or `null` when it is not a swipe or there is none. */
export function swipeTarget(current: MobileTab, dx: number, dy: number): MobileTab | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * SWIPE_MAX_SLOPE) return null
  const index = MOBILE_TABS.findIndex((tab) => tab.id === current)
  // Finger to the left brings the next tab, as with a page of a book.
  return MOBILE_TABS[index + (dx < 0 ? 1 : -1)]?.id ?? null
}

/** Whether a touch beginning at `x` (of a screen `width` wide) may start a swipe. */
export function isSwipeStart(x: number, width: number): boolean {
  return x >= EDGE_GUARD_PX && x <= width - EDGE_GUARD_PX
}

/** The tab named by `location.hash`; anything unknown opens the first. */
export function tabFromHash(hash: string): MobileTab {
  const name = hash.startsWith('#') ? hash.slice(1) : ''
  return isTab(name) ? name : 'services'
}
