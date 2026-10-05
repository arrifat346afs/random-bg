/**
 * preview/view.ts — the stage's screen transform.
 *
 * One object, computed once, shared by the raster blit and every overlay, so the
 * selection box and the pixels underneath it can never drift apart: they are
 * derived from the same `scale`/`ox`/`oy`.
 */

import { useMemo } from 'react'
import { useUiStore } from '@/store/uiStore'

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 8

/** Canvas units → CSS pixels, plus the canvas origin in CSS pixels. */
export interface StageView {
  scale: number
  ox: number
  oy: number
}

/** Map a canvas-space point to CSS pixels within the stage. */
export function toScreen(v: StageView, x: number, y: number): { x: number; y: number } {
  return { x: v.ox + x * v.scale, y: v.oy + y * v.scale }
}

/**
 * Fit-to-stage scale for the current zoom.
 *
 * `irW`/`irH` are the canvas dimensions; they are passed rather than read so the
 * caller keeps the dependency narrow and this stays a pure function of its
 * arguments.
 */
export function useStageView(irW: number, irH: number): StageView | null {
  const size = useUiStore((s) => s.stageSize)
  const zoom = useUiStore((s) => s.view.zoom)
  const panX = useUiStore((s) => s.view.panX)
  const panY = useUiStore((s) => s.view.panY)
  return useMemo(() => {
    if (!size.w || !size.h || !irW || !irH) return null
    const fit = Math.min(size.w / irW, size.h / irH) * 0.93
    const scale = fit * zoom
    return {
      scale,
      ox: (size.w - irW * scale) / 2 + panX,
      oy: (size.h - irH * scale) / 2 + panY,
    }
  }, [irW, irH, zoom, panX, panY, size.w, size.h])
}