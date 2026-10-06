/**
 * field/ramp.ts — Palette role mapping for surface generators.
 *
 * Particle generators pick discrete colours; surfaces need *roles*: a dark
 * ground, a mid body and a light rim, all drawn from the same palette so the
 * layer stays in harmony. Ranking is by HSL lightness, so role assignment
 * follows value structure rather than palette order.
 */

import { hexToHsl, rampColor } from '../palette'

/** Palette colours sorted dark → light by HSL lightness (stable). */
export function rankByLightness(colors: string[]): string[] {
  return [...colors].sort((a, b) => hexToHsl(a)[2] - hexToHsl(b)[2])
}

/** Value-structure roles a surface is built from. */
export interface ShadeRoles {
  /** darkest colour — grounds, shadow sides, base fills */
  dark: string
  /** middle colour — main body */
  mid: string
  /** lightest colour — rims, highlights, sun discs */
  light: string
}

/** Split a palette into dark / mid / light roles (falls back to white). */
export function shadeRoles(colors: string[]): ShadeRoles {
  const ranked = rankByLightness(colors.length ? colors : ['#ffffff'])
  const dark = ranked[0] ?? '#000000'
  const light = ranked[ranked.length - 1] ?? '#ffffff'
  const mid = ranked[Math.floor((ranked.length - 1) / 2)] ?? dark
  return { dark, mid, light }
}

/**
 * Sample the palette as a smooth value ramp at t∈[0,1] (0 = dark, 1 = light).
 * Unlike raw palette order, neighbouring samples always form a calm gradient,
 * which is what keeps mesh and silk fields from going confetti.
 */
export function bandColor(colors: string[], t: number): string {
  const ranked = rankByLightness(colors.length ? colors : ['#ffffff'])
  return rampColor(ranked, Math.max(0, Math.min(1, t)), 'linear')
}
