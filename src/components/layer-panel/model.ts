/**
 * layer-panel/model.ts — the slice of a Layer the panel renders, plus the block
 * ordering.
 *
 * The panel shows a row per layer: name, generator, resolved palette swatches,
 * blend, opacity and three toggles. It never reads `params`, `dist` or `mods`.
 *
 * That distinction is why this file exists. Selecting `s.project.layers`
 * re-rendered the whole panel on every slider tick, because editing one layer's
 * params replaces that layer object and therefore the array holding it — even
 * though nothing the panel draws had changed. Projecting to the displayed fields
 * and comparing shallowly keeps the derived array's identity across a param
 * edit, so the panel does not re-render at all.
 *
 * Trade-off: a summary must be kept in step with what a row displays. Adding a
 * field to a row means adding it here. `LayerRow` takes a `LayerSummary` rather
 * than a `Layer`, so TypeScript catches a row that reaches for something the
 * projection does not carry.
 */

import type { BlendMode } from '@/lib/ir'
import { layerTransformOf, type Layer, type LayerGroup, type LayerTransform } from '../../lib/schema'

export interface LayerSummary {
  id: string
  name: string
  gen: string
  visible: boolean
  solo: boolean
  locked: boolean
  blend: BlendMode
  opacity: number
  groupId: string | null
  /** resolved palette colours, for the row's swatch strip */
  swatches: string[]
  /** manual placement, so a moved layer can be marked */
  transform: LayerTransform | null
}

/**
 * Last summary per layer id.
 *
 * Deliberately module-level: it is a pure memoisation over immutable input, and
 * it has to outlive a single call. Layers are never mutated in place, so an id
 * whose displayed fields have not moved can hand back the previous object.
 *
 * That sharing is load-bearing, not an optimisation. Zustand's `shallow` compares
 * array elements with `Object.is`, so a projection that built a fresh object per
 * layer would make `useShallow` return a brand-new array on *every* call. React's
 * `useSyncExternalStore` then sees an unstable `getSnapshot` and re-renders
 * forever — "The result of getSnapshot should be cached to avoid an infinite
 * loop", followed by "Maximum update depth exceeded".
 */
const cache = new Map<string, LayerSummary>()

/** Layer ids churn as layers are added and removed, so keep the map bounded. */
const CACHE_LIMIT = 512

function sameFields(a: LayerSummary, b: LayerSummary): boolean {
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.gen !== b.gen ||
    a.visible !== b.visible ||
    a.solo !== b.solo ||
    a.locked !== b.locked ||
    a.blend !== b.blend ||
    a.opacity !== b.opacity ||
    a.groupId !== b.groupId ||
    a.transform?.x !== b.transform?.x ||
    a.transform?.y !== b.transform?.y ||
    a.transform?.scaleX !== b.transform?.scaleX ||
    a.transform?.scaleY !== b.transform?.scaleY ||
    a.transform?.rotation !== b.transform?.rotation ||
    a.swatches.length !== b.swatches.length
  ) {
    return false
  }
  // swatches is compared by value: the palette array is replaced on edit, so
  // reference equality would report every palette change as a row change even
  // when the colours are identical
  for (let i = 0; i < a.swatches.length; i++) {
    if (a.swatches[i] !== b.swatches[i]) return false
  }
  return true
}

/** Project a layer, reusing the previous object when nothing displayed moved. */
export function summarise(layer: Layer): LayerSummary {
  const next: LayerSummary = {
    id: layer.id,
    name: layer.name,
    gen: layer.gen,
    visible: layer.visible,
    solo: layer.solo,
    locked: layer.locked,
    blend: layer.blend,
    opacity: layer.opacity,
    groupId: layer.groupId ?? null,
    swatches: layer.color.palette.colors,
    transform: layerTransformOf(layer),
  }
  const prev = cache.get(next.id)
  if (prev && sameFields(prev, next)) return prev
  if (cache.size > CACHE_LIMIT) cache.clear()
  cache.set(next.id, next)
  return next
}

/** Project a layer list to summaries, preserving order. */
export function summariseAll(layers: Layer[]): LayerSummary[] {
  return layers.map(summarise)
}

/* ---- block model ---------------------------------------------------------
 * A "block" is either a single ungrouped layer or a contiguous run of layers
 * sharing a group id. Drag-and-drop reorders blocks, which guarantees group
 * members always stay contiguous — no special cases in the drop handler.
 * ------------------------------------------------------------------------ */

export interface Block {
  key: string
  groupId: string | null
  layers: LayerSummary[]
  group?: LayerGroup
}

export function toBlocks(layers: LayerSummary[], groups: LayerGroup[]): Block[] {
  const out: Block[] = []
  for (const l of layers) {
    const last = out[out.length - 1]
    if (last && last.groupId === l.groupId) {
      last.layers.push(l)
    } else {
      out.push({
        key: l.id,
        groupId: l.groupId,
        layers: [l],
        group: l.groupId ? groups.find((g) => g.id === l.groupId) : undefined,
      })
    }
  }
  return out
}