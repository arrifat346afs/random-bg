import { useEffect } from 'react'
import { getState, setState } from './store'
import { useStore } from './useStore'
import { requestRender } from '../render/service'

/**
 * Drives generation: whenever the project version bumps, request a render.
 * Requests are debounced (dragging a slider fires one render per tick) and the
 * render service coalesces anything that falls behind, so the UI never queues
 * up stale work.
 */
export function useRenderer(): void {
  const version = useStore((s) => s.version)

  useEffect(() => {
    let cancelled = false
    setState({ generating: true, error: null })
    const timer = setTimeout(async () => {
      const { project } = getState()
      try {
        const out = await requestRender(project, (p) => {
          if (!cancelled) setState({ progress: p })
        })
        if (cancelled) return
        setState({
          results: out.results,
          resultsVersion: getState().resultsVersion + 1,
          primitiveCount: out.count,
          truncated: out.truncated,
          renderMs: out.ms,
          generating: false,
          progress: null,
        })
      } catch (err) {
        if (cancelled) return
        setState({
          generating: false,
          progress: null,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }, 55)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [version])
}
