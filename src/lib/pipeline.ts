/**
 * pipeline.ts — Turns a Layer into IR, with per-layer caching.
 *
 * `hash(params+seed+dist+mods+colour+canvas)` decides whether a layer needs
 * regeneration; unchanged layers are never recomputed, which is what keeps
 * the preview smooth while dragging other layers' controls.
 */

import { createRng, hash32 } from './rng'
import { applyModifiers } from './modifiers'
import { buildIR, type IR, type Node } from './ir'
import { getGenerator, fallbackGenerator } from './generators'
import type { GenContext, Layer, Project } from './schema'
import { effectivePalette, isPaletteLinked } from './palette'
import { getMaskSampler, identityMask } from './mask'

export const MAX_PRIMITIVES = 40000

export interface LayerResult {
  ir: IR
  /** true when the primitive cap had to bite */
  truncated: boolean
  /** cache key for this result */
  key: string
  /** milliseconds spent generating (0 when cached) */
  ms: number
}

/**
 * Cache keys are derived by JSON-stringifying four sub-objects per layer per
 * render. Layers are immutable in the store (every edit produces a new
 * object), so a WeakMap lets us stringify each layer exactly once instead of
 * on every regeneration tick.
 */
interface KeyMemo {
  sig: string
  key: string
}
const keyMemo = new WeakMap<Layer, KeyMemo>()

export function layerCacheKey(layer: Layer, project: Project, cap = MAX_PRIMITIVES): string {
  // Linked layers render from `project.palette`, so it must be part of the
  // memo signature — otherwise editing one layer would leave others cached.
  const paletteSig = isPaletteLinked(layer.color)
    ? JSON.stringify(project.palette)
    : JSON.stringify(layer.color.palette)
  const sig = `${project.seed}|${project.canvas.w}x${project.canvas.h}|${cap}|${paletteSig}`
  const hit = keyMemo.get(layer)
  if (hit && hit.sig === sig) return hit.key
  const key = hash32(
    project.seed,
    layer.seedOffset,
    layer.gen,
    JSON.stringify(layer.params),
    JSON.stringify(layer.dist),
    JSON.stringify(layer.color),
    paletteSig,
    JSON.stringify(layer.mods),
    project.canvas.w,
    project.canvas.h,
    cap,
  ).toString(36)
  keyMemo.set(layer, { sig, key })
  return key
}

/**
 * The cache holds whole IRs, so bounding it by *entry count* is meaningless —
 * a single layer can carry 40 000 nodes (~tens of MB). We bound it by total
 * node count instead, which is what actually drives memory, and keep a hard
 * entry cap as a second guard.
 *
 * Budget ≈ 200k nodes ≈ 30–40 MB worst case, and it only shrinks on its own.
 */
const MAX_CACHE_NODES = 200_000
const MAX_CACHE_ENTRIES = 40

const cache = new Map<string, LayerResult>()
let cacheNodes = 0

function remember(key: string, value: LayerResult): void {
  const prev = cache.get(key)
  if (prev) cacheNodes -= prev.ir.stats.count
  // Map.set keeps insertion order, so delete+set promotes to most-recently-used
  cache.delete(key)
  cache.set(key, value)
  cacheNodes += value.ir.stats.count
  while (cache.size > 1 && (cache.size > MAX_CACHE_ENTRIES || cacheNodes > MAX_CACHE_NODES)) {
    const oldest = cache.keys().next().value
    if (oldest === undefined || oldest === key) break
    const victim = cache.get(oldest)
    if (victim) cacheNodes -= victim.ir.stats.count
    cache.delete(oldest)
  }
}

/**
 * The cache is content-addressed (the key *is* the hash of everything that
 * affects the output), so stale entries cannot be read in the first place —
 * invalidation is just "drop everything".
 */
export function invalidateLayer(): void {
  cache.clear()
  cacheNodes = 0
}

/** Drop cached results (used when masks finish decoding). */
export function clearLayerCache(): void {
  cache.clear()
  cacheNodes = 0
}

/** Diagnostics for the status bar / dev tools. */
export function cacheStats(): { entries: number; nodes: number } {
  return { entries: cache.size, nodes: cacheNodes }
}

