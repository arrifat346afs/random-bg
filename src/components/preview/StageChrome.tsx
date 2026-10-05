/**
 * preview/StageChrome.tsx — the floating UI around the artwork.
 *
 * Split out of `Preview` so the stage element itself stays small: chrome edits
 * here cannot invalidate the raster effect's dependencies, and vice versa.
 */

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Maximize, Minus, Plus, Layers } from 'lucide-react'

export interface StageChromeProps {
  zoom: number
  onZoomBy: (k: number) => void
  onFit: () => void
  /** progress bar visibility is owned by the render loop, never by a gesture */
  showProgress: boolean
  progress: { done: number; total: number; label: string } | null
  generating: boolean
  error: string | null
  canvasLabel: string
  primitiveCount: number
  truncated: boolean
  renderMs: number
  layerCount: number
  onAddLayer: () => void
  onRandomise: () => void
}

export function StageChrome(props: StageChromeProps) {
  const pct = Math.round(props.zoom * 100)
  return (
    <>
      {props.layerCount === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center">
          <div className="pointer-events-auto max-w-sm rounded-xl border border-dashed bg-background/85 p-6 backdrop-blur">
            <Layers className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <h3 className="mb-1 text-sm font-semibold">No layers yet</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Add a generator layer on the left, or press{' '}
              <kbd className="rounded border bg-muted px-1 py-0.5 text-[10px]">R</kbd> to randomise a
              whole project.
            </p>
            <div className="pointer-events-auto flex justify-center gap-2">
              <Button size="sm" onClick={props.onAddLayer}>
                Add layer
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => window.dispatchEvent(new CustomEvent('fx:randomize'))}
              >
                Randomise
              </Button>
            </div>
          </div>
        </div>
      )}

      {props.showProgress && props.progress && (
        <div className="absolute inset-x-0 bottom-0 z-10 bg-background/80 px-4 py-2 backdrop-blur">
          <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Generating <span className="text-foreground">{props.progress.label}</span>…
            </span>
            <span>
              {props.progress.done}/{props.progress.total}
            </span>
          </div>
          <Progress value={(props.progress.done / Math.max(1, props.progress.total)) * 100} />
        </div>
      )}

      {props.error && (
        <div className="absolute inset-x-3 top-3 z-10 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive backdrop-blur">
          <strong className="font-semibold">Render error:</strong> {props.error}
        </div>
      )}

      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-lg border bg-background/90 p-1 shadow backdrop-blur">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => props.onZoomBy(1 / 1.25)}
              aria-label="Zoom out"
            >
              <Minus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom out (−)</TooltipContent>
        </Tooltip>
        <button
          className="min-w-[3.2rem] rounded px-1 text-[11px] tabular-nums text-muted-foreground hover:text-foreground"
          onClick={props.onFit}
          title="Fit to view (0)"
        >
          {pct}%
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => props.onZoomBy(1.25)}
              aria-label="Zoom in"
            >
              <Plus />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom in (+)</TooltipContent>
        </Tooltip>
        <div className="mx-0.5 h-4 w-px bg-border" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" onClick={props.onFit} aria-label="Fit to view">
              <Maximize />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Fit to view</TooltipContent>
        </Tooltip>
      </div>

      {/* Keep clear of the floating zoom controls in the bottom-right. */}
      <div className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-11rem)] flex-wrap items-center gap-2">
        <Badge variant="muted" className="bg-background/85 backdrop-blur">
          {props.canvasLabel}
        </Badge>
        <Badge variant="muted" className="bg-background/85 backdrop-blur">
          {props.primitiveCount.toLocaleString()} primitives
        </Badge>
        {props.truncated && (
          <Badge variant="warning" className="bg-background/85 backdrop-blur">
            capped at 40k
          </Badge>
        )}
        {!props.generating && (
          <Badge
            variant="muted"
            className="hidden bg-background/85 backdrop-blur tabular-nums sm:inline-flex"
          >
            {props.renderMs.toFixed(1)} ms
          </Badge>
        )}
      </div>
    </>
  )
}