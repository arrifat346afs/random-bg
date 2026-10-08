/**
 * network/nodes.ts — 3D node placement in world space.
 *
 * Nodes live in world px, centred on the canvas middle. `cloud` draws base
 * positions from the layer's own distribution via `sampleDistribution`
 * (clustered / gaussian / noise-masked clumps from dist.ts); every other
 * layout samples internally. Projection, depth cues and emission are the
 * scene3d core's job. Pure TypeScript, seeded RNG only.
 */

import { sampleDistribution } from '../../dist'
import { createNoise } from '../../noise'
import type { GenContext } from '../../schema'

export interface WNode {
  x: number
  y: number
  z: number
  /** colour ramp position 0..1 */
  t: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Sample `count` world-space nodes for the layout. */
export function sampleNetwork(
  ctx: GenContext,
  count: number,
  layout: string,
  clusters: number,
  spread: number,
): WNode[] {
  const { rng, w, h, minDim } = ctx
  const pts: { x: number; y: number; z: number; t: number }[] = []
  const K = Math.max(1, Math.round(clusters))
  const noise = createNoise(ctx.seed)
  const depthSpan = minDim * 0.6

  if (layout === 'cloud' && (ctx.dist.type === 'clustered' || ctx.dist.type === 'gaussian' || ctx.dist.type === 'noiseMask')) {
    for (const s of sampleDistribution(ctx, count)) {
      pts.push({ x: s.x / w, y: s.y / h, z: 0.5 + rng.normal(0, 0.22), t: s.t })
    }
  } else if (layout === 'wave') {
    for (let i = 0; i < count; i++) {
      const x = rng.next()
      const y = rng.next()
      const wv = noise.fbm(x * 2.2, y * 2.2, 3) * 0.5 + 0.5
      pts.push({ x, y, z: 0.5 + (wv - 0.5) * 0.9 + rng.normal(0, 0.04), t: x })
    }
  } else if (layout === 'globe') {
    const n = Math.max(count, 1)
    for (let i = 0; i < count; i++) {
      const k = (i + 0.5) / n
      const a = Math.acos(1 - 2 * k) + rng.normal(0, 0.06)
      const ph = i * 2.399963 + rng.normal(0, 0.05)
      pts.push({
        x: 0.5 + 0.3 * Math.sin(a) * Math.cos(ph),
        y: 0.5 + 0.3 * Math.sin(a) * Math.sin(ph),
        z: 0.5 - 0.5 * Math.cos(a) * 0.6,
        t: k,
      })
    }
  } else if (layout === 'ribbon') {
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5
      pts.push({
        x: t + rng.normal(0, spread * 0.5),
        y: 0.5 + Math.sin(t * Math.PI * 2.2) * 0.22 + rng.normal(0, spread * 0.9),
        z: 0.5 + (t - 0.5) * 0.5 + rng.normal(0, 0.06),
        t,
      })
    }
  } else if (layout === 'grid') {
    const cols = Math.max(2, Math.round(Math.sqrt((count * w) / Math.max(1, h))))
    const rows = Math.max(2, Math.ceil(count / cols))
    for (let i = 0; i < count; i++) {
      const cx = (i % cols) / Math.max(1, cols - 1)
      const cy = Math.floor(i / cols) / Math.max(1, rows - 1)
      pts.push({
        x: cx + rng.normal(0, spread * 0.55),
        y: cy + rng.normal(0, spread * 0.55),
        z: 0.5 + rng.normal(0, 0.1),
        t: (cx + cy) / 2,
      })
    }
  } else if (layout === 'constellation') {
    const centers: { x: number; y: number }[] = []
    for (let i = 0; i < K; i++) centers.push({ x: rng.range(0.1, 0.9), y: rng.range(0.1, 0.9) })
    for (let i = 0; i < count; i++) {
      if (rng.next() < 0.3) {
        pts.push({ x: rng.next(), y: rng.next(), z: rng.next(), t: rng.next() })
      } else {
        const c = centers[i % centers.length]
        pts.push({
          x: c.x + rng.normal(0, spread), y: c.y + rng.normal(0, spread),
          z: 0.5 + rng.normal(0, 0.2), t: rng.next(),
        })
      }
    }
  } else {
    // internal organic cloud: gaussian clumps + noise-mask thinning
    const centers: { x: number; y: number; zo: number }[] = []
    for (let i = 0; i < K; i++) {
      centers.push({ x: rng.range(0.12, 0.88), y: rng.range(0.12, 0.88), zo: rng.normal(0, 0.12) })
    }
    let guard = 0
    while (pts.length < count && guard++ < count * 40) {
      const c = centers[pts.length % centers.length]
      const x = c.x + rng.normal(0, spread)
      const y = c.y + rng.normal(0, spread * (h / Math.max(1, w)) * 0.9 + 0.35)
      const m = noise.fbm(x * 3.1, y * 3.1, 3) * 0.5 + 0.5
      if (m > 0.32 || rng.next() < 0.25) {
        pts.push({ x, y, z: 0.5 + c.zo + rng.normal(0, 0.14), t: rng.next() })
      }
    }
    while (pts.length < count) pts.push({ x: rng.next(), y: rng.next(), z: rng.next(), t: rng.next() })
  }

  // unit box → centred world px; z becomes real depth via depthSpan
  return pts.map((p) => ({
    x: (p.x - 0.5) * w,
    y: (p.y - 0.5) * h,
    z: (clamp01(p.z) - 0.5) * depthSpan,
    t: clamp01(p.t),
  }))
}
