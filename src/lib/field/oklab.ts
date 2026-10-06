/**
 * field/oklab.ts — Perceptual colour math for wallpaper surfaces.
 *
 * sRGB interpolation dulls gradients (the "muddy midtones" problem): the
 * midpoint of two vivid colours collapses toward grey. Interpolating in
 * OKLab/OKLCH keeps chroma up, so silk waves and mesh fields stay luminous.
 * Coefficients are Björn Ottosson's (MIT): linear-sRGB → LMS → Lab.
 *
 * Pure TypeScript, no DOM. Hex in, hex out — generators never touch floats.
 */

import { hexToRgb, rgbToHex } from '../palette'

/** OKLab triple: L 0..1, a/b roughly −0.4..0.4. */
export interface OkLab {
  L: number
  a: number
  b: number
}

/** OKLCH triple: L 0..1, C ≥ 0, H 0..360. */
export interface OkLCH {
  L: number
  C: number
  H: number
}

/** sRGB EOTF (exact curve — the 2.2 shortcut shifts dark blues). */
function linearize(v: number): number {
  const x = v / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

function delinearize(v: number): number {
  const x = Math.max(0, v)
  return Math.round((x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255)
}

const cbrt = (v: number): number => (v < 0 ? -Math.pow(-v, 1 / 3) : Math.pow(v, 1 / 3))

/** Hex → OKLab. */
export function oklabFromHex(hex: string): OkLab {
  const [r0, g0, b0] = hexToRgb(hex)
  const r = linearize(r0)
  const g = linearize(g0)
  const b = linearize(b0)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const lp = cbrt(l)
  const mp = cbrt(m)
  const sp = cbrt(s)
  return {
    L: 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp,
    a: 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp,
    b: 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp,
  }
}

/** OKLab → hex (out-of-gamut channels clip — use `intoGamut` first). */
export function hexFromOklab(lab: OkLab): string {
  const lp = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b
  const mp = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b
  const sp = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b
  const l = lp * lp * lp
  const m = mp * mp * mp
  const s = sp * sp * sp
  return rgbToHex(
    delinearize(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    delinearize(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    delinearize(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  )
}

/** Hex → OKLCH. */
export function oklchFromHex(hex: string): OkLCH {
  const [r0, g0, b0] = hexToRgb(hex)
  return oklchFromRgb(r0, g0, b0)
}

/** 8-bit sRGB triple → OKLCH (for pixel loops — no hex round trip). */
export function oklchFromRgb(r0: number, g0: number, b0: number): OkLCH {
  const r = linearize(r0)
  const g = linearize(g0)
  const b = linearize(b0)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const lp = cbrt(l)
  const mp = cbrt(m)
  const sp = cbrt(s)
  const a = 1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp
  const bb = 0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp
  const L = 0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp
  const C = Math.hypot(a, bb)
  let H = 0
  if (C >= 1e-6) {
    H = (Math.atan2(bb, a) * 180) / Math.PI
    if (H < 0) H += 360
  }
  return { L, C, H }
}

/** OKLCH → hex (clips — use `intoGamut` first). */
export function hexFromOklch(lch: OkLCH): string {
  const rad = (lch.H * Math.PI) / 180
  return hexFromOklab({ L: lch.L, a: lch.C * Math.cos(rad), b: lch.C * Math.sin(rad) })
}

/** True when every 8-bit channel survived the round trip (no clipping). */
export function inGamut(lab: OkLab): boolean {
  const lp = lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b
  const mp = lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b
  const sp = lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b
  const l = lp * lp * lp
  const m = mp * mp * mp
  const s = sp * sp * sp
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return r >= -0.002 && r <= 1.002 && g >= -0.002 && g <= 1.002 && bl >= -0.002 && bl <= 1.002
}

/**
 * Pull a colour into sRGB gamut, preserving lightness and hue: binary-search
 * chroma down (≤12 steps). Returns the hex directly.
 */
export function intoGamut(lch: OkLCH): string {
  const lab = { L: lch.L, a: lch.C * Math.cos((lch.H * Math.PI) / 180), b: lch.C * Math.sin((lch.H * Math.PI) / 180) }
  if (inGamut(lab)) return hexFromOklab(lab)
  let lo = 0
  let hi = lch.C
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2
    const rad = (lch.H * Math.PI) / 180
    if (inGamut({ L: lch.L, a: mid * Math.cos(rad), b: mid * Math.sin(rad) })) lo = mid
    else hi = mid
  }
  const rad = (lch.H * Math.PI) / 180
  return hexFromOklab({ L: lch.L, a: lo * Math.cos(rad), b: lo * Math.sin(rad) })
}

/** Perceptual midpoint chain: sample `colors` as a smooth OKLCH ramp at t. */
export function rampOklch(colors: string[], t: number): string {
  if (!colors.length) return '#ffffff'
  if (colors.length === 1) return colors[0]
  const x = Math.max(0, Math.min(1, t)) * (colors.length - 1)
  const i = Math.min(colors.length - 2, Math.floor(x))
  const f = x - i
  const A = oklchFromHex(colors[i])
  const B = oklchFromHex(colors[i + 1])
  // shortest hue path so ramps never swing the long way around the wheel
  let dh = B.H - A.H
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  return intoGamut({ L: A.L + (B.L - A.L) * f, C: A.C + (B.C - A.C) * f, H: (A.H + dh * f + 360) % 360 })
}

/** Cap chroma at `maxC`, preserving lightness and hue. */
export function capChroma(hex: string, maxC: number): string {
  const c = oklchFromHex(hex)
  if (c.C <= maxC) return hex
  return intoGamut({ ...c, C: maxC })
}

/**
 * Extra chroma leash for near-yellow hues (H 95–105°): they clip to harsh
 * neon faster than any other hue, so they get a lower ceiling.
 */
export function capYellow(hex: string, maxC = 0.12): string {
  const c = oklchFromHex(hex)
  const dH = Math.min(Math.abs(c.H - 100), 360 - Math.abs(c.H - 100))
  if (dH > 12 || c.C <= maxC) return hex
  return intoGamut({ ...c, C: maxC })
}

/**
 * Remap a colour's lightness into [lo, hi] (dark↔light variant derivation):
 * same hue and chroma character, new value structure.
 */
export function remapLightness(hex: string, lo: number, hi: number, t: number): string {
  const c = oklchFromHex(hex)
  return intoGamut({ ...c, L: Math.max(0, Math.min(1, lo + (hi - lo) * t)) })
}

/** Shift lightness by dL, staying in gamut (highlights, shaded feet). */
export function shiftLightness(hex: string, dL: number): string {
  const c = oklchFromHex(hex)
  return intoGamut({ ...c, L: Math.max(0, Math.min(1, c.L + dL)) })
}
