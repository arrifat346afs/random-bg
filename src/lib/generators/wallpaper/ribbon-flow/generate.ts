/**
 * wallpaper/ribbon-flow/generate.ts — Turn params into IR nodes.
 *
 * 1–3 broad twisting ribbons with diffuse + rim lighting, like folded silk.
 * Vector throughout: tapered outlines (`taperD`), OKLCH across-gradients,
 * blurred centre highlight strokes. The long fills ride the dithered layer
 * raster so they never band (see `GeneratorDef.dither`).
 */

import type { GenContext, Params } from '../../../schema'
import { done, int, num, str, emitStroke } from '../../kit'
import { taperD, type Node } from '../../../ir'
import { rankByLightness } from '../../../field/ramp'
import { oklchFromHex, intoGamut, rampOklch, capChroma, capYellow, shiftLightness } from '../../../field/oklab'

/** Control points per ribbon centreline (off-canvas margins included). */
const SPINE_POINTS = 5
/** Taper outline samples — smooth silk, no facets. */
const TAPER_SAMPLES = 48

export function generateRibbonFlow(p: Params, ctx: GenContext): ReturnType<typeof done> {
  const count: number = Math.max(1, Math.min(3, int(p, 'ribbons', 2)))
  const widthFrac: number = num(p, 'width', 0.18)
  const curvature: number = Math.max(0, Math.min(1, num(p, 'curvature', 0.55)))
  const twist: number = Math.max(0, Math.min(1, num(p, 'twist', 0.4)))
  const rim: number = Math.max(0, Math.min(0.6, num(p, 'rim', 0.3)))
  const variant: string = str(p, 'variant', 'dark')
  const feather: number = Math.max(0.015, num(p, 'feather', 0.03))
  const alpha: number = Math.max(0.5, Math.min(1, num(p, 'alpha', 1)))

  const light = variant === 'light'
  const palette = ctx.color.palette.colors.length ? ctx.color.palette.colors : ['#ffffff']
  const ranked = rankByLightness(palette)
  const base = light ? ranked[ranked.length - 1] ?? '#f2f5fa' : ranked[0] ?? '#08080c'
  const nodes: Node[] = []
  const { w, h } = ctx
  const minDim = Math.min(w, h)
  const featherPx = Math.max(2, feather * minDim)
  const rng = ctx.rng.fork('ribbon')

  nodes.push({
    g: { k: 'rect', x: -2, y: -2, w: w + 4, h: h + 4 },
    fill: { k: 'solid', c: base },
    op: alpha,
  })

  const diag = Math.hypot(w, h)
  for (let r = 0; r < count; r++) {
    const t = count === 1 ? 0.5 : r / (count - 1)
    const rawBody = light
      ? shiftLightness(ranked[Math.min(ranked.length - 1, Math.floor(t * ranked.length))] ?? base, 0.16)
      : rampOklch(ranked, t)
    const cappedLab = oklchFromHex(capYellow(capChroma(rawBody, 0.22)))
    const body = intoGamut({ ...cappedLab, L: light ? Math.min(cappedLab.L, 0.92) : cappedLab.L })
    const bodyL = oklchFromHex(body).L
    // rim light capped like flow waves: at most 35% above the body
    const rimRaw = oklchFromHex(shiftLightness(body, light ? 0.05 : 0.1))
    const rimEdge = intoGamut({ ...rimRaw, L: Math.min(rimRaw.L, Math.min(0.95, bodyL * 1.35 + 0.02)) })

    // spine: a diagonal sweep with seeded lateral folds
    const ang = (rng.range(-0.5, 0.5) + (r - (count - 1) / 2) * 0.22) * Math.PI
    const dx = Math.cos(ang)
    const dy = Math.sin(ang)
    const nx = -dy
    const ny = dx
    const cx = w / 2 + rng.normal(0, w * 0.1)
    const cy = h / 2 + rng.normal(0, h * 0.1)
    const reach = diag * (0.55 + curvature * 0.35)
    const foldFreq = rng.range(1.2, 2.4)
    const foldPhase = rng.next() * Math.PI * 2
    const foldAmp = curvature * minDim * 0.35
    const spine: number[] = []
    for (let i = 0; i <= SPINE_POINTS; i++) {
      const s = i / SPINE_POINTS - 0.5
      const fold = Math.sin(s * Math.PI * foldFreq + foldPhase) * foldAmp
      spine.push(cx + dx * s * reach * 2 + nx * fold, cy + dy * s * reach * 2 + ny * fold)
    }

    // resample the spine densely for the taper outline
    const dense: number[] = []
    const SEG = 24
    for (let i = 0; i < SPINE_POINTS; i++) {
      for (let s = 0; s < SEG; s++) {
        const f = s / SEG
        const i0 = Math.max(0, i - 1)
        const i1 = i
        const i2 = Math.min(SPINE_POINTS, i + 1)
        const i3 = Math.min(SPINE_POINTS, i + 2)
        // Catmull-Rom interpolation, tension matched to ir.splineD
        const t2 = f * f
        const t3 = t2 * f
        const px = [
          spine[i0 * 2], spine[i1 * 2], spine[i2 * 2], spine[i3 * 2],
        ]
        const py = [
          spine[i0 * 2 + 1], spine[i1 * 2 + 1], spine[i2 * 2 + 1], spine[i3 * 2 + 1],
        ]
        const x = 0.5 * (2 * px[1] + (-px[0] + px[2]) * f + (2 * px[0] - 5 * px[1] + 4 * px[2] - px[3]) * t2 + (-px[0] + 3 * px[1] - 3 * px[2] + px[3]) * t3)
        const y = 0.5 * (2 * py[1] + (-py[0] + py[2]) * f + (2 * py[0] - 5 * py[1] + 4 * py[2] - py[3]) * t2 + (-py[0] + 3 * py[1] - 3 * py[2] + py[3]) * t3)
        dense.push(x, y)
      }
    }
    dense.push(spine[spine.length - 2], spine[spine.length - 1])

    const baseW = widthFrac * minDim * rng.range(0.85, 1.15)
    const pinchFreq = rng.range(0.8, 1.6)
    const pinchPhase = rng.next() * Math.PI * 2
    const outline = taperD(
      dense,
      (tt) => Math.max(2, baseW * (0.55 + 0.45 * Math.sin(tt * Math.PI)) * (1 - twist * 0.45 * Math.sin(tt * Math.PI * 2 * pinchFreq + pinchPhase) * Math.sin(tt * Math.PI))),
      TAPER_SAMPLES,
    )
    // across-ribbon light: rim / body / rim around the mid-ribbon axis
    const mx = cx
    const my = cy
    const px = nx * baseW
    const py = ny * baseW
    nodes.push({
      g: { k: 'path', d: outline },
      fill: {
        k: 'linear',
        x1: mx - px,
        y1: my - py,
        x2: mx + px,
        y2: my + py,
        stops: [
          { t: 0, c: rimEdge, o: 1 },
          { t: 0.3, c: body, o: 1 },
          { t: 0.5, c: shiftLightness(body, light ? 0.03 : 0.05), o: 1 },
          { t: 0.7, c: body, o: 1 },
          { t: 1, c: rimEdge, o: 1 },
        ],
      },
      op: alpha,
      blur: featherPx,
    })

    // soft diffuse centre light along the spine
    emitStroke(nodes, dense, light ? '#ffffff' : rimEdge, Math.max(2, baseW * 0.3), {
      op: Math.min(0.35, rim + 0.08) * alpha,
      blur: featherPx * 2.4,
    })
  }
  return done(w, h, nodes)
}
