/**
 * preview/useStageRaster.ts — what the stage actually paints.
 *
 * Two modes:
 *
 *   idle      one cached raster of the whole canvas, rebuilt only when the
 *             *content* changes or (debounced) when the zoom settles.
 *   dragging  no rasterising at all — see `gestureSurfaces.ts`. The stage blits
 *             two cached surfaces under the live CTM.
 *
 * The second mode is the point. Re-rasterising on each pointermove was 208 ms a
 * frame on a 40k-node blurred preset (measured), because a new IR identity
 * invalidated this cache; two blits cost 0.1 ms and 16 canvas calls.
 *
 * Both modes paint the background first and draw through the same view
 * transform, so switching between them cannot shift the artwork.
 */

import { useEffect, useRef } from 'react'
import { drawBackground, drawIR, type FilterRenderOpts } from '@/lib/render/canvas'
import type { IR } from '@/lib/ir'
import type { LayerResult } from '@/lib/pipeline'
import { transformMatrix } from '@/lib/transform'
import { useUiStore } from '@/store/uiStore'
import { useProjectStore } from '@/store/projectStore'
import { useRenderStore } from '@/store/renderStore'
import type { StageView } from './view'
import {
  acquireSurfaces,
  buildSurfaces,
  clearSurfaces,
  type GestureSurfaces,
} from './gestureSurfaces'

/** Raster ceilings — keep peak memory bounded on a 4K canvas. */
const MAX_RASTER_PIXELS = 12_000_000
const MAX_RASTER_EDGE = 6144
/** rebuild only when the raster resolution drifts more than this (5 %) */
const RASTER_TOLERANCE = 0.05
/** how long after the last zoom before we re-raster at full sharpness */
const RASTER_REFINE_MS = 180
/** rebuild the gesture snapshot if the raster scale moves this far */
const SNAPSHOT_UNIT_TOLERANCE = 0.02

export interface StageRasterOptions {
  ir: IR | null
  view: StageView | null
  filterOpts: FilterRenderOpts
  /** the live element, read through a getter so it is never subscribed to */
  getCanvas: () => HTMLCanvasElement | null
  /** stage size in CSS px — drives the backing-store size */
  size: { w: number; h: number }
  /** bumped to force a redraw after a debounced re-raster */
  refineTick: number
}

export function useStageRaster(opts: StageRasterOptions): void {
  const { ir, view, filterOpts, getCanvas, size, refineTick } = opts
  const live = useUiStore((s) => s.liveTransform)
  /**
   * The surfaces for the running gesture live in a ref, not the store: they hold
   * DOM nodes and only this effect cares, and a store write at the one moment
   * the app is trying to do as little as possible is exactly wrong.
   */
  const drag = useRef<GestureSurfaces | null>(null)

  useEffect(() => {
    const cvs = getCanvas()
    if (!cvs || !size.w || !size.h || !ir || !view) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const pw = Math.round(size.w * dpr)
    const ph = Math.round(size.h * dpr)
    if (cvs.width !== pw) cvs.width = pw
    if (cvs.height !== ph) cvs.height = ph
    const ctx = cvs.getContext('2d')
    if (!ctx) return

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, pw, ph)

    const { scale, ox, oy } = view
    const dx = Math.round(ox * dpr)
    const dy = Math.round(oy * dpr)
    const dw = Math.max(1, Math.round(ir.w * scale * dpr))
    const dh = Math.max(1, Math.round(ir.h * scale * dpr))

    const bg = useProjectStore.getState().project.canvas.bg
    if (bg.kind !== 'transparent') {
      ctx.save()
      ctx.setTransform(dw / ir.w, 0, 0, dh / ir.h, dx, dy)
      drawBackground(ctx, ir.w, ir.h, bg)
      ctx.restore()
    }

    const unit = rasterUnit(scale * dpr, ir.w, ir.h)
    const resultsVersion = useRenderStore.getState().resultsVersion

    if (live?.moved) {
      drawGesture(ctx, ir, view, unit, resultsVersion, drag)
      return
    }
    // Leaving a gesture drops the borrow; the committed transform makes the full
    // raster stale anyway, so the next idle pass rebuilds it.
    if (drag.current) drag.current = null

    const ui = useUiStore.getState()
    const contentKey = `${resultsVersion}|${ir.w}x${ir.h}`
    const meta = ui.rasterMeta
    const cached = ui.rasterCanvas
    const contentStale = !meta || !cached || meta.key !== contentKey || meta.ir !== ir
    const unitStale =
      meta !== null && !contentStale && Math.abs(meta.unit - unit) > unit * RASTER_TOLERANCE

    if (contentStale) {
      // new artwork invalidates every cached gesture snapshot
      clearSurfaces()
      const r = cached ?? document.createElement('canvas')
      if (!cached) ui.setRefs({ rasterCanvas: r })
      const w = Math.max(1, Math.round(ir.w * unit))
      const h = Math.max(1, Math.round(ir.h * unit))
      if (r.width !== w) r.width = w
      if (r.height !== h) r.height = h
      const rc = r.getContext('2d')
      if (rc) {
        rc.setTransform(1, 0, 0, 1, 0, 0)
        rc.clearRect(0, 0, w, h)
        rc.setTransform(unit, 0, 0, unit, 0, 0)
        drawIR(rc, ir, 1, undefined, filterOpts)
        ui.setRasterMeta({ key: contentKey, unit, ir })
      }
    } else if (unitStale) {
      // zoom moved on: show the existing raster stretched (free) and sharpen it
      // once the user stops
      if (ui.refineTimer) clearTimeout(ui.refineTimer as number)
      ui.setRefineTimer(
        window.setTimeout(() => {
          useUiStore.getState().setRefineTimer(null)
          useUiStore.getState().bumpRefine()
        }, RASTER_REFINE_MS),
      )
    }

    const r = useUiStore.getState().rasterCanvas
    if (r?.width) ctx.drawImage(r, dx, dy, dw, dh)
  }, [ir, view, live, size.w, size.h, refineTick, filterOpts, getCanvas])
}

