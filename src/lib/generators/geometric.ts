/**
 * Geometric / neon — glowing lines, grids, orbits, waves, Lissajous curves
 * and spirographs. Everything is stroked path data, so it exports crisply.
 */

import type { GeneratorDef } from '../schema'
import { sampleDistribution } from '../dist'
import { solid, splineD, type Node } from '../ir'
import { colorOf, done, emitCount, int, num, str } from './kit'
import { hexToHsl, hslToHex } from '../palette'

const MODES = [
  { value: 'lines', label: 'Radial lines' },
  { value: 'grid', label: 'Grid' },
  { value: 'orbits', label: 'Orbits' },
  { value: 'waves', label: 'Waves' },
  { value: 'lissajous', label: 'Lissajous' },
  { value: 'spirograph', label: 'Spirograph' },
  { value: 'hexGrid', label: 'Hex grid' },
]

export const geometricGen: GeneratorDef = {
  id: 'geometric',
  name: 'Geometric / neon',
  icon: 'orbit',
  family: 'geometry',
  tags: ['neon', 'grid', 'lissajous', 'spirograph', 'orbits', 'lines'],
  description: 'Mathematical line art with optional neon glow.',
  params: [
    { key: 'mode', label: 'Mode', type: 'enum', options: MODES, default: 'lissajous', section: 'shape' },
    {
      key: 'count',
      label: 'Elements',
      type: 'int',
      min: 1,
      max: 400,
      step: 1,
      default: 14,
      section: 'shape',
      rand: { min: 3, max: 60 },
    },
    {
      key: 'width',
      label: 'Stroke width',
      type: 'float',
      min: 0.3,
      max: 40,
      step: 0.1,
      default: 2.4,
      section: 'style',
      unit: 'px',
      rand: { min: 0.8, max: 12 },
    },
    {
      key: 'glow',
      label: 'Neon glow',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.7,
      section: 'style',
      hint: 'Additive halo around each stroke.',
      rand: { min: 0, max: 1 },
    },
    {
      key: 'glowWidth',
      label: 'Glow width',
      type: 'float',
      min: 1,
      max: 40,
      step: 0.5,
      default: 9,
      section: 'style',
      unit: 'px',
    },
    {
      key: 'radius',
      label: 'Radius',
      type: 'float',
      min: 0.05,
      max: 1.2,
      step: 0.01,
      default: 0.42,
      section: 'shape',
      unit: '×',
      hint: 'Fraction of the shorter canvas edge.',
    },
    {
      key: 'ratioA',
      label: 'Frequency X',
      type: 'float',
      min: 1,
      max: 16,
      step: 1,
      default: 3,
      section: 'shape',
      when: { key: 'mode', equals: 'lissajous' },
    },
    {
      key: 'ratioB',
      label: 'Frequency Y',
      type: 'float',
      min: 1,
      max: 16,
      step: 1,
      default: 4,
      section: 'shape',
      when: { key: 'mode', equals: 'lissajous' },
    },
    {
      key: 'teeth',
      label: 'Spirograph R/r',
      type: 'float',
      min: 1,
      max: 24,
      step: 0.5,
      default: 7,
      section: 'shape',
      when: { key: 'mode', equals: 'spirograph' },
    },
    {
      key: 'phase',
      label: 'Phase',
      type: 'float',
      min: 0,
      max: 360,
      step: 1,
      default: 0,
      section: 'motion',
      unit: '°',
    },
    {
      key: 'spin',
      label: 'Rotation per element',
      type: 'float',
      min: 0,
      max: 180,
      step: 1,
      default: 7,
      section: 'motion',
      unit: '°',
    },
    {
      key: 'gridSteps',
      label: 'Grid steps',
      type: 'int',
      min: 2,
      max: 40,
      step: 1,
      default: 9,
      section: 'shape',
      when: { key: 'mode', equals: 'grid' },
    },
    {
      key: 'waveAmp',
      label: 'Wave amplitude',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.28,
      section: 'shape',
      when: { key: 'mode', equals: 'waves' },
    },
    {
      key: 'jitter',
      label: 'Jitter',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.06,
      section: 'shape',
      hint: 'Slight randomness so it does not look like a wireframe.',
    },
    {
      key: 'dash',
      label: 'Dashed',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0,
      section: 'style',
      hint: '0 = solid.',
    },
    {
      key: 'alpha',
      label: 'Opacity',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.85,
      section: 'style',
      rand: { min: 0.4, max: 1 },
    },
    {
      key: 'resolution',
      label: 'Resolution',
      type: 'int',
      min: 16,
      max: 480,
      step: 4,
      default: 160,
      section: 'shape',
      hint: 'Samples per curve.',
    },
  ],
  defaults: () => ({
    mode: 'lissajous',
    count: 14,
    width: 2.4,
    glow: 0.7,
    glowWidth: 9,
    radius: 0.42,
    ratioA: 3,
    ratioB: 4,
    teeth: 7,
    phase: 0,
    spin: 7,
    gridSteps: 9,
    waveAmp: 0.28,
    jitter: 0.06,
    dash: 0,
    alpha: 0.85,
    resolution: 160,
  }),
  density: (p) => num(p, 'count', 14) * num(p, 'resolution', 160) * 0.5,
  generate(p, ctx) {
    const mode = str(p, 'mode', 'lissajous')
    // shape-based: a single element is valid — exempt from MIN_EMIT
    const count = emitCount(p, 14, 1)
    const width = num(p, 'width', 2.4)
    const glow = num(p, 'glow', 0.7)
    const glowW = num(p, 'glowWidth', 9)
    const radius = num(p, 'radius', 0.42) * Math.min(ctx.w, ctx.h)
    const phase = (num(p, 'phase', 0) * Math.PI) / 180
    const spin = (num(p, 'spin', 7) * Math.PI) / 180
    const jitter = num(p, 'jitter', 0.06)
    const dash = num(p, 'dash', 0)
    const alpha = num(p, 'alpha', 0.85)
    const res = Math.max(16, int(p, 'resolution', 160))
    const steps = int(p, 'gridSteps', 9)
    const amp = num(p, 'waveAmp', 0.28)
    const ratioA = num(p, 'ratioA', 3)
    const ratioB = num(p, 'ratioB', 4)
    const teeth = num(p, 'teeth', 7)
    const cx = ctx.w / 2
    const cy = ctx.h / 2

    const nodes: Node[] = []
    const dashArr = dash > 0.02 ? [width * 6, width * 6 * dash * 3] : undefined

    const emit = (pts: number[], c: string, op: number, w = width) => {
      if (pts.length < 4) return
      const d = splineD(pts, mode === 'orbits' || mode === 'spirograph', 0.35)
      if (glow > 0.02) {
        nodes.push({
          g: { k: 'path', d },
          stroke: solid(c),
          sw: w + glowW * glow,
          cap: 'round',
          join: 'round',
          op: Math.min(1, op * glow * 0.5),
          blur: glowW * glow * 0.7,
          blend: 'plus-lighter',
          ...(dashArr ? { dash: dashArr } : {}),
        })
      }
      nodes.push({
        g: { k: 'path', d },
        stroke: solid(lighten(c, glow * 0.3)),
        sw: w,
        cap: 'round',
        join: 'round',
        op: Math.min(1, op),
        ...(dashArr ? { dash: dashArr } : {}),
      })
    }

    const samples = sampleDistribution(ctx, mode === 'grid' || mode === 'hexGrid' ? 1 : count)

    switch (mode) {
      case 'grid': {
        const span = ctx.minDim * (0.4 + num(p, 'radius', 0.42))
        const cw = span / steps
        const ch = span / steps
        const x0 = cx - (cw * steps) / 2
        const y0 = cy - (ch * steps) / 2
        for (let i = 0; i <= steps; i++) {
          const jx = ctx.rng.normal(0, jitter * cw * 0.4)
          const jy = ctx.rng.normal(0, jitter * ch * 0.4)
          const col = colorOf(ctx, { ...samples[0], t: i / steps }, i / steps)
          emit(
            [x0 + i * cw + jx, y0 - ch * 0.3, x0 + i * cw + jx, y0 + ch * (steps + 0.3)],
            col,
            alpha,
            width,
          )
          emit(
            [x0 - cw * 0.3, y0 + i * ch + jy, x0 + cw * (steps + 0.3), y0 + i * ch + jy],
            colorOf(ctx, { ...samples[0], t: 1 - i / steps }, 1 - i / steps),
            alpha,
            width,
          )
        }
        break
      }
      case 'hexGrid': {
        const R = (radius * 2) / Math.max(3, steps)
        const w = Math.sqrt(3) * R
        const h = 1.5 * R
        const c = colorOf(ctx, samples[0], 0.5)
        for (let row = -Math.ceil(ctx.h / h / 2) - 1; row < ctx.h / h / 2 + 1; row++) {
          for (let col = -Math.ceil(ctx.w / w / 2) - 1; col < ctx.w / w / 2 + 1; col++) {
            const x = cx + col * w + (row % 2 ? w / 2 : 0)
            const y = cy + row * h
            if (Math.hypot(x - cx, y - cy) > radius * 1.4 + Math.max(ctx.w, ctx.h) * 0.35) continue
            const pts: number[] = []
            for (let i = 0; i <= 6; i++) {
              const a = (i / 6) * Math.PI * 2 + Math.PI / 6
              pts.push(x + Math.cos(a) * R * 0.92, y + Math.sin(a) * R * 0.92)
            }
            emit(pts, c, alpha * 0.75, width)
          }
        }
        break
      }
      case 'lines': {
        for (let i = 0; i < count; i++) {
          const s = samples[i % samples.length]
          const a = phase + (i / count) * Math.PI * 2 + ctx.rng.normal(0, jitter)
          const r0 = radius * ctx.rng.range(0.05, 0.5)
          const r1 = radius * ctx.rng.range(0.7, 1.3)
          const c = colorOf(ctx, { ...s, t: i / count }, i / count)
          emit(
            [
              cx + Math.cos(a) * r0,
              cy + Math.sin(a) * r0,
              cx + Math.cos(a) * r1,
              cy + Math.sin(a) * r1,
            ],
            c,
            alpha,
            width * ctx.rng.range(0.6, 1.5),
          )
        }
        break
      }
      case 'orbits': {
        for (let i = 0; i < count; i++) {
          const s = samples[i % samples.length]
          const t = i / count
          const r = radius * (0.25 + t)
          const rot = spin * i + phase
          const squash = 0.35 + ((i * 0.37) % 1) * 0.75
          const pts: number[] = []
          for (let k = 0; k <= res; k++) {
            const a = (k / res) * Math.PI * 2
            const x = Math.cos(a) * r
            const y = Math.sin(a) * r * squash
            pts.push(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot))
          }
          emit(pts, colorOf(ctx, { ...s, t }, t), alpha, width)
        }
        break
      }
      case 'waves': {
        for (let i = 0; i < count; i++) {
          const s = samples[i % samples.length]
          const t = count > 1 ? i / (count - 1) : 0.5
          const baseY = cy + (t - 0.5) * ctx.h * (0.35 + radius * 0.9)
          const pts: number[] = []
          for (let k = 0; k <= res; k++) {
            const u = k / res
            const x = u * ctx.w
            const y =
              baseY +
              Math.sin(u * Math.PI * 2 * (1.5 + i * 0.5) + phase) *
                ctx.h *
                amp *
                (0.4 + 0.6 * Math.sin(u * Math.PI))
            pts.push(x, y)
          }
          emit(pts, colorOf(ctx, { ...s, t }, t), alpha, width * (1 - t * 0.4))
        }
        break
      }
      case 'lissajous': {
        for (let i = 0; i < count; i++) {
          const s = samples[i % samples.length]
          const t = count > 1 ? i / (count - 1) : 0.5
          const r = radius * (0.5 + t * 0.75)
          const pts: number[] = []
          const dph = phase + spin * i
          for (let k = 0; k <= res; k++) {
            const u = (k / res) * Math.PI * 2
            pts.push(
              cx + Math.sin(u * ratioA + dph) * r,
              cy + Math.sin(u * ratioB) * r * (0.75 + jitter),
            )
          }
          emit(pts, colorOf(ctx, { ...s, t }, t), alpha, width)
        }
        break
      }
      case 'spirograph': {
        const R = radius
        for (let i = 0; i < count; i++) {
          const s = samples[i % samples.length]
          const t = count > 1 ? i / (count - 1) : 0.5
          const r = R * (0.3 + t * 0.6)
          const k = teeth * (0.6 + t * 0.7)
          const pts: number[] = []
          for (let n = 0; n <= res; n++) {
            const u = (n / res) * Math.PI * 2 * Math.max(3, Math.round(teeth / 2))
            const rr = r * ((k - 1) / k + Math.cos(u) / k)
            const a = u / k + phase + spin * i
            pts.push(cx + Math.cos(a) * rr * k * 0.5, cy + Math.sin(a) * rr * k * 0.5)
          }
          emit(pts, colorOf(ctx, { ...s, t }, t), alpha, width)
        }
        break
      }
    }

    return done(ctx.w, ctx.h, nodes)
  },
}

function lighten(c: string, t: number): string {
  if (!c.startsWith('#')) return c
  const [h, s, l] = hexToHsl(c)
  return hslToHex(h, s, Math.min(97, l + t * 45))
}