export interface GenerateOpts {
  /** reuse cached results (default true) */
  useCache?: boolean
  /**
   * Lower primitive budget for thumbnails/evolve gallery, so nine previews do
   * not materialise 9 × 40 000 nodes at once.
   */
  maxPrimitives?: number
}

export async function generateLayer(
  layer: Layer,
  project: Project,
  opts: GenerateOpts = {},
): Promise<LayerResult> {
  const cap = opts.maxPrimitives ?? MAX_PRIMITIVES
  const key = layerCacheKey(layer, project, cap)
  if (opts.useCache !== false) {
    const hit = cache.get(key)
    if (hit) return hit
  }
  const t0 = performance.now()
  // `salt` is the stable content identity — `id` is unique-but-random, so
  // seeding from it would make a project unreproducible from its own seed
  const salt = layer.salt ?? layer.id
  const rng = createRng(hash32(project.seed, salt, layer.seedOffset))
  const gen = getGenerator(layer.gen) ?? fallbackGenerator
  const w = project.canvas.w
  const h = project.canvas.h

  // image masks decode asynchronously; wait for one when it's in use
  let maskAt = identityMask
  if (layer.dist.type === 'imageMask' && layer.dist.mask) {
    maskAt = await getMaskSampler(layer.dist.mask)
  }

  const ctx: GenContext = {
    rng,
    w,
    h,
    minDim: Math.min(w, h),
    dist: layer.dist,
    color: { ...layer.color, palette: effectivePalette(project.palette, layer.color) },
    seed: hash32(project.seed, salt),
    maskAt,
  }

  let ir: IR
  try {
    ir = gen.generate(layer.params, ctx)
  } catch (err) {
    console.error(`[fx-forge] generator "${layer.gen}" failed:`, err)
    ir = buildIR(w, h, [])
  }

  let nodes: Node[] = ir.nodes
  if (layer.mods.length) {
    nodes = applyModifiers(nodes, layer.mods, {
      w,
      h,
      rng: rng.fork('mods'),
      seed: hash32(project.seed, salt, 'mods'),
    })
  }

  let truncated = false
  if (nodes.length > cap) {
    truncated = true
    nodes = nodes.slice(0, cap)
  }

  // apply layer-level opacity & blend (node-level blend wins when set).
  // Fast path: when the layer is fully opaque and normally blended there is
  // nothing to write, so we avoid allocating a copy of every node.
  const layerBlend = layer.blend
  if (layer.opacity !== 1 || layerBlend !== 'normal') {
    nodes = nodes.map((n) => ({
      ...n,
      op: (n.op ?? 1) * layer.opacity,
      blend: n.blend ?? (layerBlend !== 'normal' ? layerBlend : undefined),
    }))
  }

  const result: LayerResult = {
    ir: buildIR(w, h, nodes),
    truncated,
    key,
    ms: Math.round((performance.now() - t0) * 100) / 100,
  }
  remember(key, result)
  return result
}

/** Which layers actually render (solo beats visibility). */
export function activeLayers(project: Project): Layer[] {
  const soloed = project.layers.filter((l) => l.solo && l.visible && !l.locked)
  const set = soloed.length ? soloed : project.layers
  return set.filter((l) => l.visible)
}

export interface ProjectProgress {
  done: number
  total: number
  label: string
}

/** Generate every active layer (sequentially — callers debounce). */
export async function generateProject(
  project: Project,
  opts: GenerateOpts & { onProgress?: (p: ProjectProgress) => void } = {},
): Promise<LayerResult[]> {
  const layers = activeLayers(project)
  const out: LayerResult[] = []
  let done = 0
  for (const layer of layers) {
    opts.onProgress?.({
      done,
      total: layers.length,
      label: layer.name,
    })
    out.push(await generateLayer(layer, project, opts))
    done++
  }
  opts.onProgress?.({ done, total: layers.length, label: 'done' })
  return out
}

/** Quick stats for the status bar. */
export function totalPrimitives(results: LayerResult[]): number {
  return results.reduce((s, r) => s + r.ir.stats.count, 0)
}
