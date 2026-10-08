/**
 * surface3d/build.ts — Sample the height field and emit it through scene3d.
 *
 * The grid is sampled once (heights + normals), projected once for the
 * distance-LOD keep mask, then drawn per structure: dotted rows, dot
 * lattice, triangle / quad wireframe with nodes, hex honeycomb with vertex
 * nodes, marching-squares contours, or a sparse perspective grid. Accent
 * nodes are the highest crests, drawn in the last palette colour.
 * Pure, no DOM.
 */

import { mixColor } from '../../palette'
import { mapColor } from '../../palette'
import { capChroma, capYellow, rampOklch } from '../../field/oklab'
import type { GenContext, Params } from '../../schema'
import { done, num, str } from '../kit'
import { alphaForLoad } from '../density'
import { makeCamera, project, type CamParams } from '../../scene3d/camera'
import { emitScene3D, defaultEmitOpts, type EEdge, type ENode } from '../../scene3d/emit'
import { shadePoint } from '../../scene3d/shade'
import { clamp01, norm } from '../../scene3d/math'
import { makeField } from './field'

/** Deep base the atmosphere drifts toward (all presets sit on dark). */
export const ATM_BG = '#05070d'
const MAX_SEGS = 12000
const CONTOUR_LEVELS = 7

function tame(c: string, cap: number): string {
  return capYellow(capChroma(c, cap))
}

export function camFromParams(p: Params): CamParams {
  return {
    yaw: num(p, 'yaw', 0), pitch: num(p, 'pitch', 58), roll: num(p, 'roll', 0),
    distance: num(p, 'distance', 1.9), fov: num(p, 'fov', 46),
    height: num(p, 'camHeight', 0), lookX: num(p, 'lookX', 0), lookY: num(p, 'lookY', 0.02),
  }
}

interface VRef {
  x: number
  y: number
  z: number
  h: number
  nx: number
  ny: number
  nz: number
  t: number
  done?: boolean
}

