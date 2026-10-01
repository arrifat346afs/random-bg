/**
 * useRenderer — drives generation.
 *
 * The bridge between the document and the render loop: it watches
 * `projectStore.version` and nothing else, because that counter is bumped by
 * every change that invalidates the cached IR. Requests are debounced (dragging
 * a slider fires one render per tick) and the render service coalesces anything
 * that falls behind, so the UI never queues up stale work.
 */

import { useEffect } from 'react'
import { requestRender } from '../render/service'
import { useProjectStore } from './projectStore'
import { beginRender, failRender, finishRender, useRenderStore } from './renderStore'

/** Debounce before asking for a render; collapses a slider drag into one pass. */
const RENDER_DEBOUNCE_MS = 55

export function useRenderer(): void {
  const version = useProjectStore((s) => s.version)

  useEffect(() => {
    let cancelled = false
    beginRender()
    const timer = setTimeout(async () => {
      const { project } = useProjectStore.getState()
      try {
        const out = await requestRender(project, (p) => {
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