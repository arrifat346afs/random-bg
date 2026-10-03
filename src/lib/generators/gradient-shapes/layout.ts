/**
 * gradient-shapes/layout.ts — Slot layouts for gradient shapes.
 *
 * A slot is a placed box plus a normalised `t` for colour and an angle hint.
 * Layouts are deterministic given the rng; scattering uses the layer rng only.
 */

import type { RNG } from '../../rng'

/** Layout families. */
export type LayoutKind = 'vStack' | 'hStack' | 'offsetCols' | 'packed' | 'scattered' | 'concentric'

/** True for every valid layout id. */
export function isLayoutKind(v: string): v is LayoutKind {
  return v === 'vStack' || v === 'hStack' || v === 'offsetCols' || v === 'packed' || v === 'scattered' || v === 'concentric'
}

/** One placed shape. */
export interface Slot {
  x: number
  y: number
  size: number
  t: number
  /** layout direction in radians (for `aligned` gradients) */
  dir: number
}

/**
 * Compute `count` slots inside the canvas.
 */
export function layoutSlots(
  kind: LayoutKind,
  rng: RNG,
  count: number,
  w: number,
  h: number,
  sizeMin: number,
  sizeMax: number,
  overlap: number,
): Slot[] {
  const out: Slot[] = []
  const n: number = Math.max(1, Math.round(count))
  const span: number = Math.max(8, sizeMax - sizeMin)
  const pick = (): number => sizeMin + rng.next() * span
  switch (kind) {
    case 'vStack': {
      const step: number = (h * (1 - overlap * 0.6)) / n
      for (let i = 0; i < n; i++) {
        const size: number = pick()
        out.push({ x: w / 2 + rng.normal(0, w * 0.02), y: step * (i + 0.5), size, t: n > 1 ? i / (n - 1) : 0.5, dir: Math.PI / 2 })
      }
      break
    }
    case 'hStack': {
      const step: number = (w * (1 - overlap * 0.6)) / n
      for (let i = 0; i < n; i++) {
        const size: number = pick()
        out.push({ x: step * (i + 0.5), y: h / 2 + rng.normal(0, h * 0.02), size, t: n > 1 ? i / (n - 1) : 0.5, dir: 0 })
      }
      break
    }
    case 'offsetCols': {
      const cols: number = Math.max(2, Math.round(Math.sqrt(n * (w / Math.max(1, h)))))
      const rows: number = Math.max(1, Math.ceil(n / cols))
      const cw: number = w / cols
      const ch: number = h / rows
      for (let i = 0; i < n; i++) {
        const col: number = i % cols
        const row: number = Math.floor(i / cols)
        const size: number = pick()
        out.push({
          x: cw * (col + 0.5) + (row % 2 ? cw * 0.28 : -cw * 0.1) + rng.normal(0, cw * 0.05),
          y: ch * (row + 0.5) + rng.normal(0, ch * 0.05),
          size,
          t: n > 1 ? i / (n - 1) : 0.5,
          dir: Math.PI / 4,
        })
      }
      break
    }
    case 'packed': {
      // rows of overlapping rects, widest in the middle
      const rows: number = Math.max(2, Math.round(Math.sqrt(n)))
      let i = 0
      for (let r = 0; r < rows && i < n; r++) {
        const per: number = Math.ceil(n / rows)
        const rh: number = h / rows
        for (let k = 0; k < per && i < n; k++, i++) {
          const size: number = pick()
          out.push({
            x: (w * (k + 0.5)) / per + rng.normal(0, w * 0.01),
            y: rh * (r + 0.5) + rng.normal(0, rh * 0.08),
            size: size * (1 + overlap * 0.4),
            t: n > 1 ? i / (n - 1) : 0.5,
            dir: rng.pick([0, Math.PI / 2]),
          })
        }
      }
      break
    }
    case 'concentric': {
      const cx: number = w / 2
      const cy: number = h / 2
      const maxR: number = Math.min(w, h) * 0.48
      for (let i = 0; i < n; i++) {
        const t: number = n > 1 ? i / (n - 1) : 0.5
        const size: number = maxR * 2 * (1 - t * (1 - overlap * 0.5)) * (sizeMax / Math.max(1, sizeMax))
        out.push({ x: cx, y: cy, size: Math.max(sizeMin * 0.5, size), t, dir: t * Math.PI })
      }
      break
    }
    case 'scattered':
    default: {
      for (let i = 0; i < n; i++) {
        out.push({ x: rng.next() * w, y: rng.next() * h, size: pick(), t: rng.next(), dir: rng.range(0, Math.PI * 2) })
      }
      break
    }
  }
  return out
}
