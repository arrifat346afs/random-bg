/**
 * gradient-shapes/gradient.ts — Palette-derived linear / radial gradients.
 *
 * Two stops per shape, picked from the palette with a lightness span set by
 * `contrast`. Both backends render these natively, so preview and SVG agree.
 */

import type { Paint } from '../../ir'
import { linearPaint } from '../../ir'
import { darkenHex, lightenHex } from '../shade'

/** Which gradient family to paint. */
export type GradientKind = 'linear' | 'radial'

/**
 * Build a two-stop gradient paint for a shape centred at (x, y).
 */
export function shapeGradient(
  kind: GradientKind,
  x: number,
  y: number,
  size: number,
  angle: number,
  from: string,
  to: string,
  alpha: number,
  softness: number,
): Paint {
  const soft: number = Math.max(0, Math.min(1, softness))
  // soft edge: ease the far stop toward transparent instead of a hard rim
  const endAlpha: number = alpha * (1 - soft * 0.45)
  if (kind === 'radial') {
    return {
      k: 'radial',
      cx: x - size * 0.18,
      cy: y - size * 0.22,
      r: size * 0.75,
      ri: 0,
      stops: [
        { t: 0, c: lightenHex(from, 0.3), o: alpha },
        { t: 0.55, c: from, o: alpha },
        { t: 1, c: to, o: endAlpha },
      ],
    }
  }
  const dx: number = Math.cos(angle) * size * 0.75
  const dy: number = Math.sin(angle) * size * 0.75
  return linearPaint(x - dx, y - dy, x + dx, y + dy, [
    { t: 0, c: lightenHex(from, 0.25), o: alpha },
    { t: 0.5, c: from, o: alpha },
    { t: 1, c: darkenHex(to, 0.15), o: endAlpha },
  ])
}
