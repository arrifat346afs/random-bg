/**
 * dist.ts — The shared distribution system.
 *
 * One implementation serves *every* generator: a generator asks for `n`
 * points and receives positions + depth + normalised `t`, then decides what
 * to draw at each point. This is what makes distributions composable with
 * all generators instead of being baked into each one.
 */

import { createNoise, type Noise2D } from './noise'
import type { DistSpec, GenContext } from './schema'

export interface Sample {
  x: number
  y: number
  /** normalised depth 0..1 (0 = near/front, 1 = far/back) */
  z: number
  /** normalised parameter along the distribution (0..1) — drives colour ramps */
  t: number
  /** normalised distance from canvas centre, 0..1 */
  edge: number
  /** pass/fail from masks (0..1); 1 when no mask */
  mask: number
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a || 1e-6))
  return t * t * (3 - 2 * t)
}

/**
 * Draw `n` points according to the distribution spec.
 * Deterministic: only consumes `ctx.rng`.
 */
export function sampleDistribution(ctx: GenContext, n: number): Sample[] {
  const { dist, rng, w, h, minDim } = ctx
  const out: Sample[] = []
  if (n <= 0) return out
  const maxN = 60000
  n = Math.min(n, maxN)

  const centre = { x: w / 2, y: h / 2 }

  // -- base positions -----------------------------------------------------
  switch (dist.type) {
    case 'uniform': {
      for (let i = 0; i < n; i++) out.push(mk(rng.next() * w, rng.next() * h))
      break
    }
    case 'gaussian': {
      for (let i = 0; i < n; i++) {
        out.push(mk(clamp(rng.normal(0.5, 0.19)) * w, clamp(rng.normal(0.5, 0.19)) * h))
      }
      break
    }
    case 'clustered': {
      const k = Math.max(1, Math.round(dist.clusters))
      const centers: { x: number; y: number; s: number }[] = []
      for (let i = 0; i < k; i++) {
        centers.push({
          x: rng.range(0.12, 0.88) * w,
          y: rng.range(0.12, 0.88) * h,
          s: rng.range(0.05, 0.16) * minDim,
        })
      }
      const spread = minDim * 0.09
      for (let i = 0; i < n; i++) {
        const c = centers[i % centers.length]
        out.push(
          mk(
            c.x + rng.normal(0, spread * (c.s / (minDim * 0.1))),
            c.y + rng.normal(0, spread * (c.s / (minDim * 0.1))),
          ),
        )
      }
      break
    }
    case 'curve': {
      for (let i = 0; i < n; i++) {
        const t = i / Math.max(1, n - 1)
        const jitter = minDim * 0.012
        const p = curvePoint(dist.curve, t, w, h, dist.curveAmount)
        out.push(mk(p.x + rng.normal(0, jitter), p.y + rng.normal(0, jitter), t))
      }
      break
    }
    case 'sineBand': {
      const amp = h * 0.18 * dist.curveAmount * 2
      const freq = Math.max(1, Math.round(1 + dist.arms))
      const thickness = h * dist.band * 0.5
      for (let i = 0; i < n; i++) {
        const x = rng.next() * w
        const phase = (x / w) * Math.PI * 2 * freq
        const y = h / 2 + Math.sin(phase) * amp
        out.push(mk(x, y + rng.normal(0, thickness), x / w))
      }
      break
    }
    case 'radial': {
      const inner = clamp01(dist.inner)
      for (let i = 0; i < n; i++) {
        const a = rng.next() * Math.PI * 2
        const u = rng.next()
        const rr = inner + (1 - inner) * Math.pow(u, Math.max(0.05, dist.radialFalloff))
        const r = rr * Math.hypot(w, h) * 0.5
        out.push(mk(centre.x + Math.cos(a) * r, centre.y + Math.sin(a) * r, rr))
      }
      break
    }
    case 'spiral': {
      const arms = Math.max(1, Math.round(dist.arms))
      const inner = clamp01(dist.inner)
      const turns = 2.5 + dist.curveAmount * 4
      for (let i = 0; i < n; i++) {
        const t = Math.pow(rng.next(), 0.75)
        const arm = i % arms
        const a = t * turns * Math.PI * 2 + (arm / arms) * Math.PI * 2
        const rr = inner + (1 - inner) * t
        const r = rr * Math.hypot(w, h) * 0.5
        out.push(
          mk(centre.x + Math.cos(a) * r, centre.y + Math.sin(a) * r, t),
        )
      }
      break
    }
    case 'gridJitter': {
      const cols = Math.max(2, Math.min(80, Math.round(Math.sqrt(dist.clusters) * 3)))
      const rows = Math.max(2, Math.min(80, Math.round((cols * h) / w) || 2))
      const cw = w / cols
      const ch = h / rows
      const jitter = 0.5 - 0.5 * (1 - dist.curveAmount * 2)
      for (let i = 0; i < n; i++) {
        const cxi = Math.floor(rng.next() * cols)
        const cyi = Math.floor(rng.next() * rows)
        const j = 0.12 + dist.curveAmount * 0.6
        out.push(
          mk(
            (cxi + 0.5 + rng.normal(0, j)) * cw,
            (cyi + 0.5 + rng.normal(0, j)) * ch,
          ),
        )
      }
      void jitter
      break
    }
    case 'poisson': {
      const pts = poisson(w, h, Math.max(4, dist.radius * minDim), n, rng)
      for (let i = 0; i < pts.length; i++) out.push(mk(pts[i][0], pts[i][1]))
      // top up if the disc packing saturated
      while (out.length < n) out.push(mk(rng.next() * w, rng.next() * h))
      break
    }
    case 'noiseMask': {
      const noise = ctxNoise(ctx)
      const scale = Math.max(0.2, dist.noiseScale)
      const thr = dist.noiseThreshold
      const contrast = Math.max(0.1, dist.noiseContrast)
      let attempts = 0
      const cap = n * 60 + 400
      while (out.length < n && attempts < cap) {
        attempts++
        const x = rng.next() * w
        const y = rng.next() * h
        const v = noise.fbm((x / minDim) * scale, (y / minDim) * scale, 4) * 0.5 + 0.5
        const shaped = smooth(thr - 0.18 / contrast, thr + 0.18 / contrast, v)
        if (shaped > rng.next()) out.push(mk(x, y, v))
      }
      while (out.length < n) out.push(mk(rng.next() * w, rng.next() * h))
      break
    }
    case 'imageMask': {
      const maskAt = ctx.maskAt
      let attempts = 0
      const cap = n * 80 + 500
      while (out.length < n && attempts < cap) {
        attempts++
        const x = rng.next() * w
        const y = rng.next() * h
        const m = maskAt ? maskAt(x / w, y / h) : 1
        if (m > rng.next()) out.push(mk(x, y, 0.5, m))
      }
      while (out.length < n) out.push(mk(rng.next() * w, rng.next() * h, 0.5, 0))
      break
    }
  }

  // -- edge density falloff ---------------------------------------------
  if (dist.edgeFalloff > 0.001) {
    const k = dist.edgeFalloff
    const kept: Sample[] = []
    for (const s of out) {
      // d: 0 at centre, 1 at the far corner
      const nx = (s.x - centre.x) / (w / 2)
      const ny = (s.y - centre.y) / (h / 2)
      const d = Math.min(1, Math.hypot(nx, ny) / Math.SQRT2)
      const falloff = 1 - Math.pow(d, 1.6) * k
      if (rng.next() < Math.max(0.02, falloff)) kept.push(s)
    }
    // keep the density stable so counts match the schema's `density()`
    while (kept.length < n * (1 - k * 0.55) && kept.length < n) {
      kept.push(out[Math.floor(rng.next() * out.length)])
    }
    out.length = 0
    for (const s of kept) out.push(s)
  }

  return out

  function mk(x: number, y: number, t = -1, mask = 1): Sample {
    const nx = (x - centre.x) / (w / 2)
    const ny = (y - centre.y) / (h / 2)
    const edge = Math.min(1, Math.hypot(nx, ny) / Math.SQRT2)
    const z =
      dist.depth > 0.001 ? clamp01(0.5 + rng.normal(0, dist.depth * 0.42)) : 0.5
    return { x, y, z, t: t < 0 ? rng.next() : t, edge, mask }
  }
}

