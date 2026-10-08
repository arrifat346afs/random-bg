/**
 * network/params.ts — Typed parameter schema for the network generator.
 *
 * Pure data: the inspector builds its UI from this array, the randomiser
 * samples it, and `render.ts` reads it. No React, no DOM.
 */

import type { ParamDef } from '../../schema'
import { CAMERA_PARAMS } from '../../scene3d/camera'

/** Node placement in 3D, projected with a gentle perspective. */
export const LAYOUT_OPTIONS: { value: string; label: string }[] = [
  { value: 'cloud', label: 'Cloud (organic clumps)' },
  { value: 'wave', label: 'Wave surface' },
  { value: 'globe', label: 'Globe' },
  { value: 'ribbon', label: 'Ribbon (along a curve)' },
  { value: 'grid', label: 'Jittered grid' },
  { value: 'constellation', label: 'Constellation (sparse)' },
]

/** How nodes are linked. Gabriel ≈ Delaunay minus long hops; MST + extras. */
export const CONNECTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'knn', label: 'K-nearest' },
  { value: 'radius', label: 'Radius' },
  { value: 'gabriel', label: 'Gabriel graph' },
  { value: 'mst', label: 'Spanning tree + extras' },
]

export const EDGE_BUCKETS = 7
export const MAX_NODES = 2200
export const MAX_EDGES = 3500

export const NETWORK_PARAMS: ParamDef[] = [
  {
    key: 'count', label: 'Nodes', type: 'int', min: 16, max: MAX_NODES,
    step: 1, default: 260, section: 'shape',
    hint: 'How many nodes to emit (before hubs, dust and edge buckets).',
    rand: { min: 120, max: 700 },
  },
  {
    key: 'layout', label: 'Layout', type: 'enum', options: LAYOUT_OPTIONS,
    default: 'cloud', section: 'shape',
  },
  {
    key: 'connection', label: 'Connection', type: 'enum', options: CONNECTION_OPTIONS,
    default: 'knn', section: 'shape',
    hint: 'Gabriel is airy, MST is minimal, radius is web-like.',
  },
  {
    key: 'clusters', label: 'Clusters', type: 'int', min: 1, max: 12,
    step: 1, default: 5, section: 'shape',
    hint: 'Clump count for cloud / constellation layouts.',
    rand: { min: 2, max: 8 },
  },
  {
    key: 'spread', label: 'Cluster spread', type: 'float', min: 0.05, max: 0.45,
    step: 0.01, default: 0.16, section: 'shape', unit: '×',
    hint: 'Clump radius as a fraction of the canvas size.',
    rand: { min: 0.08, max: 0.28 },
  },
  {
    key: 'size', label: 'Node size', type: 'float', min: 1, max: 26,
    step: 0.5, default: 7, section: 'shape', unit: 'px',
    rand: { min: 3, max: 12 },
  },
  {
    key: 'sizePower', label: 'Size curve', type: 'float', min: 0.5, max: 4,
    step: 0.1, default: 2.2, section: 'shape',
    hint: 'Power curve: high values make most nodes tiny with a few large.',
    rand: { min: 1, max: 3.2 },
  },
  {
    key: 'hubRatio', label: 'Hub ratio', type: 'float', min: 0, max: 0.3,
    step: 0.01, default: 0.07, section: 'shape',
    hint: 'Share of best-connected nodes rendered as bright hubs with halos.',
    rand: { min: 0.03, max: 0.14 },
  },
  {
    key: 'maxDegree', label: 'Max degree', type: 'int', min: 1, max: 8,
    step: 1, default: 3, section: 'shape',
    hint: 'Most connections any one node may carry.',
    rand: { min: 2, max: 5 },
  },
  {
    key: 'maxEdgeLen', label: 'Max edge length', type: 'float', min: 0.05, max: 0.6,
    step: 0.01, default: 0.22, section: 'shape', unit: '×',
    hint: 'Longest link as a fraction of the canvas size.',
    rand: { min: 0.12, max: 0.35 },
  },
  {
    key: 'lineWidth', label: 'Line width', type: 'float', min: 0.5, max: 4,
    step: 0.1, default: 1.2, section: 'style', unit: 'px',
    rand: { min: 0.6, max: 2 },
  },
  {
    key: 'lineOpacity', label: 'Line opacity', type: 'float', min: 0.05, max: 0.8,
    step: 0.01, default: 0.35, section: 'style',
    rand: { min: 0.15, max: 0.55 },
  },
  {
    key: 'lineFalloff', label: 'Line falloff', type: 'float', min: 0.5, max: 3,
    step: 0.1, default: 1.6, section: 'style',
    hint: 'How fast edge opacity falls with edge length.',
  },
  {
    key: 'alpha', label: 'Node opacity', type: 'float', min: 0.1, max: 1,
    step: 0.01, default: 0.85, section: 'style',
    rand: { min: 0.5, max: 1 },
  },
  {
    key: 'focal', label: 'Focal depth', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0.45, section: 'depth',
    hint: 'Depth plane rendered sharp, relative to the scene (0 near, 1 far).',
  },
  {
    key: 'focalRange', label: 'Focal range', type: 'float', min: 0, max: 0.4,
    step: 0.01, default: 0.08, section: 'depth',
    hint: 'Sharp band around the focal plane.',
  },
  {
    key: 'dof', label: 'Depth of field', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0.55, section: 'depth',
    rand: { min: 0.2, max: 0.9 },
  },
  {
    key: 'cocMax', label: 'Bokeh size', type: 'float', min: 4, max: 60,
    step: 1, default: 26, section: 'depth', unit: 'px',
    hint: 'Max circle-of-confusion radius for fully defocused points.',
  },
  {
    key: 'fog', label: 'Fog density', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0.5, section: 'depth',
    hint: 'Atmospheric fade with depth.',
    rand: { min: 0.2, max: 0.8 },
  },
  {
    key: 'glowRadius', label: 'Glow radius', type: 'float', min: 2, max: 30,
    step: 0.5, default: 10, section: 'style', unit: 'px',
    rand: { min: 4, max: 18 },
  },
  {
    key: 'halo', label: 'Halo strength', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0.5, section: 'style',
    hint: 'Soft-clipped hub halo; never clips to white.',
    rand: { min: 0.2, max: 0.8 },
  },
  {
    key: 'dust', label: 'Dust', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0.25, section: 'style',
    hint: 'Sparse layer of tiny faint specks.',
    rand: { min: 0, max: 0.5 },
  },
  ...CAMERA_PARAMS,
  {
    key: 'chromaCap', label: 'Chroma cap', type: 'float', min: 0.05, max: 0.3,
    step: 0.01, default: 0.16, section: 'style',
    hint: 'OKLCH chroma ceiling so hues stay deep, never neon-harsh.',
    rand: { min: 0.1, max: 0.22 },
  },
]

/** Designed defaults; presets spread over these. */
export function networkDefaults(): Record<string, number | string> {
  return {
    count: 260, layout: 'cloud', connection: 'knn', clusters: 5,
    spread: 0.16, size: 7, sizePower: 2.2, hubRatio: 0.07,
    maxDegree: 3, maxEdgeLen: 0.22, lineWidth: 1.2, lineOpacity: 0.35,
    lineFalloff: 1.6, alpha: 0.85, focal: 0.45, focalRange: 0.08, dof: 0.55,
    cocMax: 26, fog: 0.5, glowRadius: 10, halo: 0.5, dust: 0.25,
    yaw: 0, pitch: 58, roll: 0, distance: 1.5, fov: 46, camHeight: 0,
    lookX: 0, lookY: 0.02, chromaCap: 0.16,
  }
}