/** Resolution the raster *should* have, capped for memory. */
function rasterUnit(want: number, w: number, h: number): number {
  return Math.min(
    want,
    Math.sqrt(MAX_RASTER_PIXELS / Math.max(1, w * h)),
    MAX_RASTER_EDGE / Math.max(1, w, h),
  )
}

/**
 * One frame of a gesture: `below`, then `self` under the live CTM.
 *
 * Surfaces are acquired on the first frame that needs them and reused for every
 * frame after, keyed by layer and resolution — see `gestureSurfaces.ts`.
 */
function drawGesture(
  ctx: CanvasRenderingContext2D,
  ir: IR,
  view: StageView,
  unit: number,
  contentVersion: number,
  drag: { current: GestureSurfaces | null },
): void {
  const live = useUiStore.getState().liveTransform
  const results: LayerResult[] | null = useRenderStore.getState().results
  if (!live || !results) return
  const project = useProjectStore.getState().project
  const layer = project.layers.find((l) => l.id === live.layerId)
  if (!layer) return

  const drift = drag.current ? Math.abs(drag.current.forUnit - unit) : Infinity
  if (!drag.current || drift > Math.max(1e-6, unit * SNAPSHOT_UNIT_TOLERANCE)) {
    drag.current = acquireSurfaces(layer.id, unit, contentVersion, () =>
      buildSurfaces(ir, project, results, layer, unit),
    )
  }
  const snap = drag.current
  if (!snap) return

  const place = (img: HTMLCanvasElement, m?: ReturnType<typeof transformMatrix>) => {
    ctx.save()
    ctx.setTransform(view.scale, 0, 0, view.scale, view.ox, view.oy)
    if (m) {
      ctx.translate(m.e, m.f)
      ctx.transform(m.a, m.b, m.c, m.d, 0, 0)
      ctx.translate(-snap.pivot.x, -snap.pivot.y)
    }
    ctx.drawImage(img, 0, 0, ir.w, ir.h)
    ctx.restore()
  }

  // `below` is already in canvas space — `composeIR` stamped every other layer's
  // own placement — so it blits straight through the view transform.
  place(snap.below)
  // `self` carries the layer's blend and opacity, applied here rather than baked
  // in, so the gesture composites exactly as the committed render will.
  ctx.save()
  ctx.globalCompositeOperation = snap.blend
  ctx.globalAlpha = snap.opacity
  place(snap.self, transformMatrix(live.transform, snap.pivot))
  ctx.restore()
}