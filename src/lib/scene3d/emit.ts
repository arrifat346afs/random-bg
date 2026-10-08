/**
 * scene3d/emit.ts — Painter's-algorithm emission of 3D scenes to IR nodes.
 *
 * Projected items are sorted into depth slabs (far → near) so nearer
 * geometry paints over farther geometry with no z-buffer. Within a slab,
 * edges merge into one path per opacity bucket (and per defocus level for
 * stacked strokes); nodes are gradient circles. Out-of-focus points become
 * soft CoC discs with energy-conserving alpha; out-of-focus lines become up
 * to `stackMax` stacked strokes with growing width and falling opacity.
 * No `blur`, no blend modes — `toStockIR` is a no-op on this output.
 */

import { circle, discPaint, glowPaint, solid, type Node } from '../ir'
import { atmShift, cocRadius, fogAlpha, perspScale, slabOf, widthAt } from './depth'
import { project, type Camera } from './camera'
import { clamp01 } from './math'

const r2 = (n: number): number => Math.round(n * 100) / 100

/** One 3D point. `r` is px at the camera reference distance. */
export interface ENode {
  x: number
  y: number
  z: number
  r: number
  c: string
  a: number
  /** edge softness 0..1 when sharp */
  soft: number
  /** extra halo disc (hubs, accents) */
  glow: boolean
  glowScale: number
  glowAlpha: number
  /** absolute halo radius in px at ref distance (0 = r * glowScale) */
  glowR: number
}

/** One 3D segment. `w` is px at the camera reference distance. */
export interface EEdge {
  ax: number
  ay: number
  az: number
  bx: number
  by: number
  bz: number
  a: number
  w: number
  c: string
}

export interface Emit3DOpts {
  cam: Camera
  /** background hex (atmospheric shift target) */
  bg: string
  focal: number
  focalRange: number
  dof: number
  /** CoC clamp in px */
  cocMax: number
  /** fog density 0..1 */
  fog: number
  slabs: number
  buckets: number
  /** stacked defocus strokes per edge (3-6) */
  stackMax: number
  /** CoC px per extra stroke level */
  stackStep: number
  /** alpha reference for bucket normalisation (e.g. lineOpacity) */
  bucketRef: number
  /** skip nodes further than this outside the canvas */
  margin: number
}

