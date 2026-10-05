/**
 * useRenderer — drives generation.
 *
 * The bridge between the document and the render loop. It watches
 * `projectStore.version` and nothing else, because that counter is bumped by
 * every change that invalidates the cached IR.
 *
 * It then decides whether the change actually needs the engine at all. A move, a
 * resize, a rotation and a filter edit all leave `generationSignature`
 * unchanged, and for those this hook does nothing: no `beginRender`, so the
 * "Generating" bar cannot appear, and no worker round trip, so the preview's
 * raster stays valid. Those edits reach the screen through the stage's own draw
 * path, which reads the project directly.
 */

import { useEffect, useRef } from 'react'
import { requestRender } from '../lib/render/service'
import { generationSignature } from '../lib/generation'
import { useProjectStore } from './projectStore'
import { beginRender, failRender, finishRender, useRenderStore } from './renderStore'

/** Debounce before asking for a render; collapses a slider drag into one pass. */
const RENDER_DEBOUNCE_MS = 55

export function useRenderer(): void {
  const version = useProjectStore((s) => s.version)
  /**
   * The signature of the last project we actually generated for.
   *
   * A ref rather than state: it is bookkeeping for this hook, not something to
   * render. Reading it inside the effect (which closes over the ref object) is
   * safe even though the value changed during render.
   */
  const lastGenerated = useRef<string | null>(null)

  useEffect(() => {
    const { project } = useProjectStore.getState()
    const signature = generationSignature(project)
    // Nothing that feeds the engine changed — a transform, a filter, a
    // visibility-only edit. The stage redraws itself; there is no work to do.
    if (signature === lastGenerated.current) return
    lastGenerated.current = signature

    let cancelled = false
    beginRender()
    const timer = setTimeout(async () => {
      try {
        const { project: current } = useProjectStore.getState()
        const out = await requestRender(current, (p) => {
          if (!cancelled) useRenderStore.setState({ progress: p })
        })
        if (cancelled) return
        finishRender(out)
      } catch (err) {
        if (cancelled) return
        failRender(err instanceof Error ? err.message : String(err))
      }
    }, RENDER_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [version])
}