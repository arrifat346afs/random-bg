import { useEffect, useRef, useState } from 'react'
import { variations } from '@/lib/randomize'
import { generateProject } from '@/lib/pipeline'
import { compositeLayers } from '@/lib/export'
import { renderCanvas } from '@/lib/render/canvas'
import type { Project } from '@/lib/schema'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sparkles, RefreshCw, Check } from 'lucide-react'
import { useProjectStore } from '@/lib/state/projectStore'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

/**
 * Mutate/Evolve gallery — nine variations of the current project rendered as
 * live thumbnails. Picking one re-parents the project; Ctrl+Z restores it.
 */
export function GalleryDialog({ open, onOpenChange }: Props) {
  const project = useProjectStore((s) => s.project)
  const [items, setItems] = useState<Project[]>(() => variations(useProjectStore.getState().project, 9))
  const [round, setRound] = useState(0)

  // Re-roll whenever the dialog opens (adjusted while rendering).
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setItems(variations(useProjectStore.getState().project, 9))
      setRound((r) => r + 1)
    }
  }

  const regenerate = () => {
    setItems(variations(useProjectStore.getState().project, 9))
    setRound((r) => r + 1)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Evolve
          </DialogTitle>
          <DialogDescription>
            Nine mutations of <span className="font-medium text-foreground">{project.name}</span>.
            The first four are gentle, the rest push further. Pick one to re-parent the project —
            Ctrl+Z brings the old one back.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between border-b px-4 py-2">
          <Badge variant="muted">seed {project.seed}</Badge>
          <Button size="sm" variant="outline" onClick={regenerate}>
            <RefreshCw /> Re-roll nine
          </Button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto thin-scroll p-4 sm:grid-cols-3">
          {items.map((p, i) => (
            <GalleryCard
              key={`${round}-${i}`}
              project={p}
              index={i}
              onPick={() => {
                useProjectStore.getState().applyProject(p)
                onOpenChange(false)
              }}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function GalleryCard({
  project,
  index,
  onPick,
}: {
  project: Project
  index: number
  onPick: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading')

  // Flip back to "loading" while rendering whenever the card's project changes.
  const [prevProject, setPrevProject] = useState(project)
  if (prevProject !== project) {
    setPrevProject(project)
    setStatus('loading')
  }

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const results = await generateProject(project)
        if (cancelled) return
        const ir = compositeLayers(project, results)
        const canvas = canvasRef.current
        if (!canvas) return
        // renderCanvas sizes the bitmap itself: target ~360px on the long edge
        const scale = 360 / Math.max(ir.w, ir.h)
        renderCanvas(ir, canvas, { scale, background: project.canvas.bg, clear: true })
        setStatus('done')
      } catch {
        if (!cancelled) setStatus('error')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [project])

  return (
    <button
      onClick={onPick}
      className="group relative flex flex-col overflow-hidden rounded-lg border bg-muted/30 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-lg"
    >
      <span className="relative block aspect-[4/3] w-full overflow-hidden">
        <canvas
          ref={canvasRef}
          className="h-full w-full object-cover"
          aria-label={`Variation ${index + 1}`}
        />
        {status === 'loading' && (
          <span className="absolute inset-0 flex items-center justify-center bg-muted/60">
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
          </span>
        )}
        {status === 'error' && (
          <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
            render failed
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-primary/0 opacity-0 transition-all group-hover:bg-primary/20 group-hover:opacity-100">
          <span className="flex items-center gap-1 rounded-full bg-background px-3 py-1.5 text-xs font-semibold shadow">
            <Check className="h-3.5 w-3.5" /> Use this
          </span>
        </span>
      </span>
      <span className="flex items-center justify-between px-2.5 py-1.5">
        <span className="truncate text-[11px] font-medium">{project.name.slice(0, 28)}</span>
        <Badge variant="muted" className="shrink-0 text-[9px]">
          {index < 4 ? 'subtle' : 'bold'}
        </Badge>
      </span>
    </button>
  )
}
