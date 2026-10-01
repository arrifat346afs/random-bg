/**
 * project.ts — Factories and helpers for projects, layers and groups.
 */

import { createRng, hash32, randomSeedString, parseSeed } from './rng'
import {
  generatePalette,
  PRESET_PALETTES,
  isPaletteLinked,
  palettesEqual,
  type Palette,
} from './palette'
import type { Color } from './ir'
import { getGenerator } from './generators'
import {
  defaultDist,
  defaultMotion,
  type BackgroundSpec,
  type Layer,
  type LayerGroup,
  type ModifierSpec,
  type Params,
  type Project,
} from './schema'
import { defaultModifier } from './modifiers'

let idCounter = 0
export function newId(prefix = 'l'): string {
  idCounter++
  const rand = Math.floor(Math.random() * 0xffffff).toString(36)
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}${rand}`
}

export function defaultBackground(): BackgroundSpec {
  return { kind: 'transparent' }
}

export function createLayer(genId: string, seed: number, overrides: Partial<Layer> = {}): Layer {
  const gen = getGenerator(genId)
  const params: Params = { ...(gen ? (gen.defaults() as Params) : {}) }
  // Deterministic: the layer's seed offset must be a pure function of
  // (seed, genId) or reloading a preset — or re-creating a project from its
  // saved seed — silently produces different artwork.
  const rng = createRng(hash32(seed, genId))
  // stable content identity for this layer — see Layer.salt
  const salt = hash32(seed, genId)
  const palette: Palette = {
    name: 'gold',
    colors: PRESET_PALETTES.gold,
  }
  const clean = Object.fromEntries(
    Object.entries(overrides).filter(([, v]) => v !== undefined),
  ) as Partial<Layer>
  return {
    id: newId(),
    name: gen ? gen.name : 'Layer',
    gen: genId,
    params,
    dist: defaultDist(),
    mods: [],
    color: {
      mode: 'palette',
      palette,
      ramp: 'linear',
      axis: 45,
      invert: false,
      linked: true,
    },
    blend: 'normal',
    opacity: 1,
    visible: true,
    solo: false,
    locked: false,
    seedOffset: Math.floor(rng.range(-5000, 5000)),
    salt,
    locks: {},
    groupId: null,
    // undefined-valued overrides are dropped above so they don't wipe defaults
    ...clean,
  }
}

export interface CreateProjectOpts {
  seed?: number | string
  canvas?: { w: number; h: number; bg?: BackgroundSpec }
  name?: string
  /** initial generator ids (empty = empty project) */
  layers?: string[]
  palette?: Palette
}

export function createProject(opts: CreateProjectOpts = {}): Project {
  const seed =
    typeof opts.seed === 'string' ? parseSeed(opts.seed) : (opts.seed ?? parseSeed(randomSeedString()))
  const palette = opts.palette ?? generatePalette(createRng(hash32(seed, 'pal')), 'gold')
  const layers = (opts.layers ?? ['bokeh', 'particles']).map((g, i) =>
    createLayer(g, seed + i * 977, { color: layerColor(palette, i) }),
  )
  return {
    v: 1,
    name: opts.name ?? 'Untitled effect',
    canvas: {
      w: opts.canvas?.w ?? 1080,
      h: opts.canvas?.h ?? 1080,
      bg: opts.canvas?.bg ?? defaultBackground(),
    },
    seed,
    palette,
    layers,
    groups: [],
    motion: defaultMotion(),
  }
}

function layerColor(palette: Palette, i: number): Layer['color'] {
  // Unified: every new layer shares the exact project palette so editing one
  // layer adapts all others. Per-layer variety comes from mode/axis, not hue.
  return {
    mode: i % 3 === 2 ? 'position' : 'palette',
    palette: { name: palette.name, colors: palette.colors.slice() },
    ramp: 'linear',
    axis: 30 + i * 40,
    invert: false,
    linked: true,
  }
}

/* ---- Unified palette helpers -------------------------------------------- */

/**
 * Infer `linked` for projects saved before linking existed (or hand-built
 * presets): matching palettes become linked, divergent ones stay custom so
 * intentional multi-palette artwork is preserved.
 */
export function ensurePaletteLinks(p: Project): Project {
  let changed = false
  for (const l of p.layers) {
    if (l.color.linked !== undefined) continue
    const linked = palettesEqual(l.color.palette, p.palette)
    l.color.linked = linked
    // linked layers render from project.palette; sync the stale copy so old
    // cache keys / thumbnails converge immediately.
    if (linked) l.color.palette = { name: p.palette.name, colors: p.palette.colors.slice() }
    changed = true
  }
  return changed ? p : p
}

/** Set the project palette and sync every linked layer in one commit. */
export function withProjectPalette(p: Project, colors: Color[], name?: string): Project {
  const nextName = name ?? p.palette.name
  const next: Project = {
    ...p,
    palette: { name: nextName, colors: colors.slice() },
    layers: p.layers.map((l) =>
      isPaletteLinked(l.color)
        ? { ...l, color: { ...l.color, palette: { name: nextName, colors: colors.slice() } } }
        : l,
    ),
  }
  return next
}

/** Push one layer's effective palette to the project + all linked layers. */
export function pushPaletteToAll(p: Project, fromLayerId: string): Project {
  const from = p.layers.find((l) => l.id === fromLayerId)
  if (!from) return p
  const colors = isPaletteLinked(from.color)
    ? p.palette.colors.slice()
    : from.color.palette.colors.slice()
  const name = isPaletteLinked(from.color)
    ? p.palette.name
    : (from.color.palette.name ?? p.palette.name)
  const next: Project = {
    ...p,
    palette: { name, colors: colors.slice() },
    layers: p.layers.map((l) => ({
      ...l,
      color: {
        ...l.color,
        linked: true,
        palette: { name, colors: colors.slice() },
      },
    })),
  }
  return next
}

/* ---- Structural edits (pure — return new objects) ----------------------- */

export function duplicateLayer(layer: Layer, nameSuffix = ' copy'): Layer {
  return {
    ...structuredClone(layer),
    id: newId(),
    name: `${layer.name}${nameSuffix}`,
    seedOffset: layer.seedOffset + 1013,
    locks: { ...layer.locks },
    groupId: layer.groupId ?? null,
  }
}

export function moveLayer(layers: Layer[], from: number, to: number): Layer[] {
  const next = layers.slice()
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item)
  return next
}

export function cloneProject(p: Project): Project {
  return structuredClone(p)
}

export function createGroup(name = 'Group'): LayerGroup {
  return { id: newId('g'), name, collapsed: false }
}

/** Add a modifier of `type` to a layer (once). */
export function addModifier(layer: Layer, type: ModifierSpec['type']): Layer {
  if (layer.mods.some((m) => m.type === type)) return layer
  return { ...layer, mods: [...layer.mods, defaultModifier(type)] }
}

/* ---- Preset-ish helpers ------------------------------------------------- */

export const CANVAS_PRESETS: { label: string; w: number; h: number }[] = [
  { label: 'Square 1080', w: 1080, h: 1080 },
  { label: 'HD 1920×1080', w: 1920, h: 1080 },
  { label: 'Portrait 1080×1350', w: 1080, h: 1350 },
  { label: 'Story 1080×1920', w: 1080, h: 1920 },
  { label: 'Wide 2560×1080', w: 2560, h: 1080 },
  { label: '4K 3840×2160', w: 3840, h: 2160 },
  { label: 'Banner 1500×500', w: 1500, h: 500 },
  { label: 'Icon 512', w: 512, h: 512 },
  { label: 'Small 640×360', w: 640, h: 360 },
]
