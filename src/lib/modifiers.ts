/**
 * modifiers.ts — Stackable post-processors: `Node[] → Node[]`.
 *
 * Modifiers are order-independent with generators — generators emit geometry,
 * modifiers reshape it. Every modifier is deterministic given the layer RNG.
 */

import { createNoise } from './noise'
import { hexToHsl, hslToHex } from './palette'
import type { Node, Paint, Geo } from './ir'
import type { ModifierDef, ModifierSpec } from './schema'
import type { RNG } from './rng'

export const MODIFIER_DEFS: Record<string, ModifierDef> = {
  noise: {
    type: 'noise',
    label: 'Noise displacement',
    hint: 'Push points around with fractal noise — organic wobble.',
    amount: { label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.2 },
    secondary: { label: 'Scale', min: 0.2, max: 12, step: 0.1, default: 3 },
    tertiary: { label: 'Octaves', min: 1, max: 6, step: 1, default: 3 },
  },
  twist: {
    type: 'twist',
    label: 'Twist',
    hint: 'Rotate points around the centre by an angle proportional to radius.',
    amount: { label: 'Twist', min: -3, max: 3, step: 0.01, default: 0.6 },
    secondary: { label: 'Falloff', min: 0.2, max: 4, step: 0.05, default: 1.4 },
  },
  kaleido: {
    type: 'kaleido',
    label: 'Kaleidoscope',
    hint: 'Mirror / repeat the whole layer across N radial segments.',
    amount: { label: 'Segments', min: 2, max: 24, step: 1, default: 6 },
    secondary: { label: 'Rotational offset', min: 0, max: 1, step: 0.01, default: 0 },
    colorCapable: false,
  },
  array: {
    type: 'array',
    label: 'Repeat / array',
    hint: 'Duplicate geometry on a grid with an offset.',
    amount: { label: 'Copies', min: 1, max: 12, step: 1, default: 3 },
    secondary: { label: 'Spacing', min: 0, max: 1, step: 0.01, default: 0.25 },
    tertiary: { label: 'Rows (0 = single row)', min: 0, max: 8, step: 1, default: 0 },
  },
  scaleByPos: {
    type: 'scaleByPos',
    label: 'Scale by position',
    hint: 'Make primitives larger toward one side of the canvas.',
    amount: { label: 'Strength', min: -1, max: 1, step: 0.01, default: 0.5 },
    secondary: { label: 'Axis angle', min: 0, max: 360, step: 1, default: 0 },
  },
  colorByPos: {
    type: 'colorByPos',
    label: 'Colour by position',
    hint: 'Shift hue across the canvas.',
    amount: { label: 'Hue shift', min: -180, max: 180, step: 1, default: 60 },
    secondary: { label: 'Axis angle', min: 0, max: 360, step: 1, default: 0 },
    colorCapable: true,
  },
  axisFade: {
    type: 'axisFade',
    label: 'Fade along axis',
    hint: 'Opacity ramp from one edge to the other.',
    amount: { label: 'Fade', min: 0, max: 1, step: 0.01, default: 0.7 },
    secondary: { label: 'Axis angle', min: 0, max: 360, step: 1, default: 0 },
  },
  jitter: {
    type: 'jitter',
    label: 'Randomise jitter',
    hint: 'Random offset + rotation per primitive.',
    amount: { label: 'Position jitter', min: 0, max: 1, step: 0.01, default: 0.15 },
    secondary: { label: 'Size jitter', min: 0, max: 1, step: 0.01, default: 0.3 },
  },
}

export const MODIFIER_TYPES = Object.keys(MODIFIER_DEFS) as ModifierSpec['type'][]

export function defaultModifier(type: ModifierSpec['type']): ModifierSpec {
  const def = MODIFIER_DEFS[type]
  return {
    type,
    enabled: true,
    amount: def.amount.default,
    secondary: def.secondary?.default ?? 0,
    tertiary: def.tertiary?.default ?? 0,
  }
}

/* ---- Path parsing (absolute) ------------------------------------------- */

type Cmd = { c: string; a: number[] }
const CMD_LEN: Record<string, number> = {
  M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0,
}

