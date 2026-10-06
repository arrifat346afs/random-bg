/**
 * wallpaper/flow-waves/generate.ts — Turn params into IR nodes.
 *
 * WHAT IS VECTOR, WHAT IS RASTER (see the wallpaper brief):
 *  • vector paths (exact): band outlines, inter-band shadows, edge highlight
 *    lines — gradients and blur express these perfectly, no pixels needed.
 *  • raster field (smoothness): the band FILL gradients. Long OKLCH ramps
 *    quantise to visible steps at 4K/5K, so the layer carries `dither: true`
 *    and the canvas backend lands ±0.5 LSB triangular dither on its offscreen
 *    raster (SVG embeds the same raster as `<image>`).
 *
 * Bands stack to full canvas coverage: the first starts above the canvas and
 * the last ends below it, so there are no seams whatever the aspect.
 */

import type { GenContext, Params } from '../../../schema'
import { done, int, num, str, emitStroke } from '../../kit'
import { splineD, type Node } from '../../../ir'
import { rankByLightness } from '../../../field/ramp'
import { oklchFromHex, intoGamut, rampOklch, capChroma, capYellow, shiftLightness } from '../../../field/oklab'

/** Samples per band edge — dense enough that no facet survives the feather. */
const EDGE_SAMPLES = 64
/** Band path overshoot past the canvas edges (fraction of width). */
const EDGE_MARGIN = 0.08

const shiftL = shiftLightness

export function generateFlowWaves(p: Params, ctx: GenContext): ReturnType<typeof done> {
  const bands: number = Math.max(3, Math.min(5, int(p, 'bands', 4)))
  const amp: number = num(p, 'amplitude', 0.12)
  const waveLen: number = Math.max(0.4, num(p, 'wavelength', 1.1))
  const tilt: number = (num(p, 'tilt', -8) * Math.PI) / 180
  const thick: number = num(p, 'thickness', 0.22)
  const twist: number = Math.max(0, Math.min(1, num(p, 'twist', 0.3)))
  const variant: string = str(p, 'variant', 'dark')
  const feather: number = Math.max(0.015, num(p, 'feather', 0.03))
  const highlight: number = Math.max(0, Math.min(0.5, num(p, 'highlight', 0.22)))
  const alpha: number = Math.max(0.5, Math.min(1, num(p, 'alpha', 1)))

  const light = variant === 'light'
  const palette = ctx.color.palette.colors.length ? ctx.color.palette.colors : ['#ffffff']
  const ranked = rankByLightness(palette)
  const base = light ? ranked[ranked.length - 1] ?? '#f2f5fa' : ranked[0] ?? '#08080c'
  const nodes: Node[] = []
  const { w, h } = ctx
  const minDim = Math.min(w, h)
  const featherPx = Math.max(2, feather * minDim)
  const rng = ctx.rng.fork('waves')

  // opaque role-colour ground: no seams, ever
  nodes.push({
    g: { k: 'rect', x: -2, y: -2, w: w + 4, h: h + 4 },
    fill: { k: 'solid', c: base },
    op: alpha,
  })

  const slope = Math.tan(Math.max(-0.5, Math.min(0.5, tilt)))
  const k1 = (Math.PI * 2) / (waveLen * w)
  const k2 = k1 * 2
  const bandH = (h * 1.35) / bands

  for (let b = 0; b < bands; b++) {
    const t = bands === 1 ? 0.5 : b / (bands - 1)
    const phase = rng.next() * Math.PI * 2
    const phase2 = rng.next() * Math.PI * 2
    const baseY = -h * 0.18 + (b + 0.5) * bandH
    const th = thick * h * rng.range(0.85, 1.15)

    const edgeY = (x: number): number =>
      baseY + amp * h * Math.sin(k1 * x + phase) + twist * amp * h * 0.6 * Math.sin(k2 * x + phase2) + slope * (x - w / 2)

    // band outline: top edge forward, bottom edge back, closed smooth loop
    const top: number[] = []
    const bot: number[] = []
    const x0 = -w * EDGE_MARGIN
    const x1 = w * (1 + EDGE_MARGIN)
    for (let i = 0; i <= EDGE_SAMPLES; i++) {
      const x = x0 + ((x1 - x0) * i) / EDGE_SAMPLES
      top.push(x, edgeY(x))
    }
    for (let i = EDGE_SAMPLES; i >= 0; i--) {
      const x = x0 + ((x1 - x0) * i) / EDGE_SAMPLES
      bot.push(x, edgeY(x) + th)
    }
    const outline = splineD([...top, ...bot], true, 0.5)

    // calm OKLCH value ramp across the band: lit edge → body → shaded foot.
    // Hard caps, not taste: the lit edge may sit at most 35% above the body
    // (perceptual L), and light-variant bodies stop at L 0.92 so stacked
    // overlaps can never flatten to white.
    const rawBody = light
      ? shiftL(ranked[Math.min(ranked.length - 1, Math.floor(t * ranked.length))] ?? base, 0.18)
      : rampOklch(ranked, t)
    const cappedBody = capYellow(capChroma(rawBody, 0.22))
    const cappedLab = oklchFromHex(cappedBody)
    const body = intoGamut({ ...cappedLab, L: light ? Math.min(cappedLab.L, 0.92) : cappedLab.L })
    const litCap = Math.min(0.95, oklchFromHex(body).L * 1.35 + 0.02)
    const litRaw = oklchFromHex(shiftL(body, light ? 0.06 : 0.12))
    const litEdge = intoGamut({ ...litRaw, L: Math.min(litRaw.L, litCap) })
    const foot = shiftL(body, light ? -0.05 : -0.1)
    const midY = edgeY(w / 2) + th / 2
    nodes.push({
      g: { k: 'path', d: outline },
      fill: {
        k: 'linear',
        x1: w / 2,
        y1: midY - th / 2,
        x2: w / 2,
        y2: midY + th / 2,
        stops: [
          { t: 0, c: litEdge, o: 1 },
          { t: 0.45, c: body, o: 1 },
          { t: 1, c: foot, o: 1 },
        ],
      },
      op: alpha,
      blur: featherPx,
    })

    // soft shadow tucked under the previous band (along this band's top)
    if (b > 0) {
      emitStroke(nodes, top, light ? '#3a3f4a' : '#000000', th * 0.55, {
        op: (light ? 0.16 : 0.28) * alpha,
        blur: featherPx * 2.2,
      })
    }
    // soft inner light along the top edge
    if (highlight > 0.01) {
      emitStroke(nodes, top, light ? '#ffffff' : litEdge, Math.max(1.5, featherPx * 0.5), {
        op: highlight * alpha,
        blur: featherPx * 2.6,
      })
    }
  }
  return done(w, h, nodes)
}
