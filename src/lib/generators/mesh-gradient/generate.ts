/**
 * mesh-gradient/generate.ts — Turn params into IR nodes.
 *
 * A jittered, domain-warped lattice of colour control points (see
 * `field/lattice`), each rendered as one large soft radial blob over a dark
 * role-colour base. Overlapping long-falloff gradients interpolate the colours
 * smoothly — the vector analogue of a mesh gradient, so canvas and SVG agree
 * exactly. Pure, no DOM.
 */

import type { GenContext, Params } from '../../schema'
import type { GradientStop, Node } from '../../ir'
import { done, int, num, str } from '../kit'
import { buildLattice, isLatticeMapping } from '../../field/lattice'
import { shadeRoles } from '../../field/ramp'

/** Control-point bounds: 4–9 points keep blends calm and node counts tiny. */
const GRID_MIN = 2
const GRID_MAX = 5

/** Falloff stops for one colour blob: bright heart, long soft tail. */
function blobStops(color: string, alpha: number): GradientStop[] {
  return [
    { t: 0, c: color, o: alpha },
    { t: 0.35, c: color, o: alpha * 0.72 },
    { t: 0.65, c: color, o: alpha * 0.34 },
    { t: 1, c: color, o: 0 },
  ]
}

export function generateMesh(p: Params, ctx: GenContext): ReturnType<typeof done> {
  const cols: number = Math.max(GRID_MIN, Math.min(GRID_MAX, int(p, 'cols', 3)))
  const rows: number = Math.max(GRID_MIN, Math.min(GRID_MAX, int(p, 'rows', 3)))
  const jitter: number = num(p, 'jitter', 0.45)
  const warp: number = Math.max(0, Math.min(1, num(p, 'warp', 0.35)))
  const warpScale: number = num(p, 'warpScale', 1.5)
  const rawMap: string = str(p, 'mapping', 'ramp')
  const mapping = isLatticeMapping(rawMap) ? rawMap : 'ramp'
  const softness: number = num(p, 'softness', 0.8)
  const alpha: number = Math.max(0.4, Math.min(1, num(p, 'alpha', 1)))

  const colors: string[] = ctx.color.palette.colors.length ? ctx.color.palette.colors : ['#ffffff']
  const roles = shadeRoles(colors)
  const nodes: Node[] = []

  // dark role-colour ground: no transparent seams between blobs, ever
  nodes.push({
    g: { k: 'rect', x: 0, y: 0, w: ctx.w, h: ctx.h },
    fill: { k: 'solid', c: roles.dark },
    op: alpha,
  })

  const pts = buildLattice(ctx.rng.fork('mesh'), ctx.seed, colors, {
    cols,
    rows,
    jitter,
    warp,
    warpScale,
    mapping,
  })
  const cell: number = Math.max(ctx.w / cols, ctx.h / rows)
  const radius: number = Math.max(1, cell * softness * 1.15)
  for (const pt of pts) {
    const x: number = pt.x * ctx.w
    const y: number = pt.y * ctx.h
    nodes.push({
      g: { k: 'circle', x, y, r: radius },
      fill: { k: 'radial', cx: x, cy: y, r: radius, ri: 0, stops: blobStops(pt.color, alpha) },
      op: 1,
      blur: Math.max(0, radius * 0.12),
    })
  }
  return done(ctx.w, ctx.h, nodes)
}
