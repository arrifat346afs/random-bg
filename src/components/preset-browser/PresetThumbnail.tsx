import { useEffect, useRef, useState } from 'react'
import { generateProject } from '@/lib/pipeline'
import { compositeLayers } from '@/lib/export'
import { renderCanvas } from '@/lib/render/canvas'
import { projectFilterOpts } from '@/lib/filters/attach'
import type { Project } from '@/lib/schema'
import { RefreshCw } from 'lucide-react'

/** Lower primitive budget so a grid of previews never materialises full scenes. */
const THUMB_MAX_PRIMITIVES = 6000
const THUMB_LONG_EDGE = 360

/**
 * Live canvas thumbnail for a preset project.
 * Renders lazily when scrolled into view, mirroring GalleryCard.
 */
export function PresetThumbnail({ project, label }: { project: Project; label: string }) {
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  // Fresh mount starts loading; the project per card is stable (memoized and
  // keyed by preset id), so no reset-on-change effect is needed.
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')

  useEffect(() => {
    const el = hostRef.current
    if (!el || visible) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    const run = async () => {
      try {
        const results = await generateProject(project, { maxPrimitives: THUMB_MAX_PRIMITIVES })
        if (cancelled) return
        const ir = compositeLayers(project, results)
        const canvas = canvasRef.current
        if (!canvas) return
        const scale = THUMB_LONG_EDGE / Math.max(ir.w, ir.h)
        renderCanvas(ir, canvas, {
          scale,
          background: project.canvas.bg,
          clear: true,
          filters: projectFilterOpts(project),
        })
        if (!cancelled) setStatus('done')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [visible, project])

  return (
    <span ref={hostRef} className="checkerboard relative block aspect-4/3 w-full overflow-hidden rounded-md">
      <canvas ref={canvasRef} className="h-full w-full object-cover" aria-label={`${label} preview`} />
      {(!visible || status === 'loading') && (
        <span className="absolute inset-0 flex items-center justify-center bg-muted/60">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        </span>
      )}
      {status === 'error' && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
          preview failed
        </span>
      )}
    </span>
  )
}
