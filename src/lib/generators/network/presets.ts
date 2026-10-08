/**
 * network/presets.ts — Ten network presets on dark grounds.
 *
 * Each preset is a partial layer spec; `src/lib/presets.ts` merges it onto
 * generator defaults. Colours are explicit so presets never drift with the
 * project palette. All use normal blend: glow comes from gradient alpha,
 * so preview and the Adobe Stock export match exactly.
 */

import type { PresetLayerSpec } from '../../presets'
import type { BackgroundSpec } from '../../schema'

export interface NetworkPreset {
  id: string
  name: string
  tags: string[]
  description: string
  seed: number
  bg: BackgroundSpec
  layer: PresetLayerSpec
}

const DARK = (color: string): BackgroundSpec => ({ kind: 'solid', color })

/** Shared calm-network base: sparse lines, soft hubs, visible ground. */
const BASE = { connection: 'knn', maxDegree: 3, alpha: 0.85, blend: 'normal' as const, opacity: 1, yaw: 0, pitch: 58, distance: 1.9, fov: 46, focalRange: 0.08, cocMax: 26, fog: 0.5 }

export const NETWORK_PRESETS: NetworkPreset[] = [
  {
    id: 'deep-blue-network', name: 'Deep Blue Network',
    tags: ['network', 'plexus', 'blue', 'nodes', 'tech', 'dark'],
    description: 'Glowing blue node clusters webbed with fine lines.',
    seed: 61001, bg: DARK('#040a1c'),
    layer: { gen: 'network', params: { ...BASE, layout: 'cloud', count: 280, clusters: 5, maxEdgeLen: 0.22, lineWidth: 1.2, lineOpacity: 0.35, hubRatio: 0.07, focal: 0.45, dof: 0.55, halo: 0.5, dust: 0.25 }, palette: ['#0a1f5c', '#2a63d8', '#74b8ff', '#e9f6ff'], colorMode: 'position', blend: 'normal', opacity: 1 },
  },
  {
    id: 'cyan-data-cloud', name: 'Cyan Data Cloud',
    tags: ['network', 'cyan', 'data', 'cloud', 'tech'],
    description: 'Dense cyan clumps with bright hub halos.',
    seed: 61007, bg: DARK('#02141a'),
    layer: { gen: 'network', params: { ...BASE, layout: 'cloud', count: 420, clusters: 7, maxEdgeLen: 0.16, lineWidth: 1, lineOpacity: 0.4, hubRatio: 0.09, sizePower: 2.6, halo: 0.65, dust: 0.3 }, palette: ['#002b3d', '#00b8d4', '#7af9ff', '#e6feff'], colorMode: 'palette', blend: 'normal', opacity: 1 },
  },
  {
    id: 'gold-constellation', name: 'Gold Constellation',
    tags: ['network', 'gold', 'constellation', 'stars', 'sparse'],
    description: 'Sparse golden nodes joined by long faint lines.',
    seed: 61013, bg: DARK('#0b0704'),
    layer: { gen: 'network', params: { ...BASE, layout: 'constellation', connection: 'radius', count: 130, clusters: 4, maxDegree: 2, maxEdgeLen: 0.34, lineWidth: 1, lineOpacity: 0.3, hubRatio: 0.1, size: 8, dust: 0.4 }, palette: ['#7a4a08', '#c98a1a', '#ffd97a', '#fff6d8'], colorMode: 'random', blend: 'normal', opacity: 1 },
  },
  {
    id: 'violet-neural-mesh', name: 'Violet Neural Mesh',
    tags: ['network', 'violet', 'neural', 'mesh', 'purple'],
    description: 'Violet neural web with a strong depth-of-field falloff.',
    seed: 61019, bg: DARK('#0a0616'),
    layer: { gen: 'network', params: { ...BASE, layout: 'cloud', connection: 'gabriel', count: 320, clusters: 6, maxEdgeLen: 0.2, lineWidth: 1.1, lineOpacity: 0.38, hubRatio: 0.08, focal: 0.4, dof: 0.8, halo: 0.6, dust: 0.2 }, palette: ['#3a0ca3', '#7b2ff7', '#c77dff', '#f3e8ff'], colorMode: 'position', axis: 35, blend: 'normal', opacity: 1 },
  },
  {
    id: 'crimson-web', name: 'Crimson Web',
    tags: ['network', 'red', 'crimson', 'web', 'dark'],
    description: 'Deep red web with hot hub cores.',
    seed: 61023, bg: DARK('#120304'),
    layer: { gen: 'network', params: { ...BASE, layout: 'cloud', count: 240, clusters: 4, maxDegree: 4, maxEdgeLen: 0.24, lineWidth: 1.3, lineOpacity: 0.4, hubRatio: 0.08, halo: 0.55, dust: 0.2 }, palette: ['#4a0d00', '#b33000', '#ff6b1a', '#ffd8b0'], colorMode: 'palette', blend: 'normal', opacity: 1 },
  },
  {
    id: 'teal-molecule', name: 'Teal Molecule',
    tags: ['network', 'teal', 'molecule', 'science', 'green'],
    description: 'Teal molecular clusters on a deep green ground.',
    seed: 61031, bg: DARK('#04120e'),
    layer: { gen: 'network', params: { ...BASE, layout: 'cloud', connection: 'radius', count: 200, clusters: 8, spread: 0.11, maxDegree: 4, maxEdgeLen: 0.18, lineWidth: 1.4, lineOpacity: 0.42, hubRatio: 0.12, size: 8, halo: 0.6, dust: 0.15 }, palette: ['#04150c', '#16603a', '#3fae6a', '#d6fff0'], colorMode: 'size', blend: 'normal', opacity: 1 },
  },
  {
    id: 'ice-white-network', name: 'Ice White Network',
    tags: ['network', 'ice', 'white', 'frost', 'minimal'],
    description: 'Pale frost nodes on midnight blue, restrained and calm.',
    seed: 61037, bg: DARK('#050b16'),
    layer: { gen: 'network', params: { ...BASE, layout: 'cloud', count: 220, clusters: 5, maxEdgeLen: 0.2, lineWidth: 1, lineOpacity: 0.3, hubRatio: 0.06, alpha: 0.75, halo: 0.4, dust: 0.3, chromaCap: 0.08 }, palette: ['#274b73', '#64b5f6', '#cfe8ff', '#f2f9ff'], colorMode: 'position', axis: 120, blend: 'normal', opacity: 0.95 },
  },
  {
    id: 'wave-surface-blue', name: 'Wave Surface Blue',
    tags: ['network', 'wave', 'surface', 'blue', '3d'],
    description: 'Nodes riding an undulating 3D sheet, tilted in perspective.',
    seed: 61043, bg: DARK('#030b18'),
    layer: { gen: 'network', params: { ...BASE, layout: 'wave', count: 380, maxEdgeLen: 0.15, lineWidth: 1, lineOpacity: 0.35, hubRatio: 0.05, pitch: 32, distance: 1.6, focal: 0.5, dof: 0.7, dust: 0.1 }, palette: ['#0a1f5c', '#2a63d8', '#22e0ff', '#e9f6ff'], colorMode: 'position', axis: 90, blend: 'normal', opacity: 1 },
  },
  {
    id: 'globe-network', name: 'Globe Network',
    tags: ['network', 'globe', 'sphere', 'earth', 'tech'],
    description: 'A plexus sphere with far-side nodes softened into bokeh.',
    seed: 61049, bg: DARK('#02040a'),
    layer: { gen: 'network', params: { ...BASE, layout: 'globe', connection: 'gabriel', count: 340, maxDegree: 4, maxEdgeLen: 0.2, lineWidth: 1.1, lineOpacity: 0.4, hubRatio: 0.06, yaw: 18, pitch: 55, focal: 0.3, dof: 0.85, halo: 0.55, dust: 0.35 }, palette: ['#0a1f5c', '#2a9df4', '#7af9ff', '#e6feff'], colorMode: 'position', axis: 45, blend: 'normal', opacity: 1 },
  },
  {
    id: 'sparse-star-map', name: 'Sparse Star Map',
    tags: ['network', 'sparse', 'stars', 'map', 'minimal', 'constellation'],
    description: 'A minimal spanning tree across scattered star nodes.',
    seed: 61057, bg: DARK('#02030a'),
    layer: { gen: 'network', params: { ...BASE, layout: 'constellation', connection: 'mst', count: 110, clusters: 5, maxDegree: 3, maxEdgeLen: 0.42, lineWidth: 1, lineOpacity: 0.32, lineFalloff: 1.2, hubRatio: 0.08, size: 8, dust: 0.5 }, palette: ['#dfe6ff', '#9fd0ff', '#5aa9ff', '#f4f8ff'], colorMode: 'random', blend: 'normal', opacity: 1 },
  },
  {
    id: 'deep-blue-network-cloud', name: 'Deep Blue Network Cloud',
    tags: ['network', '3d', 'cloud', 'blue', 'volume', 'tech', 'dark'],
    description: 'A true 3D volume of clustered nodes with depth-of-field bokeh.',
    seed: 61063, bg: DARK('#030816'),
    layer: { gen: 'network', params: { ...BASE, layout: 'cloud', count: 340, clusters: 6, spread: 0.2, maxEdgeLen: 0.2, lineWidth: 1.1, lineOpacity: 0.38, hubRatio: 0.08, yaw: -14, pitch: 42, distance: 1.7, focal: 0.45, focalRange: 0.1, dof: 0.75, halo: 0.6, dust: 0.3 }, palette: ['#0a1f5c', '#2a63d8', '#74b8ff', '#e9f6ff'], colorMode: 'position', axis: 60, blend: 'normal', opacity: 1 },
  },
]