const clamp = (v: number) => (v < -0.05 ? -0.05 : v > 1.05 ? 1.05 : v)

/* ---- Curve family ------------------------------------------------------ */

function curvePoint(
  curve: DistSpec['curve'],
  t: number,
  w: number,
  h: number,
  amount: number,
): { x: number; y: number } {
  const x = t * w
  switch (curve) {
    case 'arc':
      return { x, y: h / 2 - Math.sin(t * Math.PI) * h * 0.36 * amount * 2 }
    case 'diagonal':
      return { x, y: h - t * h * (0.4 + amount) * 1.1 + h * (amount - 0.35) }
    case 'spiral': {
      const a = t * Math.PI * 2 * (1.5 + amount * 4)
      const r = t * Math.min(w, h) * 0.45
      return { x: w / 2 + Math.cos(a) * r, y: h / 2 + Math.sin(a) * r }
    }
    case 'v': {
      const k = Math.abs(t - 0.5) * 2
      return { x, y: h * 0.5 - (1 - k) * h * 0.4 * amount * 2 }
    }
    case 'sine':
    default:
      return { x, y: h / 2 + Math.sin(t * Math.PI * 2 * (1 + amount * 3)) * h * 0.28 * amount * 2 }
  }
}

/* ---- Poisson disc (Bridson) ------------------------------------------- */

