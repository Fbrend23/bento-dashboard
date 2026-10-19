import type { Tone } from '@shared/verdict'

/** Tones are brighter than in the window so they read on dark and light taskbars alike. */
export const TONE_COLORS: Record<Tone, readonly [number, number, number]> = {
  ok: [47, 178, 109],
  warn: [240, 181, 69],
  danger: [232, 72, 52],
  idle: [141, 160, 151]
}

const SIZE = 32
const EDGE = 1
const RADIUS = 7
/** The partitions are 2 px wide: columns/rows 15 and 16. */
const isPartition = (n: number): boolean => n === 15 || n === 16

function insideTray(x: number, y: number): boolean {
  const px = x + 0.5
  const py = y + 0.5
  const min = EDGE
  const max = SIZE - EDGE
  if (px < min || px > max || py < min || py > max) return false
  const cornerX = px < min + RADIUS ? min + RADIUS : px > max - RADIUS ? max - RADIUS : px
  const cornerY = py < min + RADIUS ? min + RADIUS : py > max - RADIUS ? max - RADIUS : py
  return Math.hypot(px - cornerX, py - cornerY) <= RADIUS
}

/**
 * The bento mark as a flat bitmap: a rounded tray in the tone colour, split into three
 * compartments (one tall on the left, two stacked on the right) by white partitions.
 */
export function renderTrayIcon(tone: Tone): { width: number; height: number; data: Buffer } {
  const [r, g, b] = TONE_COLORS[tone]
  const data = Buffer.alloc(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (!insideTray(x, y)) continue
      const partition = isPartition(x) || (x >= 17 && isPartition(y))
      const offset = (y * SIZE + x) * 4
      data[offset] = partition ? 255 : r
      data[offset + 1] = partition ? 255 : g
      data[offset + 2] = partition ? 255 : b
      data[offset + 3] = 255
    }
  }
  return { width: SIZE, height: SIZE, data }
}

/** Electron's createFromBitmap expects BGRA on little-endian machines. */
export function rgbaToBgra(rgba: Buffer): Buffer {
  const bgra = Buffer.from(rgba)
  for (let i = 0; i + 3 < bgra.length; i += 4) {
    bgra[i] = rgba[i + 2]
    bgra[i + 2] = rgba[i]
  }
  return bgra
}
