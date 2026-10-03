/**
 * filters/kit.ts — Shared helpers for filter definitions.
 *
 * Small, pure and dependency-light: param reading, id generation, colour
 * parsing, SVG escaping and the tiny kernels (blur, convolve) every filter
 * reuses. Keeps each filter file under 250 lines.
 */

import { hash32 } from '../rng'
import type { Params } from '../schema'
import type { SpreadCtx } from './types'

let filterSeq = 0

/** Unique filter-instance id. Not a seed source — use `filterSeed` for that. */
export function newFilterId(prefix = 'f'): string {
  filterSeq++
  return `${prefix}${Date.now().toString(36)}${filterSeq.toString(36)}`
}

/** Deterministic seed for one filter instance on one layer. */
export function filterSeed(layerSeed: number, filterId: string): number {
  return hash32(layerSeed, filterId)
}

/** Read a numeric param with fallback. */
export function num(params: Params, key: string, fallback: number): number {
  const v = params[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/** Read a string param with fallback. */
export function str(params: Params, key: string, fallback: string): string {
  const v = params[key]
  return typeof v === 'string' ? v : fallback
}

/** Clamp to [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Distance from a fractional point to the farthest canvas corner.
 *
 * The reach of a radial / zoom blur is `amount × distance-to-farthest-corner`,
 * so a filter whose pixels are sampled from outside the canvas has to declare a
 * spread that accounts for the canvas size — see `FilterDef.spread`.
 */
export function cornerRadius(ctx: SpreadCtx, fx: number, fy: number): number {
  const cx = clamp(fx, 0, 1) * ctx.width
  const cy = clamp(fy, 0, 1) * ctx.height
  let far = 0
  for (const [x, y] of [
    [0, 0],
    [ctx.width, 0],
    [0, ctx.height],
    [ctx.width, ctx.height],
  ] as const) {
    far = Math.max(far, Math.hypot(x - cx, y - cy))
  }
  return far
}

const HEX_RE = /^#([0-9a-fA-F]{3,8})$/

/** Parse `#rgb` / `#rrggbb` / `#rrggbbaa` into 0-255 RGBA. */
export function parseHex(hex: string): [number, number, number, number] {
  const m = HEX_RE.exec(hex.trim())
  if (!m) return [255, 255, 255, 255]
  let h = m[1]
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (h.length === 6) h += 'ff'
  if (h.length !== 8) return [255, 255, 255, 255]
  const n = parseInt(h, 16)
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}

/** Escape for SVG attribute values. */
export function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Format a float compactly for SVG output. */
export function fmt(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return '0'
  return String(Number(n.toFixed(digits)))
}

/* ---- Separable gaussian blur on raw RGBA (premultiplied-safe) ------------ */

/**
 * Blur RGBA bytes with a separable gaussian kernel.
 * Operates on unpremultiplied data but weights by alpha, so transparent
 * exports keep a clean alpha channel with no dark fringes.
 */
export function gaussianBlur(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  sigma: number,
): Uint8ClampedArray {
  if (!(sigma > 0.05) || w <= 0 || h <= 0) return src.slice()
  const radius = Math.min(24, Math.max(1, Math.ceil(sigma * 3)))
  const kernel = gaussianKernel(sigma, radius)
  const tmp = new Float32Array(w * h * 4)
  const srcF = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h * 4; i++) srcF[i] = src[i]
  // horizontal pass, alpha-weighted
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k))
        const o = (y * w + xx) * 4
        const weight = kernel[k + radius]
        const alpha = srcF[o + 3] / 255
        r += srcF[o] * alpha * weight
        g += srcF[o + 1] * alpha * weight
        b += srcF[o + 2] * alpha * weight
        a += srcF[o + 3] * weight
      }
      const o = (y * w + x) * 4
      tmp[o] = r
      tmp[o + 1] = g
      tmp[o + 2] = b
      tmp[o + 3] = a
    }
  }
  const out = new Uint8ClampedArray(w * h * 4)
  const outF = new Float32Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k))
        const o = (yy * w + x) * 4
        const weight = kernel[k + radius]
        r += tmp[o] * weight
        g += tmp[o + 1] * weight
        b += tmp[o + 2] * weight
        a += tmp[o + 3] * weight
      }
      const o = (y * w + x) * 4
      outF[o] = r
      outF[o + 1] = g
      outF[o + 2] = b
      outF[o + 3] = a
    }
  }
  for (let i = 0; i < w * h; i++) {
    const a = outF[i * 4 + 3] / 255
    const o = i * 4
    if (a > 0.001) {
      out[o] = outF[o] / a
      out[o + 1] = outF[o + 1] / a
      out[o + 2] = outF[o + 2] / a
    } else {
      out[o] = 0
      out[o + 1] = 0
      out[o + 2] = 0
    }
    out[o + 3] = outF[o + 3]
  }
  return out
}

function gaussianKernel(sigma: number, radius: number): Float32Array {
  const k = new Float32Array(radius * 2 + 1)
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma))
    k[i + radius] = v
    sum += v
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum
  return k
}

/** 3×3 convolve on RGB (alpha preserved). Kernel is row-major length 9. */
export function convolve3x3(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  kernel: readonly number[],
  divisor = 1,
  bias = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src)
  const div = divisor === 0 ? 1 : divisor
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const xx = Math.min(w - 1, Math.max(0, x + kx))
          const yy = Math.min(h - 1, Math.max(0, y + ky))
          const o = (yy * w + xx) * 4
          const weight = kernel[(ky + 1) * 3 + (kx + 1)]
          r += src[o] * weight
          g += src[o + 1] * weight
          b += src[o + 2] * weight
        }
      }
      const o = (y * w + x) * 4
      out[o] = r / div + bias
      out[o + 1] = g / div + bias
      out[o + 2] = b / div + bias
    }
  }
  return out
}

/** Bilinear sample of RGBA at fractional coords (clamped). */
export function sampleBilinear(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = Math.min(w - 1, Math.max(0, Math.floor(x)))
  const y0 = Math.min(h - 1, Math.max(0, Math.floor(y)))
  const x1 = Math.min(w - 1, x0 + 1)
  const y1 = Math.min(h - 1, y0 + 1)
  const fx = clamp(x - x0, 0, 1)
  const fy = clamp(y - y0, 0, 1)
  const p = (xx: number, yy: number, c: number) => src[(yy * w + xx) * 4 + c]
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t
  const out: [number, number, number, number] = [0, 0, 0, 0]
  for (let c = 0; c < 4; c++) {
    out[c] = lerp(lerp(p(x0, y0, c), p(x1, y0, c), fx), lerp(p(x0, y1, c), p(x1, y1, c), fx), fy)
  }
  return out
}