export function generateSurface3d(p: Params, ctx: GenContext): ReturnType<typeof done> {
  const structure = str(p, 'structure', 'tri')
  const res = Math.max(12, Math.min(80, Math.round(num(p, 'resolution', 44))))
  const lod = num(p, 'lod', 1)
  const lineWidth = num(p, 'lineWidth', 1.1)
  const lineOpacity = clamp01(num(p, 'lineOpacity', 0.4))
  const edgeGlow = clamp01(num(p, 'edgeGlow', 0.5))
  const fade = clamp01(num(p, 'fade', 0.4))
  const nodeSize = num(p, 'nodeSize', 5)
  const alpha = clamp01(num(p, 'alpha', 0.85))
  const accentRatio = clamp01(num(p, 'accentRatio', 0.06))
  const chromaCap = num(p, 'chromaCap', 0.16)
  const fog = clamp01(num(p, 'fog', 0.5))

  const field = makeField({
    amplitude: num(p, 'amplitude', 90), wavelength: num(p, 'wavelength', 320),
    waveDir: num(p, 'waveDir', 25), turbulence: num(p, 'turbulence', 0.45),
    warp: num(p, 'warp', 0.35), ridge: num(p, 'ridge', 0.25),
    fold: num(p, 'fold', 0), seed: ctx.seed,
  })
  const cam = makeCamera(camFromParams(p), ctx.w, ctx.h)
  const emitOpts = {
    ...defaultEmitOpts(cam, ATM_BG),
    focal: clamp01(num(p, 'focal', 0.45)), focalRange: num(p, 'focalRange', 0.08),
    dof: clamp01(num(p, 'dof', 0.55)), cocMax: num(p, 'cocMax', 26), fog,
    bucketRef: Math.max(0.05, lineOpacity),
  }

  const palette = ctx.color.palette.colors.length ? ctx.color.palette.colors : ['#22e0ff']
  const accent = tame(palette[palette.length - 1], chromaCap)
  const guard = alphaForLoad(1, (res * res) / 900)
  const nodeRefs: VRef[] = []
  const edges: EEdge[] = []
  const pushSeg = (a: VRef, b: VRef): void => {
    if (edges.length >= MAX_SEGS) return
    const dm = (project(cam, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2).depth)
    const t = (a.h + b.h) / 2
    let c = tame(rampOklch(palette, 0.25 + t * 0.55), chromaCap)
    if (edgeGlow > 0.01 && t > 0.55) {
      c = tame(mixColor(c, accent, (t - 0.55) * 2 * edgeGlow), chromaCap)
    }
    edges.push({
      ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z,
      a: lineOpacity * (1 - fade * dm) * guard, w: lineWidth, c,
    })
  }
  const light = norm({ x: -0.35, y: -0.55, z: 0.75 })

  // world grid, centred, area-normalised so counts scale with res² alone;
  // heights + normals sampled once
  const aspect = Math.sqrt(ctx.w / Math.max(1, ctx.h))
  const cols = Math.max(8, Math.min(120, Math.round(res * aspect)))
  const rows = Math.max(8, Math.min(120, Math.round(res / aspect)))
  const gx = (i: number): number => (i / Math.max(1, cols - 1) - 0.5) * ctx.w
  const gy = (j: number): number => (j / Math.max(1, rows - 1) - 0.5) * ctx.h
  const at = (i: number, j: number): VRef => {
    const s = field.sample(gx(i), gy(j))
    return { x: gx(i), y: gy(j), z: s.z, h: s.h01, nx: s.nx, ny: s.ny, nz: s.nz, t: s.h01 }
  }
  const grid: VRef[][] = []
  for (let j = 0; j < rows; j++) {
    const row: VRef[] = []
    for (let i = 0; i < cols; i++) row.push(at(i, j))
    grid.push(row)
  }
  // distance-LOD keep mask from projected depth
  const keep: Uint8Array[] = []
  for (let j = 0; j < rows; j++) {
    const kr = new Uint8Array(cols).fill(1)
    if (lod > 0.01) {
      for (let i = 0; i < cols; i++) {
        const v = grid[j][i]
        const stride = 1 + Math.floor(lod * project(cam, v.x, v.y, v.z).depth * 2.2)
        kr[i] = (i + j * 3) % stride === 0 ? 1 : 0
      }
    }
    keep.push(kr)
  }

  if (structure === 'hex') {
    // hex honeycomb mapped onto the field; dedupe shared vertices.
    // Cell size is area-normalised so the count scales with res² alone.
    const cell = Math.sqrt(ctx.w * ctx.h) / Math.max(8, res)
    const hr = cell * 0.62
    const seen = new Map<string, VRef>()
    const hexKey = (x: number, y: number): string => `${Math.round(x / (cell * 0.5))},${Math.round(y / (cell * 0.5))}`
    const corner = (cx: number, cy: number, k: number): VRef => {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 6
      const x = cx + Math.cos(a) * hr
      const y = cy + Math.sin(a) * hr
      const key = hexKey(x, y)
      const hit = seen.get(key)
      if (hit) return hit
      const s = field.sample(x, y)
      const v: VRef = { x, y, z: s.z, h: s.h01, nx: s.nx, ny: s.ny, nz: s.nz, t: s.h01 }
      seen.set(key, v)
      return v
    }
    let row = 0
    for (let cy = -ctx.h / 2; cy <= ctx.h / 2 + cell; cy += hr * Math.sqrt(3), row++) {
      for (let cx = -ctx.w / 2 + (row % 2 ? hr * 1.5 : 0); cx <= ctx.w / 2 + cell; cx += hr * 3) {
        const c: VRef[] = []
        for (let k = 0; k < 6; k++) c.push(corner(cx, cy, k))
        for (let k = 0; k < 6; k++) {
          pushSeg(c[k], c[(k + 1) % 6])
          if (!c[k].done) { c[k].done = true; nodeRefs.push(c[k]) }
        }
      }
    }
  } else if (structure === 'contours') {
    let lo = Infinity
    let hi = -Infinity
    for (const row of grid) for (const v of row) { if (v.z < lo) lo = v.z; if (v.z > hi) hi = v.z }
    for (let lv = 0; lv < CONTOUR_LEVELS; lv++) {
      const th = lo + ((hi - lo) * (lv + 0.5)) / CONTOUR_LEVELS
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const p00 = grid[j][i].z - th
          const p10 = grid[j][i + 1].z - th
          const p01 = grid[j + 1][i].z - th
          const p11 = grid[j + 1][i + 1].z - th
          const idx = (p00 > 0 ? 8 : 0) | (p10 > 0 ? 4 : 0) | (p11 > 0 ? 2 : 0) | (p01 > 0 ? 1 : 0)
          if (idx === 0 || idx === 15) continue
          const T = { x: (grid[j][i].x + grid[j][i + 1].x) / 2, y: grid[j][i].y, z: (grid[j][i].z + grid[j][i + 1].z) / 2, h: 0.5, nx: 0, ny: 0, nz: 1, t: 0.5 }
          const R = { x: grid[j][i + 1].x, y: (grid[j][i + 1].y + grid[j + 1][i + 1].y) / 2, z: (grid[j][i + 1].z + grid[j + 1][i + 1].z) / 2, h: 0.5, nx: 0, ny: 0, nz: 1, t: 0.5 }
          const B = { x: (grid[j + 1][i].x + grid[j + 1][i + 1].x) / 2, y: grid[j + 1][i].y, z: (grid[j + 1][i].z + grid[j + 1][i + 1].z) / 2, h: 0.5, nx: 0, ny: 0, nz: 1, t: 0.5 }
          const L = { x: grid[j][i].x, y: (grid[j][i].y + grid[j + 1][i].y) / 2, z: (grid[j][i].z + grid[j + 1][i].z) / 2, h: 0.5, nx: 0, ny: 0, nz: 1, t: 0.5 }
          const pairs: [VRef, VRef][] =
            idx === 1 || idx === 14 ? [[L, B]] : idx === 2 || idx === 13 ? [[B, R]] :
            idx === 3 || idx === 12 ? [[L, R]] : idx === 4 || idx === 11 ? [[T, R]] :
            idx === 5 ? [[T, L], [B, R]] : idx === 6 || idx === 9 ? [[T, B]] :
            idx === 7 || idx === 8 ? [[L, T]] : idx === 10 ? [[T, R], [L, B]] : [[L, B]]
          for (const [a, b] of pairs) pushSeg(a, b)
        }
      }
    }
  } else {
    const dotRow = structure === 'dots' ? 2 : 1
    const dotCol = structure === 'dots' ? 2 : structure === 'lattice' ? 1 : 2
    for (let j = 0; j < rows; j += structure === 'grid' ? 4 : 1) {
      for (let i = 0; i < cols; i += structure === 'grid' ? 4 : 1) {
        if (structure === 'tri' || structure === 'quad') {
          if (keep[j][i] && i + 1 < cols) pushSeg(grid[j][i], grid[j][i + 1])
          if (keep[j][i] && j + 1 < rows) pushSeg(grid[j][i], grid[j + 1][i])
          if (structure === 'tri' && keep[j][i] && i + 1 < cols && j + 1 < rows) {
            pushSeg(grid[j][i + 1], grid[j + 1][i])
          }
        } else if (structure === 'grid') {
          if (i + 4 < cols) pushSeg(grid[j][i], grid[j][Math.min(cols - 1, i + 4)])
          if (j + 4 < rows) pushSeg(grid[j][i], grid[Math.min(rows - 1, j + 4)][i])
        }
        if ((structure === 'dots' || structure === 'lattice') && keep[j][i]) {
          if (j % dotRow === 0 && i % dotCol === 0) nodeRefs.push(grid[j][i])
        } else if ((structure === 'tri' || structure === 'quad') && keep[j][i]) {
          if (j % 2 === 0 && i % 2 === 0) nodeRefs.push(grid[j][i])
        }
      }
    }
  }

  // accents = highest crests; everything else shades by normal + height
  const order = nodeRefs.map((_, i) => i).sort((a, b) => nodeRefs[b].h - nodeRefs[a].h)
  const isAccent = new Uint8Array(nodeRefs.length)
  const nAcc = Math.round(nodeRefs.length * accentRatio)
  for (let k = 0; k < nAcc; k++) isAccent[order[k]] = 1
  const nodes: ENode[] = nodeRefs.map((v, i) => {
    const vv = norm({ x: cam.pos.x - v.x, y: cam.pos.y - v.y, z: cam.pos.z - v.z })
    const base = mapColor(ctx.color, ctx.rng, { x: v.x + ctx.w / 2, y: v.y + ctx.h / 2, w: ctx.w, h: ctx.h, t: v.t, size: v.h })
    return {
      x: v.x, y: v.y, z: v.z, r: Math.max(0.5, nodeSize * (0.5 + v.h * 0.9)),
      c: isAccent[i] === 1 ? accent : shadePoint(tame(base, chromaCap), v.nx, v.ny, v.nz, vv, v.h, light.x, light.y, light.z,
        { diffuse: 0.7, rim: 0.5, crest: 0.6, chromaCap }),
      a: alpha * guard, soft: 0.4,
      glow: isAccent[i] === 1, glowScale: 2.4, glowAlpha: 0.4 * guard, glowR: 0,
    }
  })

  return done(ctx.w, ctx.h, emitScene3D(nodes, edges, emitOpts))
}