export function emitScene3D(nodes: ENode[], edges: EEdge[], o: Emit3DOpts): Node[] {
  const slabs = Math.max(4, Math.min(12, Math.round(o.slabs)))
  const buckets = Math.max(2, Math.min(8, Math.round(o.buckets)))
  const m = Math.max(0, o.margin)

  // pass 1: project everything, find the content depth range
  interface PN { n: ENode; x: number; y: number; d: number; dist: number }
  interface PE { e: EEdge; ax: number; ay: number; bx: number; by: number; da: number; db: number; d: number }
  const pn: PN[] = []
  let dmin = Infinity
  let dmax = -Infinity
  const track = (d: number): void => { if (d < dmin) dmin = d; if (d > dmax) dmax = d }
  for (const nd of nodes) {
    const p = project(o.cam, nd.x, nd.y, nd.z)
    if (p.behind) continue
    if (p.x < -m || p.y < -m || p.x > o.cam.w + m || p.y > o.cam.h + m) continue
    pn.push({ n: nd, x: p.x, y: p.y, d: p.depth, dist: p.dist })
    track(p.depth)
  }
  const pe: PE[] = []
  for (const e of edges) {
    const pa = project(o.cam, e.ax, e.ay, e.az)
    const pb = project(o.cam, e.bx, e.by, e.bz)
    if (pa.behind || pb.behind) continue
    pe.push({ e, ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, da: pa.depth, db: pb.depth, d: Math.min(pa.depth, pb.depth) })
    track(pa.depth)
    track(pb.depth)
  }
  // content-relative depth: slabs, fog and CoC span the actual scene
  const span = Math.max(1e-6, dmax - dmin)
  const rel = (d: number): number => (d - dmin) / span

  // pass 2: shade + bucket with content-relative depth (focal = scene middle)
  const nodeSlabs: { n: ENode; x: number; y: number; r: number; a: number; c: string; coc: number; s: number; depth: number }[][] =
    Array.from({ length: slabs }, () => [])
  const pathD: string[][][] = Array.from({ length: slabs }, () =>
    Array.from({ length: buckets }, () => Array.from({ length: o.stackMax }, () => '')))
  const pathSum: number[][][] = Array.from({ length: slabs }, () =>
    Array.from({ length: buckets }, () => Array.from({ length: o.stackMax }, () => 0)))
  const pathN: number[][][] = Array.from({ length: slabs }, () =>
    Array.from({ length: buckets }, () => Array.from({ length: o.stackMax }, () => 0)))
  const pathCol: string[][] = Array.from({ length: slabs }, () => Array.from({ length: buckets }, () => '#000000'))
  const pathW: number[][][] = Array.from({ length: slabs }, () =>
    Array.from({ length: buckets }, () => Array.from({ length: o.stackMax }, () => 1)))

  for (const it of pn) {
    const d = rel(it.d)
    const s = perspScale(it.dist, o.cam.ref)
    const coc = cocRadius(d, o.focal, o.focalRange, o.dof, o.cocMax)
    nodeSlabs[slabOf(d, slabs)].push({
      n: it.n, x: it.x, y: it.y, r: Math.max(0.05, it.n.r * s),
      a: it.n.a * fogAlpha(d, o.fog), c: atmShift(it.n.c, o.bg, d, o.fog), coc, s, depth: d,
    })
  }

  const ref = Math.max(0.01, o.bucketRef)
  for (const it of pe) {
    const d = rel(it.d)
    const ea = project(o.cam, it.e.ax, it.e.ay, it.e.az)
    const eb = project(o.cam, it.e.bx, it.e.by, it.e.bz)
    const coc = (cocRadius(rel(it.da), o.focal, o.focalRange, o.dof, o.cocMax) +
      cocRadius(rel(it.db), o.focal, o.focalRange, o.dof, o.cocMax)) / 2
    const s = (perspScale(ea.dist, o.cam.ref) + perspScale(eb.dist, o.cam.ref)) / 2
    const a = it.e.a * fogAlpha(d, o.fog)
    if (a < 0.015) continue
    const col = atmShift(it.e.c, o.bg, d, o.fog)
    const b = Math.max(0, Math.min(buckets - 1, Math.floor((a / ref) * buckets)))
    const w = Math.max(0.1, it.e.w * s * widthAt(d, 0.8))
    const seg = `M${r2(it.ax)} ${r2(it.ay)}L${r2(it.bx)} ${r2(it.by)}`
    let levels = 1
    if (coc > o.stackStep && a >= 0.05) {
      levels = Math.max(2, Math.min(o.stackMax, 1 + Math.floor(coc / o.stackStep)))
    }
    for (let lv = 0; lv < levels; lv++) {
      pathD[slabOf(d, slabs)][b][lv] += seg
      pathSum[slabOf(d, slabs)][b][lv] += a * Math.pow(0.45, lv)
      pathN[slabOf(d, slabs)][b][lv]++
      pathCol[slabOf(d, slabs)][b] = col
      const pw = pathW[slabOf(d, slabs)][b][lv]
      pathW[slabOf(d, slabs)][b][lv] = Math.max(pw, w * (1 + 0.9 * lv))
    }
  }
  // far slabs first so near geometry paints over far geometry
  const out: Node[] = []
  for (let s = 0; s < slabs; s++) {
    for (const it of nodeSlabs[s]) {
      const nd = it.n
      if (it.a <= 0.004) continue
      if (it.coc > 0.75) {
        // bokeh disc: CoC radius, energy-conserving alpha, fully soft
        const R = it.r + it.coc
        const k = (it.r * it.r) / Math.max(0.01, R * R)
        out.push(circle(it.x, it.y, R, discPaint(it.x, it.y, R, it.c, clamp01(it.a * k), 0.95)))
      } else {
        out.push(circle(it.x, it.y, it.r, discPaint(it.x, it.y, it.r, it.c, it.a, clamp01(nd.soft))))
      }
      if (nd.glow && nd.glowAlpha > 0.004) {
        const hr = nd.glowR > 0 ? nd.glowR * it.s : it.r * nd.glowScale
        out.push(circle(it.x, it.y, hr, glowPaint(it.x, it.y, hr, it.c, clamp01(nd.glowAlpha * fogAlpha(it.depth, o.fog)))))
      }
    }
    for (let b = 0; b < buckets; b++) {
      for (let lv = 0; lv < o.stackMax; lv++) {
        if (!pathN[s][b][lv]) continue
        out.push({
          g: { k: 'path', d: pathD[s][b][lv] },
          stroke: solid(pathCol[s][b]),
          sw: Number(pathW[s][b][lv].toFixed(2)),
          cap: 'round',
          join: 'round',
          op: Number(clamp01(pathSum[s][b][lv] / pathN[s][b][lv]).toFixed(4)),
        })
      }
    }
  }
  return out
}

/** Default emit options shared by the 3D generators (overridden per preset). */
export function defaultEmitOpts(cam: Camera, bg: string): Emit3DOpts {
  return {
    cam, bg,
    focal: 0.45, focalRange: 0.08, dof: 0.55, cocMax: 26,
    fog: 0.5, slabs: 10, buckets: 6, stackMax: 4, stackStep: 5,
    bucketRef: 0.35, margin: 60,
  }
}