export function parsePath(d: string): Cmd[] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g)
  if (!tokens) return []
  const out: Cmd[] = []
  let i = 0
  let cmd = ''
  while (i < tokens.length) {
    const t = tokens[i]
    if (/[a-zA-Z]/.test(t)) {
      cmd = t.toUpperCase()
      i++
      if (cmd === 'Z') {
        out.push({ c: 'Z', a: [] })
        continue
      }
    }
    if (!cmd) break
    const len = CMD_LEN[cmd] ?? 0
    if (len === 0) break
    const a: number[] = []
    for (let k = 0; k < len; k++) {
      const v = parseFloat(tokens[i++])
      a.push(Number.isFinite(v) ? v : 0)
    }
    out.push({ c: t === t.toLowerCase() ? cmd.toLowerCase() : cmd, a })
  }
  return out
}

/** Convert to absolute coordinates so transforms can be applied pointwise. */
export function absolutize(cmds: Cmd[]): Cmd[] {
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  const out: Cmd[] = []
  for (const cmd of cmds) {
    const rel = cmd.c === cmd.c.toLowerCase() && cmd.c !== 'Z'
    const C = cmd.c.toUpperCase()
    const a = cmd.a.slice()
    if (rel) {
      switch (C) {
        case 'M':
        case 'L':
        case 'T':
          a[0] += x
          a[1] += y
          break
        case 'H':
          a[0] += x
          break
        case 'V':
          a[0] += y
          break
        case 'C':
          a[0] += x; a[1] += y; a[2] += x; a[3] += y; a[4] += x; a[5] += y
          break
        case 'S':
        case 'Q':
          a[0] += x; a[1] += y; a[2] += x; a[3] += y
          break
        case 'A':
          a[5] += x
          a[6] += y
          break
      }
    }
    switch (C) {
      case 'M':
        x = a[0]; y = a[1]; sx = x; sy = y
        break
      case 'L':
      case 'T':
        x = a[0]; y = a[1]
        break
      case 'H':
        x = a[0]
        break
      case 'V':
        y = a[0]
        break
      case 'C':
        x = a[4]; y = a[5]
        break
      case 'S':
      case 'Q':
        x = a[2]; y = a[3]
        break
      case 'A':
        x = a[5]; y = a[6]
        break
      case 'Z':
        x = sx; y = sy
        break
    }
    out.push({ c: C, a })
  }
  return out
}

export function formatPath(cmds: Cmd[]): string {
  const r = (v: number) => (Math.round(v * 100) / 100).toString()
  return cmds
    .map((c) => c.a.length ? c.c + c.a.map(r).join(' ') : c.c)
    .join('')
}

/**
 * Apply `fn(x,y) → [x,y]` to every coordinate in a path (control points
 * included). Exact for affine transforms, a faithful approximation for the
 * non-linear modifiers — and cheap enough for thousands of nodes.
 */
export function mapPath(d: string, fn: (x: number, y: number) => [number, number]): string {
  const cmds = absolutize(parsePath(d))
  let x = 0
  let y = 0
  for (const cmd of cmds) {
    switch (cmd.c) {
      case 'M':
      case 'L':
      case 'T': {
        const [nx, ny] = fn(cmd.a[0], cmd.a[1])
        cmd.a[0] = nx; cmd.a[1] = ny; x = nx; y = ny
        break
      }
      case 'H': {
        const [nx] = fn(cmd.a[0], y)
        cmd.a[0] = nx
        x = nx
        break
      }
      case 'V': {
        const [, ny] = fn(x, cmd.a[0])
        cmd.a[0] = ny
        y = ny
        break
      }
      case 'C': {
        for (let i = 0; i < 6; i += 2) {
          const [nx, ny] = fn(cmd.a[i], cmd.a[i + 1])
          cmd.a[i] = nx
          cmd.a[i + 1] = ny
        }
        x = cmd.a[4]; y = cmd.a[5]
        break
      }
      case 'S':
      case 'Q': {
        for (let i = 0; i < 4; i += 2) {
          const [nx, ny] = fn(cmd.a[i], cmd.a[i + 1])
          cmd.a[i] = nx
          cmd.a[i + 1] = ny
        }
        x = cmd.a[2]; y = cmd.a[3]
        break
      }
      case 'A': {
        const [nx, ny] = fn(cmd.a[5], cmd.a[6])
        cmd.a[5] = nx
        cmd.a[6] = ny
        x = nx; y = ny
        break
      }
      case 'Z':
        break
    }
  }
  return formatPath(cmds)
}

/* ---- Geometry transform helpers ---------------------------------------- */

