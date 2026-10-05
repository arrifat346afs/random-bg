/**
 * preview/useStageDrag.ts — pointer gestures on the stage.
 *
 * The rule this hook exists to enforce: **a gesture never commits.** Moving or
 * transforming a layer writes `uiStore.liveTransform` at most once per animation
 * frame and touches nothing else — not `project`, not `version`, not the worker.
 * The single commit happens on pointer-up, as one coalesced history entry.
 *
 * Measured on a 10.4k-primitive project: committing per pointermove produced a
 * new IR, which invalidated the stage's raster cache and re-rasterised every
 * primitive for 70 ms a frame (~14 fps). The gesture now costs one store write
 * and two blits — 0.1 ms and 16 canvas calls a frame.
 *
 * The gesture record and its transitions live in `gestureCore.ts`; this file is
 * only the pointer wiring and the rAF coalescing.
 */

import { useCallback, useEffect, useRef } from 'react'
import { hitTestLayers } from '@/lib/select'
import type { HandleId } from '@/lib/handles'
import { useProjectStore } from '@/store/projectStore'
import { useRenderStore } from '@/store/renderStore'
import { useUiStore } from '@/store/uiStore'
import type { StageView } from './view'
import {
  MIN_TRAVEL_PX,
  beginLayerGesture,
  capture,
  computeNext,
  endLayerGesture,
  snapPlacement,
  type Gesture,
} from './gestureCore'

/** The newest pointer sample, kept out of state so moves cost no render. */
interface Sample {
  clientX: number
  clientY: number
  /** Shift: toggle proportional scaling, or snap rotation to 15° */
  shift: boolean
  /** Alt: scale about the centre instead of the opposite handle */
  alt: boolean
  dirty: boolean
}

export interface StageDragApi {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  /** commit the running gesture (Enter, or releasing a handle) */
  commitGesture: () => void
  /** drop the gesture without committing (Esc) */
  cancelGesture: () => void
  /** start a transform on one of the overlay's handles */
  beginHandle: (e: React.PointerEvent, layerId: string, handle: HandleId | 'rotate') => void
}

export function useStageDrag(
  view: StageView | null,
  getStage: () => HTMLElement | null,
): StageDragApi {
  /**
   * The gesture and the newest sample live in refs, not state: both change on
   * every pointer event and must not trigger a render. Only the derived
   * `liveTransform` reaches the store, and only once a frame.
   */
  const gesture = useRef<Gesture | null>(null)
  const sample = useRef<Sample>({ clientX: 0, clientY: 0, shift: false, alt: false, dirty: false })
  const frame = useRef<number | null>(null)

  const cancelFrame = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
  }, [])

  /** Run `fn` at most once per frame, collapsing the samples in between. */
  const schedule = useCallback((fn: () => void) => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      fn()
    })
  }, [])

  /** Screen (client) point → canvas units. */
  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const v = view
      const el = getStage()
      if (!v || !el) return null
      const rect = el.getBoundingClientRect()
      return {
        x: (clientX - rect.left - v.ox) / v.scale,
        y: (clientY - rect.top - v.oy) / v.scale,
      }
    },
    [view, getStage],
  )

  /**
   * Turn the newest sample into a live transform. One store write, one frame.
   *
   * Reads the pointer, asks `gestureCore` for the placement, optionally snaps
   * it, and publishes it — the gesture record itself was measured at
   * pointer-down, so nothing here re-measures geometry.
   */
  const applySample = useCallback(() => {
    const g = gesture.current
    const s = sample.current
    if (!g || !s.dirty || !view) return
    s.dirty = false
    const travelled =
      Math.abs(s.clientX - g.startX) > MIN_TRAVEL_PX ||
      Math.abs(s.clientY - g.startY) > MIN_TRAVEL_PX
    if (!g.moved && !travelled) return
    g.moved = true

    const ui = useUiStore.getState()
    // view.scale is the single source of truth, so the layer tracks the cursor
    // exactly at any zoom
    const next = computeNext(
      g,
      toCanvas(s.clientX, s.clientY),
      (s.clientX - g.startX) / view.scale,
      (s.clientY - g.startY) / view.scale,
      s.shift,
      s.alt,
    )
    if (!next) return
    const snapped = snapPlacement(g, next)
    ui.setGuides(snapped.guides)
    ui.setLiveTransform({ layerId: g.layerId, transform: snapped.transform, moved: true })
  }, [view, toCanvas])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const ui = useUiStore.getState()
      const project = useProjectStore.getState().project
      const middle = e.button === 1
      if (!ui.spaceHeld && !middle) {
        // Plain press on the artwork selects the topmost layer under the cursor
        // and starts a move; empty stage still deselects.
        if (e.target !== ui.canvasRef) return
        const p = toCanvas(e.clientX, e.clientY)
        const rs = useRenderStore.getState().results
        const hit = p && rs ? hitTestLayers(rs, project, p.x, p.y) : null
        useProjectStore.getState().selectLayer(hit)
        if (!hit) return
        gesture.current = beginLayerGesture(e, hit, 'move', null)
        return
      }
      e.preventDefault()
      ui.setStageDrag({
        id: e.pointerId,
        mode: 'pan',
        x: e.clientX,
        y: e.clientY,
        px: ui.view.panX,
        py: ui.view.panY,
        ox: 0,
        oy: 0,
        moved: false,
      })
      capture(e)
    },
    [toCanvas],
  )

  /** Called by the overlay when one of its handles is pressed. */
  const beginHandle = useCallback(
    (e: React.PointerEvent, layerId: string, handle: HandleId | 'rotate') => {
      e.stopPropagation()
      gesture.current = beginLayerGesture(
        e,
        layerId,
        handle === 'rotate' ? 'rotate' : 'scale',
        handle === 'rotate' ? null : handle,
      )
    },
    [],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = useUiStore.getState().stageDrag
      if (!d || d.id !== e.pointerId) return
      if (d.mode === 'pan') {
        useUiStore.getState().patchView({
          panX: d.px + (e.clientX - d.x),
          panY: d.py + (e.clientY - d.y),
        })
        return
      }
      const g = gesture.current
      if (!g || g.pointerId !== e.pointerId) return
      // Record the sample and let the frame callback act on it: pointermove can
      // fire several times between two paints, and each one must not cost a
      // store write.
      const s = sample.current
      s.clientX = e.clientX
      s.clientY = e.clientY
      s.shift = e.shiftKey
      s.alt = e.altKey
      s.dirty = true
      schedule(applySample)
    },
    [schedule, applySample],
  )

  /** Collapse the gesture into one commit (or nothing), then clear the state. */
  const endGesture = useCallback(
    (commit: boolean) => {
      cancelFrame()
      endLayerGesture(gesture.current, commit)
      gesture.current = null
      sample.current.dirty = false
    },
    [cancelFrame],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (useUiStore.getState().stageDrag?.id !== e.pointerId) return
      endGesture(true)
    },
    [endGesture],
  )

  useEffect(() => cancelFrame, [cancelFrame])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    beginHandle,
    commitGesture: () => endGesture(true),
    cancelGesture: () => endGesture(false),
  }
}