function poisson(
  w: number,
  h: number,
  r: number,
  maxPoints: number,
  rng: { next(): number; range(a: number, b: number): number; int(a: number, b: number): number },
): [number, number][] {
  if (maxPoints > 8000) return [] // packing that many is never worth the frame
  const cell = r / Math.SQRT2
  const cols = Math.max(1, Math.ceil(w / cell))
  const rows = Math.max(1, Math.ceil(h / cell))
  const grid: Int32Array = new Int32Array(cols * rows).fill(-1)
  const pts: [number, number][] = []
  const active: number[] = []
  const k = 24

  const gridIdx = (x: number, y: number) => {
    const gx = Math.min(cols - 1, Math.floor(x / cell))
    const gy = Math.min(rows - 1, Math.floor(y / cell))
    return gy * cols + gx
  }

  const fits = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false
    const gx = Math.floor(x / cell)
    const gy = Math.floor(y / cell)
    for (let j = gy - 2; j <= gy + 2; j++) {
      for (let i = gx - 2; i <= gx + 2; i++) {
        if (i < 0 || j < 0 || i >= cols || j >= rows) continue
        const id = grid[j * cols + i]
        if (id >= 0) {
          const p = pts[id]
          if ((p[0] - x) ** 2 + (p[1] - y) ** 2 < r * r) return false
        }
      }
    }
    return true
  }

  const push = (x: number, y: number) => {
    const id = pts.length
    pts.push([x, y])
    grid[gridIdx(x, y)] = id
    active.push(id)
  }

  push(rng.range(0, w), rng.range(0, h))
  while (active.length > 0 && pts.length < maxPoints) {
    const ai = rng.int(0, active.length - 1)
    const p = pts[active[ai]]
    let placed = false
    for (let attempt = 0; attempt < k && pts.length < maxPoints; attempt++) {
      const ang = rng.range(0, Math.PI * 2)
      const d = rng.range(r, 2 * r)
      const nx = p[0] + Math.cos(ang) * d
      const ny = p[1] + Math.sin(ang) * d
      if (fits(nx, ny)) {
        push(nx, ny)
        placed = true
        break
      }
    }
    if (!placed) active.splice(ai, 1)
  }
  return pts
}

/* ---- Size / opacity helpers ------------------------------------------- */

/** Size multiplier in [sizeMin,sizeMax] with a power curve on `t`. */
export function sizeAt(dist: DistSpec, t: number): number {
  const p = Math.max(0.05, dist.sizePower)
  const k = Math.pow(clamp01(t), p)
  return dist.sizeMin + (dist.sizeMax - dist.sizeMin) * k
}

/** Opacity multiplier from depth + centre falloff. */
export function opacityAt(dist: DistSpec, s: Sample): number {
  let o = 1
  if (dist.opacityFalloff > 0) {
    // far things fade; near things stay crisp
    o *= 1 - dist.opacityFalloff * s.z
    o *= 1 - dist.opacityFalloff * 0.5 * s.edge
  }
  return clamp01(o)
}

/** Depth-driven blur in px, given a base blur scale. */
export function blurAt(dist: DistSpec, s: Sample, base: number): number {
  if (base <= 0) return 0
  const d = Math.abs(s.z - 0.35) // focal plane in front of centre
  return d * base * (0.4 + dist.depth)
}

/* ---- Noise cache & image mask ----------------------------------------- */

const noiseCache = new Map<number, Noise2D>()
function ctxNoise(ctx: GenContext): Noise2D {
  let n = noiseCache.get(ctx.seed)
  if (!n) {
    n = createNoise(ctx.seed)
    if (noiseCache.size > 24) noiseCache.clear()
    noiseCache.set(ctx.seed, n)
  }
  return n
}

/**
 * Build a mask sampler from a data-URL / SVG data-url greyscale image.
 * Decoding is async in the browser, so the layer pipeline pre-decodes into an
 * offscreen canvas and hands us a closure (see state/maskCache.ts).
 */
export type MaskSampler = (nx: number, ny: number) => number
export const identityMask: MaskSampler = () => 1
