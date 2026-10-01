/**
 * Shape scatter — leaves, petals, snowflakes, confetti, stars, hexagons and
 * user-imported SVG `<path>` data, scattered with rotation and wobble.
 */

import type { GeneratorDef } from '../schema'
import { sampleDistribution } from '../dist'
import { ngonPts, polyD, starPts, type Node } from '../ir'
import { mapPath, parsePath, absolutize } from '../modifiers'
import { colorOf, countParam, done, emitCount, int, num, str } from './kit'
import { hslToHex, hexToHsl } from '../palette'

const SHAPES = [
  { value: 'leaf', label: 'Leaf' },
  { value: 'petal', label: 'Petal' },
  { value: 'snowflake', label: 'Snowflake' },
  { value: 'confetti', label: 'Confetti' },
  { value: 'star', label: 'Star' },
  { value: 'hex', label: 'Hexagon' },
  { value: 'heart', label: 'Heart' },
  { value: 'custom', label: 'Custom SVG path' },
]

/** Unit shapes: fit roughly in a 2×2 box centred on the origin. */
function unitShape(shape: string): string | null {
  switch (shape) {
    case 'leaf':
      return 'M0 -1 C0.62 -0.5 0.62 0.5 0 1 C-0.62 0.5 -0.62 -0.5 0 -1 Z'
    case 'petal':
      return 'M0 -1 C0.75 -0.55 0.75 0.35 0 1 C-0.75 0.35 -0.75 -0.55 0 -1 Z'
    case 'heart':
      return (
        'M0 0.75 C-0.85 0.15 -0.72 -0.62 -0.28 -0.62 C-0.1 -0.62 0 -0.45 0 -0.3 ' +
        'C0 -0.45 0.1 -0.62 0.28 -0.62 C0.72 -0.62 0.85 0.15 0 0.75 Z'
      )
    case 'snowflake': {
      const arms = 6
      let d = ''
      for (let i = 0; i < arms; i++) {
        const a = (i / arms) * Math.PI * 2 - Math.PI / 2
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        d += `M0 0L${(ca).toFixed(3)} ${(sa).toFixed(3)}`
        // side branches at 55% and 80% of the arm
        for (const f of [0.5, 0.78]) {
          const bx = ca * f
          const by = sa * f
          const bl = 0.24 * (1 - f * 0.6)
          for (const s of [-1, 1]) {
            const ba = a + s * 0.8
            d += `M${bx.toFixed(3)} ${by.toFixed(3)}L${(bx + Math.cos(ba) * bl).toFixed(3)} ${(by + Math.sin(ba) * bl).toFixed(3)}`
          }
        }
      }
      return d
    }
    default:
      return null
  }
}

