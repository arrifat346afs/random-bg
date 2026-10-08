/**
 * surface3d/field.ts — Height-field synthesis for the Surface 3D generator.
 *
 * z = f(x, y) from a directional sine base + domain-warped fbm turbulence +
 * ridged creases + an optional sharp fold along the wave direction. All
 * coords in world px relative to canvas centre. Normals via central
 * differences. Deterministic: field only reads `createNoise(ctx.seed)`.
 */

import { createNoise, type Noise2D } from '../../noise'
import { clamp01 } from '../../scene3d/math'

export interface FieldOpts {
  amplitude: number
  wavelength: number
  waveDir: number
  turbulence: number
  warp: number
  ridge: number
  fold: number
  seed: number
}

export interface Field {
  h(x: number, y: number): number
  /** unit normal + relative crest height 0..1 */
  sample(x: number, y: number): { z: number; nx: number; ny: number; nz: number; h01: number }
}

export function makeField(o: FieldOpts): Field {
  const noise: Noise2D = createNoise(o.seed)
  const wl = Math.max(40, o.wavelength)
  const ang = (o.waveDir * Math.PI) / 180
  const dx = Math.cos(ang)
  const dy = Math.sin(ang)
  const turb = clamp01(o.turbulence)
  const warp = clamp01(o.warp)
  const ridge = clamp01(o.ridge)
  const fold = clamp01(o.fold)

  const raw = (x: number, y: number): number => {
    // domain warp first so creases swirl instead of marching straight
    const wx = x + warp * 160 * noise.fbm(x / 420 + 7.3, y / 420 + 2.1, 3)
    const wy = y + warp * 160 * noise.fbm(x / 420 + 1.7, y / 420 + 9.2, 3)
    const s = Math.sin(((wx * dx + wy * dy) / wl) * Math.PI * 2)
    // fold: sharp crease along the wave direction
    const f = 1 - Math.abs((((wx * dx + wy * dy) / wl) % 1 + 1) % 1 - 0.5) * 2
    const n = noise.fbm(wx / (wl * 0.9) + 3.1, wy / (wl * 0.9) + 8.7, 4) * 0.5 + 0.5
    const r = 1 - Math.abs(noise.fbm(wx / (wl * 0.55) + 5.9, wy / (wl * 0.55) + 4.3, 3))
    return s * (1 - turb * 0.55) + (n * 2 - 1) * turb + (r * 2 - 1) * ridge * 0.8 + f * fold * 0.9
  };

  // normalise the mix so amplitude means the same across param combos
  const norm = 1 / (1 + turb * 0.45 + ridge * 0.4 + fold * 0.45 + 1e-6)

  const h = (x: number, y: number): number => raw(x, y) * norm * o.amplitude

  const sample = (x: number, y: number): { z: number; nx: number; ny: number; nz: number; h01: number } => {
    const e = Math.max(2, wl * 0.02)
    const z = h(x, y)
    const zx = (h(x + e, y) - h(x - e, y)) / (2 * e)
    const zy = (h(x, y + e) - h(x, y - e)) / (2 * e)
    const inv = 1 / Math.hypot(zx, zy, 1)
    return { z, nx: -zx * inv, ny: -zy * inv, nz: inv, h01: clamp01((z / Math.max(1, o.amplitude)) * 0.5 + 0.5) }
  };

  return { h, sample }
}
