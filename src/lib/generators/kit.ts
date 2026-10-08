/**
 * generators/kit.ts — Shared helpers every generator uses.
 *
 * Keeps generators short: param accessors, emission of the common primitive
 * families (glow, ring, star, sparkle) and consistent depth handling.
 */

import {
  buildIR,
  circle,
  discPaint,
  glowPaint,
  ngonPts,
  polyD,
  solid,
  starPts,
  type IR,
  type Node,
} from '../ir'
import { blurAt, opacityAt, sizeAt, type Sample } from '../dist'
import { mapColor, type ColorMapping, type Palette } from '../palette'
import type { DistSpec, ParamDef, Params } from '../schema'
import type { RNG } from '../rng'

/* ---- Param accessors ---------------------------------------------------- */

export const num = (p: Params, key: string, fallback = 0): number => {
  const v = p[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
export const int = (p: Params, key: string, fallback = 0): number =>
  Math.round(num(p, key, fallback))
export const str = (p: Params, key: string, fallback = ''): string => {
  const v = p[key]
  return typeof v === 'string' ? v : fallback
}
export const bool = (p: Params, key: string, fallback = false): boolean => {
  const v = p[key]
  return typeof v === 'boolean' ? v : fallback
}
export const list = (p: Params, key: string, fallback = ''): string => {
  const v = p[key]
  return typeof v === 'string' ? v : fallback
}

/* ---- Shared ParamDefs --------------------------------------------------- */

/**
 * Floor for the `count` parameter of **particle-style** generators (a field of
 * 1–15 primitives always reads as a bug rather than a choice).
 *
 * Generators whose aesthetic *is* a single object are exempt — lens flares,
 * hero rays and single-streak generators pass `1` instead. See `emitCount`.
 */
export const MIN_EMIT = 16

/**
 * Read the `count` parameter with a floor applied.
 *
 * The floor lives in the generator's own read rather than in the ParamDef, so
 * it also covers projects imported from JSON whose stored value predates the
 * schema's `min`. Particle-style generators call this with the default floor;
 * flares / hero rays / single streaks opt out with `min = 1`.
 */
export function emitCount(p: Params, dflt: number, min = MIN_EMIT): number {
  return Math.max(min, Math.round(num(p, 'count', dflt)))
}

/**
 * The shared `count` field. `min` defaults to {@link MIN_EMIT}; exempt
 * generators pass `1` so their UI slider and randomiser keep full range.
 */
export function countParam(def: number, max = 12000, randMax = 900, min = MIN_EMIT): ParamDef {
  const floor = Math.max(1, Math.round(min))
  return {
    key: 'count',
    label: 'Count',
    type: 'int',
    min: floor,
    max,
    step: 1,
    default: def,
    section: 'shape',
    hint: 'How many primitives to emit (before modifiers repeat them).',
    rand: { min: Math.max(floor, Math.round(def * 0.35)), max: randMax },
  }
}

export function sizeParam(def: number, min = 1, max = 300, label = 'Size'): ParamDef {
  return {
    key: 'size',
    label,
    type: 'float',
    min,
    max,
    step: 0.5,
    default: def,
    section: 'shape',
    unit: 'px',
    rand: { min, max: Math.min(max, def * 3) },
  }
}

export const SECTION_LABEL: Record<string, string> = {
  shape: 'Shape',
  distribution: 'Distribution',
  style: 'Style',
  depth: 'Depth & focus',
  motion: 'Motion',
  mask: 'Mask',
  camera: 'Camera',
}

/* ---- Emission ----------------------------------------------------------- */

export interface EmitCtx {
  rng: RNG
  w: number
  h: number
  minDim: number
  color: ColorMapping
}

/** Colour for a sample, honouring the layer's colour mapping mode. */
export function colorOf(ctx: EmitCtx, s: Sample, size01 = 0.5): string {
  return mapColor(ctx.color, ctx.rng, {
    x: s.x,
    y: s.y,
    w: ctx.w,
    h: ctx.h,
    t: s.t,
    size: size01,
  })
}

/** Common depth shaping: size, alpha and blur from the sample's z. */
export function shapeOf(
  dist: DistSpec,
  s: Sample,
  baseSize: number,
): { r: number; a: number; blur: number } {
  const scale = sizeAt(dist, s.t)
  const r = Math.max(0.4, baseSize * scale * (1 - (s.z - 0.5) * 0.35))
  const a = opacityAt(dist, s)
  const blur = blurAt(dist, s, baseSize * 0.9)
  return { r, a, blur }
}

/** Finish an IR from a node list. */
export const done = (w: number, h: number, nodes: Node[]): IR => buildIR(w, h, nodes)

/* ---- Primitive builders ------------------------------------------------- */

export interface DotStyle {
  shape: 'point' | 'disc' | 'glow' | 'ring' | 'star' | 'sparkle' | 'hex'
  softness: number
  rays: number
  ringWidth: number
}

/** Emit one styled particle at (x,y) with radius r and colour c. */
export function emitDot(
  nodes: Node[],
  style: DotStyle,
  x: number,
  y: number,
  r: number,
  c: string,
  a: number,
  rot = 0,
  extra: Partial<Node> = {},
): void {
  if (a <= 0.004 || r <= 0.05) return
  switch (style.shape) {
    case 'point':
      nodes.push(circle(x, y, Math.max(0.5, r * 0.35), solid(c), { op: a, ...extra }))
      break
    case 'disc':
      nodes.push(
        circle(x, y, r, discPaint(x, y, r, c, a, Math.min(0.95, style.softness)), extra),
      )
      break
    case 'glow':
      nodes.push(
        circle(x, y, r * 2.4, glowPaint(x, y, r * 2.4, c, a), extra),
      )
      // bright core
      nodes.push(
        circle(x, y, Math.max(0.6, r * 0.35), discPaint(x, y, r * 0.35, '#ffffff', a * 0.85, 0.5), {
          ...extra,
          blend: extra.blend ?? 'plus-lighter',
        }),
      )
      break
    case 'ring': {
      const rw = Math.max(0.5, r * style.ringWidth)
      const outer = r
      const inner = Math.max(0, outer - rw)
      nodes.push(
        circle(
          x,
          y,
          outer,
          {
            k: 'radial',
            cx: x,
            cy: y,
            r: outer,
            ri: inner,
            stops: [
              { t: 0, c, o: 0 },
              { t: inner / outer, c, o: 0 },
              { t: (inner + rw * 0.4) / outer, c, o: a },
              { t: 1, c, o: 0 },
            ],
          },
          extra,
        ),
      )
      break
    }
    case 'hex':
      nodes.push({
        g: { k: 'poly', pts: ngonPts(x, y, r, 6, rot) },
        fill: discPaint(x, y, r, c, a, Math.min(0.9, style.softness)),
        op: 1,
        ...extra,
      })
      break
    case 'star': {
      const pts = starPts(x, y, r, r * 0.22, Math.max(3, Math.round(style.rays / 2)), rot)
      nodes.push({
        g: { k: 'path', d: polyD(pts) },
        fill: solid(c),
        op: a,
        blur: Math.max(r * 0.12, 0.4),
        ...extra,
      })
      nodes.push(
        circle(x, y, r * 0.4, glowPaint(x, y, r * 0.4, c, a * 0.8), {
          blend: 'plus-lighter',
          ...extra,
        }),
      )
      break
    }
    case 'sparkle': {
      // 4/6/8-ray starburst: thin tapered spikes + hot centre
      const rays = Math.max(4, Math.round(style.rays))
      const spikes = starPts(x, y, r, r * 0.06, rays, rot)
      nodes.push({
        g: { k: 'path', d: polyD(spikes) },
        fill: solid(c),
        op: a,
        blur: r * 0.1,
        ...extra,
      })
      nodes.push(
        circle(
          x,
          y,
          r * 0.55,
          glowPaint(x, y, r * 0.55, c, a * 0.9),
          { blend: 'plus-lighter', ...extra },
        ),
      )
      break
    }
  }
}

/** Filled outline for a stroked curve (used by trails/flow/emitters). */
export function emitStroke(
  nodes: Node[],
  pts: number[],
  color: string,
  width: number,
  opts: Partial<Node> & { fadeFrom?: number; fadeTo?: number } = {},
): void {
  if (pts.length < 4) return
  const { fadeFrom, fadeTo, ...rest } = opts
  const d = polyD(pts, false)
  const node: Node = {
    g: { k: 'path', d },
    stroke: solid(color),
    sw: width,
    cap: 'round',
    join: 'round',
    op: 1,
    ...rest,
  }
  if (fadeFrom !== undefined) {
    node.fade = {
      x1: pts[0],
      y1: pts[1],
      x2: pts[pts.length - 2],
      y2: pts[pts.length - 1],
      from: fadeFrom,
      to: fadeTo ?? 0,
    }
  }
  nodes.push(node)
}

/** Palette convenience: pick colour by sample with a specific palette. */
export function paletteColor(palette: Palette, rng: RNG): string {
  return palette.colors[Math.floor(rng.next() * palette.colors.length)] ?? '#ffffff'
}
