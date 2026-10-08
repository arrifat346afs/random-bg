/**
 * surface3d/presets.ts — Nine Surface 3D presets on dark grounds.
 *
 * Each preset is a partial layer spec; `src/lib/presets.ts` merges it onto
 * generator defaults. Colours are explicit so presets never drift with the
 * project palette. All use normal blend: glow comes from gradient alpha,
 * so preview and the Adobe Stock export match exactly. (The tenth 3D-tech
 * preset, Deep Blue Network Cloud, lives with the rebuilt network gen.)
 */

import type { PresetLayerSpec } from '../../presets'
import type { BackgroundSpec } from '../../schema'

export interface Surface3DPreset {
  id: string
  name: string
  tags: string[]
  description: string
  seed: number
  bg: BackgroundSpec
  layer: PresetLayerSpec
}

const DARK = (color: string): BackgroundSpec => ({ kind: 'solid', color })

/** Shared base: real perspective, mid focal plane, calm fog. */
const BASE = {
  yaw: 0, pitch: 52, distance: 1.9, fov: 46, focal: 0.45, focalRange: 0.1,
  dof: 0.6, cocMax: 26, fog: 0.5, blend: 'normal' as const, opacity: 1,
}

export const SURFACE3D_PRESETS: Surface3DPreset[] = [
  {
    id: 'green-dot-wave', name: 'Green Dot Wave',
    tags: ['3d', 'wave', 'dots', 'green', 'surface', 'tech'],
    description: 'Dotted rows riding a green undulating wave field.',
    seed: 62001, bg: DARK('#03120b'),
    layer: { gen: 'surface3d', params: { ...BASE, structure: 'dots', resolution: 52, amplitude: 100, wavelength: 300, waveDir: 20, turbulence: 0.5, nodeSize: 5, accentRatio: 0.07, pitch: 48, distance: 1.0 }, palette: ['#04150c', '#16603a', '#3fae6a', '#d6fff0'], colorMode: 'position', axis: 90, blend: 'normal', opacity: 1 },
  },
  {
    id: 'blue-wire-wave', name: 'Blue Wire Wave',
    tags: ['3d', 'wave', 'wireframe', 'blue', 'yellow', 'nodes'],
    description: 'Blue triangle wireframe with a few yellow crest nodes.',
    seed: 62007, bg: DARK('#040a1c'),
    layer: { gen: 'surface3d', params: { ...BASE, structure: 'tri', resolution: 40, amplitude: 110, wavelength: 340, turbulence: 0.4, lineWidth: 1.1, lineOpacity: 0.42, nodeSize: 6, accentRatio: 0.05, edgeGlow: 0.6, pitch: 50, distance: 1.0 }, palette: ['#0a1f5c', '#2a63d8', '#74b8ff', '#ffd94d'], colorMode: 'position', axis: 35, blend: 'normal', opacity: 1 },
  },
  {
    id: 'cyan-honeycomb-wave', name: 'Cyan Honeycomb Wave',
    tags: ['3d', 'hex', 'honeycomb', 'cyan', 'wave', 'tech'],
    description: 'Hexagonal honeycomb tiled over a cyan wave surface.',
    seed: 62013, bg: DARK('#02141a'),
    layer: { gen: 'surface3d', params: { ...BASE, structure: 'hex', resolution: 40, amplitude: 95, wavelength: 300, waveDir: 40, turbulence: 0.45, warp: 0.4, lineWidth: 1, lineOpacity: 0.4, nodeSize: 4.5, accentRatio: 0.06, pitch: 55, distance: 1.0 }, palette: ['#002b3d', '#00b8d4', '#7af9ff', '#e6feff'], colorMode: 'palette', blend: 'normal', opacity: 1 },
  },
  {
    id: 'teal-triangle-mesh', name: 'Teal Triangle Mesh',
    tags: ['3d', 'mesh', 'triangle', 'teal', 'wireframe'],
    description: 'Teal triangle mesh with soft far-field bokeh.',
    seed: 62019, bg: DARK('#031512'),
    layer: { gen: 'surface3d', params: { ...BASE, structure: 'tri', resolution: 48, amplitude: 80, wavelength: 260, turbulence: 0.55, ridge: 0.35, lineWidth: 1, lineOpacity: 0.38, nodeSize: 4, accentRatio: 0.05, dof: 0.75, pitch: 60, distance: 1.05 }, palette: ['#032b3a', '#00c2a8', '#7cf5c4', '#e9fff9'], colorMode: 'position', axis: 120, blend: 'normal', opacity: 1 },
  },
  {
    id: 'violet-neural-cloud', name: 'Violet Neural Cloud',
    tags: ['3d', 'neural', 'violet', 'cloud', 'lattice', 'purple'],
    description: 'A violet dot lattice floating like a neural cloud.',
    seed: 62023, bg: DARK('#0a0616'),
    layer: { gen: 'surface3d', params: { ...BASE, structure: 'lattice', resolution: 46, amplitude: 120, wavelength: 280, turbulence: 0.65, warp: 0.5, nodeSize: 5.5, accentRatio: 0.08, focal: 0.4, dof: 0.8, pitch: 45, distance: 1.1 }, palette: ['#3a0ca3', '#7b2ff7', '#c77dff', '#f3e8ff'], colorMode: 'palette', blend: 'normal', opacity: 1 },
  },
  {
    id: 'gold-constellation-wave', name: 'Gold Constellation Wave',
    tags: ['3d', 'gold', 'wave', 'dots', 'constellation', 'warm'],
    description: 'Golden dotted wave with bright crest accents.',
    seed: 62031, bg: DARK('#0b0704'),
    layer: { gen: 'surface3d', params: { ...BASE, structure: 'dots', resolution: 56, amplitude: 105, wavelength: 320, waveDir: 65, turbulence: 0.4, nodeSize: 5, accentRatio: 0.09, pitch: 44, distance: 1.05 }, palette: ['#7a4a08', '#c98a1a', '#ffd97a', '#fff6d8'], colorMode: 'random', blend: 'normal', opacity: 1 },
  },
  {
    id: 'ice-white-mesh', name: 'Ice White Mesh',
    tags: ['3d', 'mesh', 'ice', 'white', 'frost', 'minimal'],
    description: 'Restrained frost quad mesh on midnight blue.',
    seed: 62037, bg: DARK('#050b16'),
    layer: { gen: 'surface3d', params: { ...BASE, structure: 'quad', resolution: 42, amplitude: 70, wavelength: 300, turbulence: 0.35, lineWidth: 1, lineOpacity: 0.32, nodeSize: 4, accentRatio: 0.04, chromaCap: 0.08, pitch: 58, distance: 1.05 }, palette: ['#274b73', '#64b5f6', '#cfe8ff', '#f2f9ff'], colorMode: 'position', axis: 120, blend: 'normal', opacity: 0.95 },
  },
  {
    id: 'crimson-grid-wave', name: 'Crimson Grid Wave',
    tags: ['3d', 'grid', 'crimson', 'red', 'wave', 'perspective'],
    description: 'Low crimson perspective grid rolling over a dark wave.',
    seed: 62043, bg: DARK('#120304'),
    layer: { gen: 'surface3d', params: { ...BASE, structure: 'grid', resolution: 56, amplitude: 120, wavelength: 380, waveDir: 10, turbulence: 0.5, lineWidth: 1.3, lineOpacity: 0.45, pitch: 22, distance: 1.1, dof: 0.7 }, palette: ['#4a0d00', '#b33000', '#ff6b1a', '#ffd8b0'], colorMode: 'position', axis: 80, blend: 'normal', opacity: 1 },
  },
  {
    id: 'low-angle-horizon-wave', name: 'Low Angle Horizon Wave',
    tags: ['3d', 'horizon', 'low-angle', 'wave', 'teal', 'depth'],
    description: 'Grazing low camera over teal waves dissolving into fog.',
    seed: 62049, bg: DARK('#02141a'),
    layer: { gen: 'surface3d', params: { ...BASE, structure: 'tri', resolution: 48, amplitude: 110, wavelength: 420, waveDir: 0, turbulence: 0.45, lineWidth: 1.2, lineOpacity: 0.42, nodeSize: 5, accentRatio: 0.06, edgeGlow: 0.6, pitch: 12, distance: 0.85, fov: 55, focal: 0.35, focalRange: 0.12, dof: 0.8, fog: 0.7 }, palette: ['#002b3d', '#00b8d4', '#7af9ff', '#e6feff'], colorMode: 'position', axis: 90, blend: 'normal', opacity: 1 },
  },
]
