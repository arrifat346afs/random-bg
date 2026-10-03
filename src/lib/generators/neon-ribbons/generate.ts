/**
 * neon-ribbons/generate.ts — Turn params into IR nodes.
 *
 * Per ribbon: trace a centre-line, fan it into strands, emit each strand as
 * a wide soft glow (tapered outline, palette gradient, screen blend) plus a
 * white-hot core (thin spline, plus-lighter). Opacity is guarded by
 * `alphaForLoad` so dense rolls do not clip to white. Pure, no DOM.
 */

import { sampleDistribution, type Sample } from '../../dist'
import { linearPaint, solid, splineD, taperD, type Node } from '../../ir'
import { hexToHsl, hslToHex, rampColor } from '../../palette'
import type { GenContext, Params } from '../../schema'
import { colorOf, done, emitCount, emitDot, int, num, str } from '../kit'
import { alphaForLoad, ribbonLoad } from '../density'
import { isCurveKind, traceCurve, type CurveKind } from './curves'
import { strandPoints, strandWidth } from './strand'

/** Samples along one centre-line. */
const CENTRE_SAMPLES = 44
/** Coverage guess for the overlap guard (ribbons are long, thin). */
const RIBBON_COVERAGE = 0.22

/** White-hot core colour: palette colour pushed near white. */
function coreColor(c: string): string {
  if (!c.startsWith('#')) return '#ffffff'
  const [h, s] = hexToHsl(c)
  return hslToHex(h, Math.min(s, 32), 94)
}

export function generateRibbons(p: Params, ctx: GenContext): ReturnType<typeof done> {
  const rawCurve: string = str(p, 'curve', 'swirl')
  const curve: CurveKind = isCurveKind(rawCurve) ? rawCurve : 'swirl'
  const ribbons: number = emitCount(p, 3, 1)
  const strands: number = Math.max(10, Math.min(80, int(p, 'strands', 28)))
  const length: number = num(p, 'length', 0.8) * Math.hypot(ctx.w, ctx.h)
  const spread: number = num(p, 'spread', 22)
  const twist: number = num(p, 'twist', 0.8)
  const taper: number = num(p, 'taper', 0.9)
  const width: number = num(p, 'width', 5)
  const glowRadius: number = num(p, 'glowRadius', 14)
  const core: number = num(p, 'core', 0.7)
  const alpha: number = num(p, 'alpha', 0.8)
  const rotation: number = (num(p, 'rotation', 0) * Math.PI) / 180
  const perspective: number = num(p, 'perspective', 0.45)
  const colorFlow: number = num(p, 'colorFlow', 0.7)
  const sparkle: number = num(p, 'sparkle', 0.5)

  const guarded: number = alphaForLoad(alpha, ribbonLoad(ribbons, strands, RIBBON_COVERAGE))
  const anchors: Sample[] = sampleDistribution(ctx, ribbons)
  const nodes: Node[] = []
  const paletteColors: string[] = ctx.color.palette.colors.length
    ? ctx.color.palette.colors
    : ['#ffffff']

  for (let r = 0; r < ribbons; r++) {
    const anchor: Sample = anchors[r % anchors.length]
    const ribbonRng = ctx.rng.fork('ribbon', r)
    const size: number = (length * ribbonRng.range(0.6, 1.1)) / 2
    const base: number[] = traceCurve(curve, ribbonRng, anchor.x, anchor.y, size, CENTRE_SAMPLES, {
      rotation,
      perspective,
      seedPick: r,
    })
    const strandRng = ctx.rng.fork('strands', r)
    const ribbonColor: string = colorOf(ctx, { ...anchor, t: ribbons > 1 ? r / (ribbons - 1) : 0.5 }, 0.5)

    for (let s = 0; s < strands; s++) {
      const pts: number[] = strandPoints(base, strandRng, s, strands, spread, twist)
      const tCol: number = strands > 1 ? s / (strands - 1) : 0.5
      // colour gradient along the path: palette ramp driven by strand + flow
      const c0: string = rampColor(paletteColors, (tCol * 0.6 + r * 0.13) % 1)
      const c1: string = rampColor(paletteColors, (tCol * 0.6 + r * 0.13 + colorFlow * 0.5) % 1)
      const mid: string = ribbonColor
      const wScale: number = strandRng.range(0.6, 1.3)
      const w: number = width * wScale
      const x1: number = pts[0]
      const y1: number = pts[1]
      const x2: number = pts[pts.length - 2]
      const y2: number = pts[pts.length - 1]

      // wide soft glow: tapered outline with a 3-stop palette gradient
      const glowW: number = w + glowRadius * 0.55
      const d: string = taperD(pts, (t) => strandWidth(t, glowW, taper) + 0.4, 22)
      if (d) {
        nodes.push({
          g: { k: 'path', d },
          fill: linearPaint(x1, y1, x2, y2, [
            { t: 0, c: c0, o: guarded * 0.5 * (anchor.mask ?? 1) },
            { t: 0.5, c: mid, o: guarded * 0.42 * (anchor.mask ?? 1) },
            { t: 1, c: c1, o: Math.max(0.01, guarded * 0.3) },
          ]),
          op: 1,
          blend: 'screen',
        })
      }

      // white-hot core: thin spline, additive, fading head→tail
      if (core > 0.02) {
        const coreW: number = Math.max(0.6, w * 0.3)
        nodes.push({
          g: { k: 'path', d: splineD(pts, curve === 'ellipse' || curve === 'vortex', 0.5) },
          stroke: solid(coreColor(mid)),
          sw: coreW,
          cap: 'round',
          join: 'round',
          op: Math.min(1, guarded * core * 0.9),
          blend: 'plus-lighter',
          fade: { x1, y1, x2, y2, from: 1, to: 0.05 },
        })
      }
    }

    // sparkle dots scattered along the centre-line
    const dots: number = Math.round(sparkle * 14)
    for (let i = 0; i < dots; i++) {
      const idx: number = ribbonRng.int(0, CENTRE_SAMPLES)
      const x: number = base[idx * 2] + ribbonRng.normal(0, spread * 0.4)
      const y: number = base[idx * 2 + 1] + ribbonRng.normal(0, spread * 0.4)
      const dotSample: Sample = { x, y, z: 0.4, t: idx / CENTRE_SAMPLES, edge: 0, mask: anchor.mask ?? 1 }
      emitDot(
        nodes,
        { shape: 'sparkle', softness: 0.4, rays: 4, ringWidth: 0.3 },
        x,
        y,
        ribbonRng.range(3, 9),
        colorOf(ctx, dotSample, 0.7),
        guarded * 0.8,
        ribbonRng.range(0, Math.PI),
        { blend: 'plus-lighter' },
      )
    }
  }
  return done(ctx.w, ctx.h, nodes)
}
