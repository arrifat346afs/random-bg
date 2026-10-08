/**
 * surface3d/params.ts — Parameter schema for the Surface 3D generator.
 *
 * Pure data: the inspector builds its UI from this array (including the
 * shared `camera` section from the scene3d core), the randomiser samples it,
 * and `build.ts` reads it. No React, no DOM.
 */

import type { ParamDef } from '../../schema'
import { CAMERA_PARAMS } from '../../scene3d/camera'

/** How the height field is drawn. */
export const STRUCTURE_OPTIONS: { value: string; label: string }[] = [
  { value: 'dots', label: 'Dotted rows' },
  { value: 'lattice', label: 'Dot lattice' },
  { value: 'tri', label: 'Triangle wireframe + nodes' },
  { value: 'quad', label: 'Quad wireframe + nodes' },
  { value: 'hex', label: 'Hex honeycomb + nodes' },
  { value: 'contours', label: 'Contour lines' },
  { value: 'grid', label: 'Perspective grid' },
]

export const SURFACE3D_PARAMS: ParamDef[] = [
  {
    key: 'structure', label: 'Structure', type: 'enum', options: STRUCTURE_OPTIONS,
    default: 'tri', section: 'shape',
  },
  {
    key: 'resolution', label: 'Resolution', type: 'int', min: 12, max: 80,
    step: 1, default: 44, section: 'shape',
    hint: 'Grid cells across the shorter edge (before distance LOD).',
    rand: { min: 28, max: 64 },
  },
  {
    key: 'lod', label: 'Distance LOD', type: 'float', min: 0, max: 2,
    step: 0.1, default: 1, section: 'shape',
    hint: 'Far rows use fewer vertices; 0 disables it.',
  },
  {
    key: 'amplitude', label: 'Amplitude', type: 'float', min: 0, max: 220,
    step: 1, default: 90, section: 'shape', unit: 'px',
    rand: { min: 40, max: 140 },
  },
  {
    key: 'wavelength', label: 'Wavelength', type: 'float', min: 80, max: 900,
    step: 5, default: 320, section: 'shape', unit: 'px',
    rand: { min: 160, max: 520 },
  },
  {
    key: 'waveDir', label: 'Wave direction', type: 'float', min: 0, max: 360,
    step: 1, default: 25, section: 'shape', unit: '°',
    rand: { min: 0, max: 360 },
  },
  {
    key: 'turbulence', label: 'Turbulence', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0.45, section: 'shape',
    hint: 'fbm noise mixed over the sine base.',
    rand: { min: 0.15, max: 0.8 },
  },
  {
    key: 'warp', label: 'Domain warp', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0.35, section: 'shape',
    hint: 'Swirls the field before sampling it.',
  },
  {
    key: 'ridge', label: 'Ridge', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0.25, section: 'shape',
    hint: 'Ridged-noise creases mixed in.',
  },
  {
    key: 'fold', label: 'Fold', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0, section: 'shape',
    hint: 'Sharp crease along the wave direction.',
  },
  {
    key: 'lineWidth', label: 'Line width', type: 'float', min: 0.4, max: 3,
    step: 0.1, default: 1.1, section: 'style', unit: 'px',
    rand: { min: 0.6, max: 1.8 },
  },
  {
    key: 'lineOpacity', label: 'Line opacity', type: 'float', min: 0.05, max: 0.8,
    step: 0.01, default: 0.4, section: 'style',
    rand: { min: 0.2, max: 0.6 },
  },
  {
    key: 'edgeGlow', label: 'Edge glow', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0.5, section: 'style',
    hint: 'Crest lines brighten toward the accent colour.',
  },
  {
    key: 'fade', label: 'Distance fade', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0.4, section: 'style',
    hint: 'Extra far-field fade on top of fog.',
  },
  {
    key: 'nodeSize', label: 'Node size', type: 'float', min: 1, max: 18,
    step: 0.5, default: 5, section: 'style', unit: 'px',
    rand: { min: 2.5, max: 9 },
  },
  {
    key: 'alpha', label: 'Node opacity', type: 'float', min: 0.1, max: 1,
    step: 0.01, default: 0.85, section: 'style',
    rand: { min: 0.5, max: 1 },
  },
  {
    key: 'accentRatio', label: 'Accent nodes', type: 'float', min: 0, max: 0.25,
    step: 0.01, default: 0.06, section: 'style',
    hint: 'Share of highest-crest nodes drawn in the accent (last palette) colour.',
    rand: { min: 0.02, max: 0.12 },
  },
  {
    key: 'chromaCap', label: 'Chroma cap', type: 'float', min: 0.05, max: 0.3,
    step: 0.01, default: 0.16, section: 'style',
    hint: 'OKLCH chroma ceiling so hues stay deep, never neon-harsh.',
    rand: { min: 0.1, max: 0.22 },
  },
  ...CAMERA_PARAMS,
  {
    key: 'focal', label: 'Focal depth', type: 'float', min: 0, max: 1,
    step: 0.01, default: 0.45, section: 'depth',
    hint: 'Normalised depth plane rendered sharp.',
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
]

/** Designed defaults; presets spread over these. */
export function surface3dDefaults(): Record<string, number | string> {
  return {
    structure: 'tri', resolution: 44, lod: 1, amplitude: 90, wavelength: 320,
    waveDir: 25, turbulence: 0.45, warp: 0.35, ridge: 0.25, fold: 0,
    lineWidth: 1.1, lineOpacity: 0.4, edgeGlow: 0.5, fade: 0.4,
    nodeSize: 5, alpha: 0.85, accentRatio: 0.06, chromaCap: 0.16,
    yaw: 0, pitch: 58, roll: 0, distance: 1.1, fov: 46, camHeight: 0,
    lookX: 0, lookY: 0.02, focal: 0.45, focalRange: 0.08, dof: 0.55,
    cocMax: 26, fog: 0.5,
  }
}
