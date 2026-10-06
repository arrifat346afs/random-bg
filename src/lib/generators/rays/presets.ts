/**
 * rays/presets.ts — Six soft volumetric ray presets.
 *
 * Partial layer specs merged onto generator defaults by `src/lib/presets.ts`.
 * All use `style: 'soft'`; colours are explicit so presets never drift with
 * the project palette. Each must read as real light, not polygons.
 */

import type { PresetLayerSpec } from '../../presets'
import type { BackgroundSpec } from '../../schema'

export interface RayPreset {
  id: string
  name: string
  tags: string[]
  description: string
  seed: number
  bg: BackgroundSpec
  layers: PresetLayerSpec[]
}

const SOFT = {
  style: 'soft',
  alpha: 0.7,
  intensity: 0.65,
  dust: 0.4,
} as const

export const RAY_PRESETS: RayPreset[] = [
  {
    id: 'cathedral-rays',
    name: 'Cathedral Rays',
    tags: ['rays', 'god rays', 'cathedral', 'volumetric', 'light'],
    description: 'Soft god-ray fan falling from the top-left over deep teal.',
    seed: 55001,
    bg: { kind: 'solid', color: '#04141f' },
    layers: [
      {
        gen: 'mesh',
        params: { cols: 2, rows: 2, jitter: 0.3, warp: 0.2, warpScale: 1.2, mapping: 'ramp', softness: 1, alpha: 1 },
        palette: ['#04141f', '#032b3a', '#0a2a3a', '#12444f'],
        blend: 'normal',
        opacity: 1,
      },
      {
        gen: 'rays',
        params: { ...SOFT, mode: 'godRays', count: 22, origin: 'corner', angle: 38, spread: 42, length: 1.1, width: 26, taper: 0.6, coreSize: 0.35, jitter: 0.4 },
        palette: ['#e9fff9', '#7cf5c4', '#00c2a8', '#032b3a'],
        blend: 'screen',
        opacity: 0.65,
      },
    ],
  },
  {
    id: 'sunrise-burst',
    name: 'Sunrise Burst',
    tags: ['rays', 'sunrise', 'burst', 'warm', 'light'],
    description: 'Warm starburst low over a gradient dawn sky.',
    seed: 55007,
    bg: { kind: 'gradient', from: '#2d0a3e', to: '#ff8b1f', angle: 90 },
    layers: [
      {
        gen: 'rays',
        params: { ...SOFT, mode: 'starburst', count: 18, origin: 'center', length: 0.9, width: 20, taper: 0.7, coreSize: 0.5, jitter: 0.45, dust: 0.25 },
        palette: ['#ffe082', '#ff8b1f', '#c2185b', '#2d0a3e'],
        blend: 'screen',
        opacity: 0.6,
      },
    ],
  },
  {
    id: 'caustic-shafts',
    name: 'Caustic Shafts',
    tags: ['rays', 'underwater', 'caustic', 'shafts', 'cool'],
    description: 'Cool slanted shafts over deep water blue.',
    seed: 55013,
    bg: { kind: 'solid', color: '#071a2e' },
    layers: [
      {
        gen: 'rays',
        params: { ...SOFT, mode: 'godRays', count: 26, origin: 'corner', angle: 62, spread: 26, length: 1.2, width: 18, taper: 0.5, coreSize: 0.25, jitter: 0.5, dust: 0.55 },
        palette: ['#e3f2fd', '#64b5f6', '#1565c0', '#071a2e'],
        blend: 'screen',
        opacity: 0.55,
      },
    ],
  },
  {
    id: 'neon-fan',
    name: 'Neon Fan',
    tags: ['rays', 'neon', 'fan', 'magenta', 'corner'],
    description: 'Magenta volumetric fan from a corner over near-black violet.',
    seed: 55019,
    bg: { kind: 'solid', color: '#0d0518' },
    layers: [
      {
        gen: 'rays',
        params: { ...SOFT, mode: 'godRays', count: 16, origin: 'corner', angle: 24, spread: 55, length: 1.3, width: 30, taper: 0.65, coreSize: 0.4, jitter: 0.35 },
        palette: ['#ffb3f0', '#c77dff', '#7b2ff7', '#0d0518'],
        blend: 'plus-lighter',
        opacity: 0.6,
      },
    ],
  },
  {
    id: 'spotlight-cone',
    name: 'Spotlight Cone',
    tags: ['rays', 'spotlight', 'cone', 'stage', 'light'],
    description: 'Single warm spotlight cone on a dark stage.',
    seed: 55025,
    bg: { kind: 'solid', color: '#08080c' },
    layers: [
      {
        gen: 'rays',
        params: { ...SOFT, mode: 'godRays', count: 7, origin: 'center', angle: 90, spread: 16, length: 0.85, width: 44, taper: 0.45, coreSize: 0.55, jitter: 0.2, dust: 0.5 },
        palette: ['#fff6d8', '#ffd97a', '#c98a1a', '#08080c'],
        blend: 'screen',
        opacity: 0.7,
      },
    ],
  },
  {
    id: 'anamorphic-horizon',
    name: 'Anamorphic Horizon',
    tags: ['rays', 'anamorphic', 'flare', 'horizontal', 'cinematic'],
    description: 'Cool horizontal anamorphic glow over a night gradient.',
    seed: 55031,
    bg: { kind: 'gradient', from: '#05050a', to: '#161227', angle: 90 },
    layers: [
      {
        gen: 'rays',
        params: { ...SOFT, mode: 'anamorphic', count: 12, origin: 'center', width: 22, coreSize: 0.4, alpha: 0.6, intensity: 0.55, dust: 0.2 },
        palette: ['#e6feff', '#7af9ff', '#00e5ff', '#05050a'],
        blend: 'screen',
        opacity: 0.55,
      },
    ],
  },
]