function mapGeo(g: Geo, fn: (x: number, y: number) => [number, number]): Geo {
  switch (g.k) {
    case 'circle': {
      const [x, y] = fn(g.x, g.y)
      return { ...g, x, y }
    }
    case 'ellipse': {
      const [x, y] = fn(g.x, g.y)
      return { ...g, x, y }
    }
    case 'rect': {
      // corners through fn keeps non-linear warps sane
      const [x, y] = fn(g.x, g.y)
      return { ...g, x, y }
    }
    case 'poly': {
      const pts = g.pts.slice()
      for (let i = 0; i < pts.length; i += 2) {
        const [nx, ny] = fn(pts[i], pts[i + 1])
        pts[i] = nx
        pts[i + 1] = ny
      }
      return { ...g, pts }
    }
    case 'path':
      return { ...g, d: mapPath(g.d, fn) }
  }
}

function nodeBBox(n: Node, w: number, h: number): [number, number, number, number] {
  const g = n.g
  switch (g.k) {
    case 'circle':
      return [g.x - g.r, g.y - g.r, g.x + g.r, g.y + g.r]
    case 'ellipse':
      return [g.x - g.rx, g.y - g.ry, g.x + g.rx, g.y + g.ry]
    case 'rect':
      return [g.x, g.y, g.x + g.w, g.y + g.h]
    case 'poly': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let i = 0; i < g.pts.length; i += 2) {
        x0 = Math.min(x0, g.pts[i]); x1 = Math.max(x1, g.pts[i])
        y0 = Math.min(y0, g.pts[i + 1]); y1 = Math.max(y1, g.pts[i + 1])
      }
      return [x0, y0, x1, y1]
    }
    case 'path':
      return [0, 0, w, h]
  }
}

function mapPaint(p: Paint, fn: (c: string) => string): Paint {
  if (p.k === 'solid') return { ...p, c: fn(p.c) }
  return { ...p, stops: p.stops.map((s) => ({ ...s, c: fn(s.c) })) }
}

function mapNodePaint(n: Node, fn: (c: string) => string): Node {
  return {
    ...n,
    fill: n.fill ? mapPaint(n.fill, fn) : n.fill,
    stroke: n.stroke ? mapPaint(n.stroke, fn) : n.stroke,
  }
}

/* ---- The stack ---------------------------------------------------------- */

export interface ModContext {
  w: number
  h: number
  rng: RNG
  seed: number
}

export function applyModifiers(nodes: Node[], mods: ModifierSpec[], ctx: ModContext): Node[] {
  let out = nodes
  for (const m of mods) {
    if (!m.enabled) continue
    out = applyOne(out, m, ctx)
    if (out.length > 60000) {
      out = out.slice(0, 60000)
      break
    }
  }
  return out
}

