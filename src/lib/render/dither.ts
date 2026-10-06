/**
 * render/dither.ts — Deterministic triangular dither for smooth fields.
 *
 * Canvas gradients quantise to 8-bit steps: on a 4K smooth ramp the eye sees
 * bands. Adding ±0.5 LSB of triangular noise breaks the steps without reading
 * as grain (σ ≈ 0.2 LSB, far under the 0.6/255 flat-noise ceiling).
 *
 * Deterministic and position-based: two uniforms from an integer hash of
 * (seed, x, y) — never `Math.random()`, so the same layer renders byte-identical
 * pixels on every run, at any resolution. Applied once, at the final field
 * output (the offscreen layer raster), never per-node.
 */

import { hash32 } from '../rng'

/**
 * Dither amplitude in LSB.
 *
 * ±1 LSB triangular may read as more than the classic ±0.5 LSB recipe, but
 * that recipe assumes noise added BEFORE quantisation. Our pixels are already
 * 8-bit: adding |n| < 0.5 then rounding is a strict no-op (verified: zero
 * pixels change). ±1 triangular crosses rounding boundaries ~50% of the time
 * with σ ≈ 0.41 LSB — still under the 0.6 flat-noise ceiling.
 */
export const DITHER_AMPLITUDE = 1

/** Two uniform [0,1) values from an integer hash of (seed, x, y). */
function hashUV(seed: number, x: number, y: number): [number, number] {
  let h = hash32(seed, x, y)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  h >>>= 0
  return [(h >>> 16) / 65536, (h & 0xffff) / 65536]
}

/**
 * Add triangular dither in place (r = g = b by the same draw: luminance-only,
 * so no chroma speckle). Skips fully transparent pixels — they contribute
 * nothing downstream and stay bit-clean for compression.
 */
export function triangularDither(data: Uint8ClampedArray, w: number, h: number, seed: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (data[o + 3] === 0) continue
      const [u1, u2] = hashUV(seed, x, y)
      const n = (u1 + u2 - 1) * DITHER_AMPLITUDE
      data[o] = data[o] + n
      data[o + 1] = data[o + 1] + n
      data[o + 2] = data[o + 2] + n
    }
  }
}