/** Normalise a user path into the unit box (bbox → −1..1). */
function normalizeUserPath(d: string): string {
  const cmds = absolutize(parsePath(d))
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const c of cmds) {
    for (let i = 0; i + 1 < c.a.length; i += 2) {
      const x = c.a[i]
      const y = c.a[i + 1]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  if (!Number.isFinite(x0) || x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return d
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const s = 2 / Math.max(x1 - x0, y1 - y0)
  return mapPath(d, (x, y) => [(x - cx) * s, (y - cy) * s])
}

export const scatterGen: GeneratorDef = {
  id: 'scatter',
  name: 'Shape scatter',
  icon: 'leaf',
  family: 'particles',
  tags: ['leaves', 'petals', 'snowflakes', 'confetti', 'svg', 'autumn'],
  description: 'Scatter silhouettes with rotation, wobble and optional outlines.',
  params: [
    countParam(180, 5000, 420),
    { key: 'shape', label: 'Shape', type: 'enum', options: SHAPES, default: 'leaf', section: 'shape' },
    {
      key: 'customPath',
      label: 'SVG path data',
      type: 'path',
      default: '',
      section: 'shape',
      when: { key: 'shape', equals: 'custom' },
      hint: 'Paste the `d` attribute of any <path>. It is normalised to fit.',
    },
    {
      key: 'size',
      label: 'Size',
      type: 'float',
      min: 2,
      max: 320,
      step: 1,
      default: 34,
      section: 'shape',
      unit: 'px',
      rand: { min: 8, max: 90 },
    },
    {
      key: 'sizeVary',
      label: 'Size variance',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.55,
      section: 'shape',
    },
    {
      key: 'rotate',
      label: 'Rotation range',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 1,
      section: 'shape',
      hint: '0 = all aligned, 1 = full free rotation.',
    },
    {
      key: 'wobble',
      label: 'Wobble',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.25,
      section: 'motion',
      hint: 'Bend each shape with a sine so it reads as fluttering.',
    },
    {
      key: 'wobblePhase',
      label: 'Wavelength',
      type: 'float',
      min: 0.5,
      max: 12,
      step: 0.1,
      default: 4,
      section: 'motion',
    },
    {
      key: 'outline',
      label: 'Outline',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.25,
      section: 'style',
      hint: 'Stroke around the silhouette (leaf edges, flake detail).',
      rand: { min: 0, max: 0.7 },
    },
    {
      key: 'outlineWidth',
      label: 'Outline width',
      type: 'float',
      min: 0.2,
      max: 12,
      step: 0.1,
      default: 1.4,
      section: 'style',
      unit: 'px',
    },
    {
      key: 'shade',
      label: 'Inner shading',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.5,
      section: 'style',
      hint: 'Radial gradient inside each shape for a lit look.',
    },
    {
      key: 'alpha',
      label: 'Opacity',
      type: 'float',
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.9,
      section: 'style',
      rand: { min: 0.5, max: 1 },
    },
    {
      key: 'hueJitter',
      label: 'Hue jitter',
      type: 'float',
      min: 0,
      max: 90,
      step: 1,
      default: 14,
      section: 'style',
      unit: '°',
      hint: 'Small hue drift per item — natural variation.',
    },
    {
      key: 'sides',
      label: 'Points',
      type: 'int',
      min: 4,
      max: 16,
      step: 1,
      default: 5,
      section: 'shape',
      when: { key: 'shape', equals: 'star' },
    },
  ],
  defaults: () => ({
    count: 180,
    shape: 'leaf',
    customPath: '',
    size: 34,
    sizeVary: 0.55,
    rotate: 1,
    wobble: 0.25,
    wobblePhase: 4,
    outline: 0.25,
    outlineWidth: 1.4,
    shade: 0.5,
    alpha: 0.9,
    hueJitter: 14,
    sides: 5,
  }),
  density: (p) => num(p, 'count', 180) * 3,
  generate(p, ctx) {
    const count = emitCount(p, 180)
    const samples = sampleDistribution(ctx, count)
    const shape = str(p, 'shape', 'leaf')
    const size = num(p, 'size', 34)
    const vary = num(p, 'sizeVary', 0.55)
    const rotRange = num(p, 'rotate', 1)
    const wobble = num(p, 'wobble', 0.25)
    const wavelength = num(p, 'wobblePhase', 4)
    const outline = num(p, 'outline', 0.25)
    const outlineW = num(p, 'outlineWidth', 1.4)
    const shade = num(p, 'shade', 0.5)
    const alpha = num(p, 'alpha', 0.9)
    const hueJitter = num(p, 'hueJitter', 14)
    const sides = int(p, 'sides', 5)

    const nodes: Node[] = []
    let unit: string
    if (shape === 'custom') {
      const raw = str(p, 'customPath', '').trim()
      unit = raw ? normalizeUserPath(raw) : ''
    } else if (shape === 'star') {
      unit = polyD(starPts(0, 0, 1, 0.44, Math.max(3, sides)))
    } else if (shape === 'hex') {
      unit = polyD(ngonPts(0, 0, 1, 6))
    } else {
      unit = unitShape(shape) ?? ''
    }
    const isStrokeShape = shape === 'snowflake'
    const confetti = shape === 'confetti'

    for (const s of samples) {
      if (!unit && !confetti) continue
      const r = Math.max(1, size * (1 - vary * 0.5 + ctx.rng.range(0, vary)) * (1 - (s.z - 0.5) * 0.3))
      const a = alpha * (s.mask ?? 1) * (1 - s.z * 0.25)
      if (a <= 0.01) continue
      let c = colorOf(ctx, s, r / Math.max(1, ctx.minDim * 0.2))
      if (hueJitter > 0) {
        const [h, sat, l] = hexToHsl(c)
        c = hslToHex(h + ctx.rng.normal(0, hueJitter * 0.5), sat, l)
      }
      const angle = ctx.rng.range(0, Math.PI * 2) * rotRange + (1 - rotRange) * -Math.PI / 2

      if (confetti) {
        const w = r * ctx.rng.range(0.35, 1)
        const h = r * ctx.rng.range(0.6, 1.4)
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const corners = [
          [-w / 2, -h / 2],
          [w / 2, -h / 2],
          [w / 2, h / 2],
          [-w / 2, h / 2],
        ]
        const pts: number[] = []
        for (const [ox, oy] of corners) {
          pts.push(s.x + ox * cos - oy * sin, s.y + ox * sin + oy * cos)
        }
        nodes.push({
          g: { k: 'poly', pts },
          fill: { k: 'solid', c },
          op: a,
          ...(outline > 0.02
            ? { stroke: shadePath(c), sw: outlineW, join: 'round' as const }
            : {}),
        })
        continue
      }

      const d = mapPath(unit, (x, y) => {
        // rotate + scale + translate, with a sine shear so shapes flutter
        const bend = wobble > 0 ? Math.sin(y * wavelength) * wobble * 0.45 : 0
        const sx = x + bend
        const rx = sx * Math.cos(angle) - y * Math.sin(angle)
        const ry = sx * Math.sin(angle) + y * Math.cos(angle)
        return [s.x + rx * r, s.y + ry * r * (1 + bend * 0.15)]
      })

      const fill = shade > 0.02
        ? {
            k: 'radial' as const,
            cx: s.x - r * 0.25,
            cy: s.y - r * 0.3,
            r: r * 1.6,
            stops: [
              { t: 0, c: lighten(c, 0.35 * shade), o: 1 },
              { t: 0.55, c, o: 1 },
              { t: 1, c: darken(c, 0.4 * shade), o: 1 },
            ],
          }
        : { k: 'solid' as const, c }

      const node: Node = {
        g: { k: 'path', d },
        fill,
        op: Math.min(1, a),
      }
      if (outline > 0.02) {
        node.stroke = { k: 'solid', c: darken(c, 0.35) }
        node.sw = outlineW
        node.join = 'round'
        node.op = Math.min(1, a)
      }
      if (isStrokeShape) {
        // snowflakes read better as strokes than fills
        node.fill = outline > 0.05 ? fill : { k: 'solid', c }
        node.stroke = { k: 'solid', c: lighten(c, 0.3) }
        node.sw = Math.max(1, r * 0.12)
        node.cap = 'round'
      }
      nodes.push(node)
    }
    return done(ctx.w, ctx.h, nodes)
  },
}

function shadePath(c: string): { k: 'solid'; c: string } {
  return { k: 'solid', c: darken(c, 0.3) }
}

function lighten(c: string, t: number): string {
  if (!c.startsWith('#')) return c
  const [h, s, l] = hexToHsl(c)
  return hslToHex(h, s, Math.min(96, l + t * 60))
}
function darken(c: string, t: number): string {
  if (!c.startsWith('#')) return c
  const [h, s, l] = hexToHsl(c)
  return hslToHex(h, s, Math.max(2, l - t * 60))
}

// keep referenced (star/hex helpers exported for presets)
export const scatterShapes = SHAPES
export { starPts, polyD, ngonPts }
