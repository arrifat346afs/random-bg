/**
 * ProjectStrip — the status bar under the preview.
 *
 * Also hosts the mobile sheet toggles, which belong here rather than floating
 * over the preview because they would collide with its zoom controls.
 */

import { PanelLeft, PanelRight, Settings2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useProjectStore } from '@/lib/state/projectStore'
import { useRenderStore } from '@/lib/state/renderStore'
import { useUiStore } from '@/lib/state/uiStore'

interface Props {
  onOpenSettings: () => void
  leftOpen: boolean
  rightOpen: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}

export function ProjectStrip({
  onOpenSettings,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
}: Props) {
  const project = useProjectStore((s) => s.project)
  const generating = useRenderStore((s) => s.generating)
  const storageOk = useUiStore((s) => s.storageAvailable)

  return (
    <footer className="flex h-9 shrink-0 items-center gap-2 border-t bg-background px-2 text-[11px] text-muted-foreground sm:gap-3 sm:px-3">
      {/* Panels are sheets below `lg`, so their toggles live here — out of the
          way of the preview's floating controls. */}
      <div className="flex gap-1 lg:hidden">
        <SheetButton side="left" open={leftOpen} onClick={onToggleLeft} />
        <SheetButton side="right" open={rightOpen} onClick={onToggleRight} />
      </div>

      <button
        onClick={onOpenSettings}
        className="flex min-w-0 items-center gap-1 hover:text-foreground"
        title="Project settings (,)"
      >
        <Settings2 className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden max-w-32 truncate sm:inline">{project.name}</span>
      </button>
      <Separator orientation="vertical" className="hidden h-4 sm:block" />
      <button
        onClick={onOpenSettings}
        className="shrink-0 rounded tabular-nums hover:text-foreground"
        title="Canvas size (,)"
      >
        {project.canvas.w}×{project.canvas.h}
      </button>
      <Separator orientation="vertical" className="hidden h-4 sm:block" />
      <span className="hidden shrink-0 sm:inline">bg: {project.canvas.bg.kind}</span>
      <div className="min-w-0 flex-1" />
      {!storageOk && (
        <Badge variant="warning" className="shrink-0 text-[9px]">
          autosave off
        </Badge>
      )}
      {generating && (
        <span className="flex shrink-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          rendering
        </span>
      )}
    </footer>
  )
}

function SheetButton({
  side,
  open,
  onClick,
}: {
  side: 'left' | 'right'
  open: boolean
  onClick: () => void
}) {
  const Icon = side === 'left' ? PanelLeft : PanelRight
  return (
    <Button
      size="sm"
      variant={open ? 'default' : 'secondary'}
      onClick={onClick}
      className="h-6 gap-1 px-2 text-[11px] shadow-none"
    >
      <Icon className="h-3.5 w-3.5" />
      {side === 'left' ? 'Layers' : 'Edit'}
    </Button>
  )
}