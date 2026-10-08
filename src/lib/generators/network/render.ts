/**
 * network/render.ts — Turn params into IR nodes, on the scene3d core.
 *
 * World-space nodes link by projected proximity, hubs are the
 * best-connected, and everything emits through the painter's-algorithm
 * core: CoC bokeh discs, hub halos, fog, and edges merged into one path per
 * slab/bucket. No blur, no blend modes, no white fills — the output is
 * Adobe Stock-clean by construction. Pure, no DOM.
 */

import { mapColor, mixColor } from '../../palette'
import { capChroma, capYellow, rampOklch } from '../../field/oklab'
import type { GenContext, Params } from '../../schema'
import { done, emitCount, num, str } from '../kit'
import { alphaForLoad } from '../density'
import { makeCamera, project } from '../../scene3d/camera'
import { emitScene3D, defaultEmitOpts, type EEdge, type ENode } from '../../scene3d/emit'
import { clamp01 } from '../../scene3d/math'
import { ATM_BG, camFromParams } from '../surface3d/build'
import { MAX_NODES } from './params'
import { sampleNetwork } from './nodes'
import { buildEdges } from './edges'

function tame(c: string, cap: number): string {
  return capYellow(capChroma(c, cap))
}

export function generateNetwork(p: Params, ctx: GenContext): ReturnType<typeof done> {
  const count = Math.min(MAX_NODES, emitCount(p, 260))
  const layout = str(p, 'layout', 'cloud')
  const connection = str(p, 'connection', 'knn')
  const size = num(p, 'size', 7)
  const sizePower = Math.max(0.05, num(p, 'sizePower', 2.2))
  const hubRatio = clamp01(num(p, 'hubRatio', 0.07))
  const maxDegree = num(p, 'maxDegree', 3)
  const maxLenPx = Math.max(8, num(p, 'maxEdgeLen', 0.22) * ctx.minDim)
  const lineWidth = num(p, 'lineWidth', 1.2)
  const lineOpacity = clamp01(num(p, 'lineOpacity', 0.35))
  const lineFalloff = num(p, 'lineFalloff', 1.6)
  const alpha = clamp01(num(p, 'alpha', 0.85))
  const glowRadius = num(p, 'glowRadius', 10)
  const halo = clamp01(num(p, 'halo', 0.5))
  const dust = clamp01(num(p, 'dust', 0.25))
  const chromaCap = num(p, 'chromaCap', 0.16)

  const cam = makeCamera(camFromParams(p), ctx.w, ctx.h)
  const emitOpts = {
    ...defaultEmitOpts(cam, ATM_BG),
    focal: clamp01(num(p, 'focal', 0.45)), focalRange: num(p, 'focalRange', 0.08),
    dof: clamp01(num(p, 'dof', 0.55)), cocMax: num(p, 'cocMax', 26),
    fog: clamp01(num(p, 'fog', 0.5)), bucketRef: Math.max(0.05, lineOpacity),
  }

  const pts = sampleNetwork(ctx, count, layout, num(p, 'clusters', 5), num(p, 'spread', 0.16))
  const n = pts.length
  // link on projected coords; behind-camera points sit out (degree 0)
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const vis = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const pr = project(cam, pts[i].x, pts[i].y, pts[i].z)
    xs[i] = pr.x
    ys[i] = pr.y
    vis[i] = pr.behind ? 0 : 1
  }
  const edges = buildEdges(xs, ys, connection, maxDegree, maxLenPx)
  const degree = new Uint8Array(n)
  for (const e of edges) {
    if (!vis[e.a] || !vis[e.b]) continue
    degree[e.a]++
    degree[e.b]++
  }

  // hubs: best-connected visible nodes (degree desc, index asc)
  const hubCount = Math.round(n * hubRatio)
  const order = pts.map((_, i) => i).sort((a, b) => degree[b] - degree[a] || a - b)
  const isHub = new Uint8Array(n)
  for (let k = 0; k < hubCount; k++) isHub[order[k]] = 1

  const palette = ctx.color.palette.colors.length ? ctx.color.palette.colors : ['#9fd0ff']
  const nodeGuard = alphaForLoad(1, n / 1400)
  const edgeGuard = alphaForLoad(1, edges.length / 900)
  const nodes: ENode[] = []
  for (let i = 0; i < n; i++) {
    const pt = pts[i]
    const u = ctx.rng.next()
    const hub = isHub[i] === 1
    let r = Math.max(0.7, size * (0.22 + 0.78 * Math.pow(u, sizePower)))
    if (hub) r *= 1.7
    let a = alpha * (0.35 + 0.65 * (0.3 + 0.7 * (1 - u * 0.5)))
    a *= nodeGuard
    if (hub) a = Math.min(0.95, a * 1.35 + 0.1)
    if (a <= 0.004) continue
    let c = mapColor(ctx.color, ctx.rng, { x: pt.x + ctx.w / 2, y: pt.y + ctx.h / 2, w: ctx.w, h: ctx.h, t: pt.t, size: u })
    c = tame(c, chromaCap)
    if (hub) c = mixColor(c, '#ffffff', 0.35) // bright, never pure white
    nodes.push({
      x: pt.x, y: pt.y, z: pt.z, r, c, a, soft: 0.35,
      glow: hub && halo > 0.02, glowScale: 2.2, glowAlpha: Math.min(0.5, halo * 0.55 * nodeGuard),
      glowR: r * 1.6 + glowRadius * 0.5,
    })
  }

  const out: EEdge[] = []
  for (const e of edges) {
    if (!vis[e.a] || !vis[e.b]) continue
    let a = lineOpacity * Math.pow(Math.max(0, 1 - e.len / maxLenPx), lineFalloff)
    if (isHub[e.a] === 1 || isHub[e.b] === 1) a = Math.min(lineOpacity, a * 1.5 + 0.03)
    a *= edgeGuard
    if (a < 0.02) continue
    const t = (pts[e.a].t + pts[e.b].t) / 2
    out.push({
      ax: pts[e.a].x, ay: pts[e.a].y, az: pts[e.a].z,
      bx: pts[e.b].x, by: pts[e.b].y, bz: pts[e.b].z,
      a, w: lineWidth, c: tame(rampOklch(palette, t), chromaCap),
    })
  }

  // dust: sparse specks filling the same world volume
  const nd = Math.round(n * dust * 0.4)
  for (let i = 0; i < nd; i++) {
    const x = (ctx.rng.next() - 0.5) * ctx.w
    const y = (ctx.rng.next() - 0.5) * ctx.h
    const z = (ctx.rng.next() - 0.5) * ctx.minDim * 0.6
    const c = tame(mapColor(ctx.color, ctx.rng, { x: x + ctx.w / 2, y: y + ctx.h / 2, w: ctx.w, h: ctx.h, t: ctx.rng.next(), size: 0 }), chromaCap)
    nodes.push({
      x, y, z, r: ctx.rng.range(0.6, 1.6), c,
      a: ctx.rng.range(0.1, 0.28) * nodeGuard, soft: 0.9,
      glow: false, glowScale: 1, glowAlpha: 0, glowR: 0,
    })
  }

  return done(ctx.w, ctx.h, emitScene3D(nodes, out, emitOpts))
}
