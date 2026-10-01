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
import type { Layer, LayerGroup } from '@/lib/schema'

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
  offset: { x: number; y: number } | null
}

export function summarise(layer: Layer): LayerSummary {
  return {
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
    offset: layer.offset ?? null,
  }
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