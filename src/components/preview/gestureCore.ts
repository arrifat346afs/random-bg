/**
 * preview/gestureCore.ts — gesture state and per-frame transform resolution.
 *
 * Shared by `useStageDrag` (and nothing else, for now). The hook owns the
 * pointer wiring and the rAF scheduling; everything here is either the gesture
 * record itself or a pure-ish step the frame callback runs:
 *
 *   beginLayerGesture  measure the box once at pointer-down, arm the drag
 *   computeNext        turn the newest sample into a placement (move / scale /
 *                      rotate — the maths lives in `scaling.ts`)
 *   snapPlacement      optionally pull the box onto canvas rules, with guides
 *   endLayerGesture    one coalesced commit on release, or nothing on cancel
 *
 * Keeping the record and its transitions in one place means a second caller
 * (touch gestures, a future keyboard-transform mode) cannot invent its own
 * bookkeeping and drift.
 */

import { layerTransformOf, type LayerTransform } from '@/lib/schema'
import type { Rect } from '@/lib/render/bounds'
import { pivotOf, quadBounds, transformMatrix, transformQuad, type Pivot } from '@/lib/transform'
import { rotateTransform, scaleTransform } from '@/lib/scaling'
import { canvasRules, snapBox } from '@/lib/snap'
import { isEdgeHandle, type HandleId } from '@/lib/handles'
import type { SnapGuide } from '@/store/uiStore'
import { layerLocalBounds } from '@/lib/select'
import { useProjectStore } from '@/store/projectStore'
import { useRenderStore } from '@/store/renderStore'
import { useUiStore } from '@/store/uiStore'

/** What a gesture is doing to the selected layer. */
export type GestureMode = 'move' | 'scale' | 'rotate'

/**
 * Everything a gesture needs, captured once at pointer-down.
 *
 * The box's local rect and pivot are measured **here**, from the cached IR, so no
 * frame of the gesture re-measures geometry — and a scale or rotate has a stable
 * reference even if the pointer wanders outside the box.
 */
export interface Gesture {
  layerId: string
  mode: GestureMode
  handle: HandleId | null
  start: LayerTransform
  /** the layer's geometry bounds, in its own space */
  local: Rect
  pivot: Pivot
  pointerId: number
  startX: number
  startY: number
  moved: boolean
}

/** Pointer travel, in CSS px, before a press counts as a drag. */
export const MIN_TRAVEL_PX = 1.5

/**
 * Arm a gesture on a layer: measure the box once and record the drag.
 * Returns false when there is nothing to drag (locked, hidden, no geometry).
 */
export function beginLayerGesture(
  e: React.PointerEvent,
  layerId: string,
  mode: GestureMode,
  handle: HandleId | null,
): Gesture | null {
  const ui = useUiStore.getState()
  const project = useProjectStore.getState().project
  const layer = project.layers.find((l) => l.id === layerId)
  const results = useRenderStore.getState().results
  if (!layer || !results || layer.locked || !layer.visible) return null
  const local = layerLocalBounds(results, layerId)
  if (!local) return null
  const v = ui.view
  ui.setStageDrag({
    id: e.pointerId,
    mode,
    x: e.clientX,
    y: e.clientY,
    px: v.panX,
    py: v.panY,
    ox: 0,
    oy: 0,
    moved: false,
  })
  capture(e)
  return {
    layerId,
    mode,
    handle,
    start: layerTransformOf(layer),
    local,
    pivot: pivotOf(local),
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    moved: false,
  }
}

/**
 * Turn a pointer delta into the gesture's next placement.
 *
 * A move is plain arithmetic; scale and rotate reduce to `scaling.ts`, which
 * works in the box's local space so a rotated box needs no axis-aligned
 * round-trip. Returns null when the sample carries nothing actionable (a scale
 * or rotate with no canvas point yet).
 */
export function computeNext(
  g: Gesture,
  at: { x: number; y: number } | null,
  dx: number,
  dy: number,
  shift: boolean,
  alt: boolean,
): LayerTransform | null {
  if (g.mode === 'move') return { ...g.start, x: g.start.x + dx, y: g.start.y + dy }
  if (!at || !g.handle) return null
  if (g.mode === 'rotate') {
    return rotateTransform({ local: g.local, base: g.start, pivot: g.pivot, at, snap: shift })
  }
  // Corners scale proportionally by default; Shift frees them. An edge handle
  // only ever moves its own axis, so Shift cannot un-proportion it.
  return scaleTransform({
    local: g.local,
    base: g.start,
    pivot: g.pivot,
    handle: g.handle,
    at,
    proportional: isEdgeHandle(g.handle) ? false : !shift,
    fromCentre: alt,
  })
}

export interface Snapped {
  transform: LayerTransform
  guides: SnapGuide[]
}

/** Shared empty guides — a fresh `[]` per frame would wake subscribers pointlessly. */
const NO_GUIDES: SnapGuide[] = []

/**
 * Pull a candidate placement onto the canvas edges and centre line when the
 * option is on. Returns the placement unchanged (and no guides) otherwise.
 */
export function snapPlacement(g: Gesture, next: LayerTransform): Snapped {
  const ui = useUiStore.getState()
  if (!ui.view.snapToCanvas) {
    // Return the store's own array when there is nothing to show, so the caller
    // can set it without notifying anyone.
    if (ui.guides.length === 0) return { transform: next, guides: ui.guides }
    return { transform: next, guides: NO_GUIDES }
  }
  const box = quadBounds(transformQuad(g.local, transformMatrix(next, g.pivot)))
  const canvas = useProjectStore.getState().project.canvas
  const snapped = snapBox(box, canvasRules(canvas.w, canvas.h), canvas.w, canvas.h)
  return {
    transform: { ...next, x: next.x + snapped.dx, y: next.y + snapped.dy },
    guides: snapped.guides,
  }
}

/**
 * Collapse the gesture into exactly one commit, then drop the transient state.
 * A cancel (Esc) clears without writing.
 */
export function endLayerGesture(g: Gesture | null, commit: boolean): void {
  const ui = useUiStore.getState()
  if (commit && g && ui.stageDrag?.mode !== 'pan') {
    const live = ui.liveTransform
    if (live && live.layerId === g.layerId) {
      useProjectStore.getState().updateLayer(
        g.layerId,
        (l) => ({ ...l, transform: live.transform }),
        { coalesce: `transform:${g.mode}:${g.layerId}` },
      )
    }
  }
  ui.setLiveTransform(null)
  ui.setGuides([])
  ui.setStageDrag(null)
}

/** Pointer capture, tolerating a pointer that has already gone. */
export function capture(e: React.PointerEvent): void {
  try {
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  } catch {
    /* synthetic or retired pointer — the gesture still works without capture */
  }
}