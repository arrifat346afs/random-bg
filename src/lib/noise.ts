/**
 * noise.ts — Seeded gradient noise (Perlin-style), fBm, domain warping and
 * curl noise. Used by flow fields, smoke, noise masks and modifiers.
 *
 * The permutation table is built from a seed so noise is reproducible.
 */

import { mulberry32, type RNG } from './rng'

export interface Noise2D {
  /** value in roughly [-1,1] */
  noise(x: number, y: number): number
  /** fractal brownian motion, output normalised to ~[-1,1] */
  fbm(x: number, y: number, octaves?: number, lacunarity?: number, gain?: number): number
}

const GRAD: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function createNoise(seed: number | RNG): Noise2D {
  const rand =
    typeof seed === 'number' ? mulberry32(seed) : seed.next.bind(seed)
  // seeded Fisher–Yates over 0..255, doubled for overflow-free indexing
  const p = new Uint8Array(512)
  const perm = new Uint8Array(256)
  for (let i = 0; i < 256; i++) perm[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = perm[i]
    perm[i] = perm[j]
    perm[j] = t
  }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255]

  function grad(hash: number, x: number, y: number): number {
    const g = GRAD[hash & 7]
    return g[0] * x + g[1] * y
  }

  function noise(x: number, y: number): number {
    const xi = Math.floor(x) & 255
    const yi = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const u = fade(xf)
    const v = fade(yf)

    const aa = p[p[xi] + yi]
    const ab = p[p[xi] + yi + 1]
    const ba = p[p[xi + 1] + yi]
    const bb = p[p[xi + 1] + yi + 1]

    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u)
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u)
    // gradient dot products are bounded by ~sqrt(2)/2 after normalisation
    return lerp(x1, x2, v) * 1.4
  }

  function fbm(
    x: number,
    y: number,
    octaves = 4,
    lacunarity = 2,
    gain = 0.5,
  ): number {
    let amp = 1
    let freq = 1
    let sum = 0
    let norm = 0
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * freq, y * freq)
      norm += amp
      amp *= gain
      freq *= lacunarity
    }
    return norm > 0 ? sum / norm : 0
  }

  return { noise, fbm }
}

/**
 * Curl noise — divergence-free velocity field derived from a scalar
 * potential: `v = (dP/dy, -dP/dx)`. Particles following it swirl without
 * piling up, which is what makes flow fields look organic.
 */
export function curl(
  n: Noise2D,
  x: number,
  y: number,
  eps = 0.01,
  scale = 1,
): { x: number; y: number } {
  const n1 = n.fbm(x, y + eps, 3)
  const n2 = n.fbm(x, y - eps, 3)
  const n3 = n.fbm(x + eps, y, 3)
  const n4 = n.fbm(x - eps, y, 3)
  return {
    x: ((n1 - n2) / (2 * eps)) * scale,
    y: (-(n3 - n4) / (2 * eps)) * scale,
  }
}

/** Small helper: normalised 0..1 noise, handy for masks. */
export function noise01(n: Noise2D, x: number, y: number, octaves = 4): number {
  return n.fbm(x, y, octaves) * 0.5 + 0.5
}