function applyOne(nodes: Node[], m: ModifierSpec, ctx: ModContext): Node[] {
  const { w, h, rng } = ctx
  const cx = w / 2
  const cy = h / 2

  switch (m.type) {
    case 'noise': {
      const n = createNoise(ctx.seed ^ 0x9e37)
      const scale = Math.max(0.1, m.secondary)
      const amp = m.amount * Math.min(w, h) * 0.12
      const oct = Math.max(1, Math.round(m.tertiary))
      return nodes.map((node) => ({
        ...node,
        g: mapGeo(node.g, (x, y) => {
          const fx = (x / Math.min(w, h)) * scale
          const fy = (y / Math.min(w, h)) * scale
          return [
            x + n.fbm(fx, fy, oct) * amp,
            y + n.fbm(fx + 17.3, fy + 9.1, oct) * amp,
          ]
        }),
      }))
    }

    case 'twist': {
      const amount = m.amount * Math.PI
      const falloff = Math.max(0.05, m.secondary)
      const maxR = Math.hypot(cx, cy) || 1
      return nodes.map((node) => ({
        ...node,
        g: mapGeo(node.g, (x, y) => {
          const dx = x - cx
          const dy = y - cy
          const r = Math.hypot(dx, dy)
          const a = amount * Math.pow(r / maxR, falloff)
          const cos = Math.cos(a)
          const sin = Math.sin(a)
          return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
        }),
      }))
    }

    case 'kaleido': {
      const segs = Math.max(2, Math.round(m.amount))
      const rot = m.secondary * Math.PI * 2
      const out: Node[] = []
      const wedge = (Math.PI * 2) / segs
      for (let s = 0; s < segs; s++) {
        const mirrored = s % 2 === 1
        for (const node of nodes) {
          let g = node.g
          if (mirrored) {
            g = mapGeo(g, (x, y) => [2 * cx - x, y])
          }
          const a = rot + s * wedge
          const cos = Math.cos(a)
          const sin = Math.sin(a)
          g = mapGeo(g, (x, y) => {
            const dx = x - cx
            const dy = y - cy
            return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos]
          })
          out.push({ ...node, g })
        }
      }
      return out
    }

    case 'array': {
      const copies = Math.max(1, Math.round(m.amount))
      const spacing = m.secondary
      const rows = Math.round(m.tertiary)
      const out: Node[] = []
      const dx = w * spacing
      const dy = h * spacing
      for (let i = 0; i < copies; i++) {
        const col = rows > 0 ? i % rows : i
        const row = rows > 0 ? Math.floor(i / rows) : 0
        const ox = col * dx
        const oy = row * dy
        for (const node of nodes) {
          out.push({ ...node, g: mapGeo(node.g, (x, y) => [x + ox, y + oy]) })
        }
      }
      return out
    }

    case 'scaleByPos': {
      const ang = (m.secondary * Math.PI) / 180
      const ux = Math.cos(ang)
      const uy = Math.sin(ang)
      const half = Math.hypot(cx, cy) || 1
      const k = m.amount
      return nodes.map((node) => {
        const [x0, y0, x1, y1] = nodeBBox(node, w, h)
        const mx = (x0 + x1) / 2
        const my = (y0 + y1) / 2
        const proj = ((mx - cx) * ux + (my - cy) * uy) / half // -1..1
        const scale = 1 + k * proj
        if (Math.abs(scale) < 0.01) return node
        return {
          ...node,
          g: scaleGeoAbout(node.g, scale, mx, my),
          sw: node.sw ? node.sw * Math.abs(scale) : node.sw,
          blur: node.blur ? node.blur * Math.abs(scale) : node.blur,
        }
      })
    }

    case 'colorByPos': {
      const ang = (m.secondary * Math.PI) / 180
      const ux = Math.cos(ang)
      const uy = Math.sin(ang)
      const half = Math.hypot(cx, cy) || 1
      const shift = m.amount
      return nodes.map((node) => {
        const [x0, y0, x1, y1] = nodeBBox(node, w, h)
        const mx = (x0 + x1) / 2
        const my = (y0 + y1) / 2
        const proj = ((mx - cx) * ux + (my - cy) * uy) / half // -1..1
        const deg = shift * proj
        return mapNodePaint(node, (c) => shiftHue(c, deg))
      })
    }

    case 'axisFade': {
      const ang = (m.secondary * Math.PI) / 180
      const ux = Math.cos(ang)
      const uy = Math.sin(ang)
      const half = Math.hypot(cx, cy) || 1
      const strength = m.amount
      return nodes.map((node) => {
        const [x0, y0, x1, y1] = nodeBBox(node, w, h)
        const mx = (x0 + x1) / 2
        const my = (y0 + y1) / 2
        const proj = ((mx - cx) * ux + (my - cy) * uy) / half // -1..1
        const t = (proj + 1) / 2 // 0..1
        const fade = 1 - strength * t
        return { ...node, op: (node.op ?? 1) * Math.max(0, fade) }
      })
    }

    case 'jitter': {
      const posAmp = m.amount * Math.min(w, h) * 0.06
      const sizeJit = m.secondary
      return nodes.map((node) => {
        const dx = rng.normal(0, posAmp)
        const dy = rng.normal(0, posAmp)
        const scale = 1 + rng.normal(0, sizeJit * 0.35)
        const [x0, y0, x1, y1] = nodeBBox(node, w, h)
        const mx = (x0 + x1) / 2
        const my = (y0 + y1) / 2
        return {
          ...node,
          g: mapGeo(scaleGeoAbout(node.g, scale, mx, my), (x, y) => [x + dx, y + dy]),
          sw: node.sw ? node.sw * scale : node.sw,
        }
      })
    }
  }
  return nodes
}

function scaleGeoAbout(g: Geo, s: number, cx: number, cy: number): Geo {
  return mapGeo(g, (x, y) => [cx + (x - cx) * s, cy + (y - cy) * s])
}

function shiftHue(hex: string, deg: number): string {
  if (deg === 0) return hex
  if (!hex.startsWith('#')) return hex
  const [h, s, l] = hexToHsl(hex)
  return hslToHex(h + deg, s, l)
}
