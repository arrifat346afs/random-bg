import { useState } from 'react'
import { formatSeed, parseSeed, randomSeedString } from '@/lib/rng'
import { mutateProject, variations, breed } from '@/lib/randomize'
import { randomise } from '@/lib/state/randomise'
import {
  applyProject,
  getState,
  patchProject,
  redo,
  saveTheme,
  setLockAspect,
  setState,
  undo,
} from '@/lib/state/store'
import { useStore } from '@/lib/state/useStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { SIZE_PRESETS } from '@/lib/schema'
import {
  Undo2,
  Redo2,
  Dices,
  Sparkles,
  Download,
  Sun,
  Moon,
  Monitor,
  Image as ImageIcon,
  ChevronDown,
  Bug,
  Copy,
  Ratio,
} from 'lucide-react'

interface Props {
  onOpenPresets: () => void
  onOpenGallery: () => void
  onOpenExport: () => void
  onOpenShortcuts: () => void
}

export function TopBar({ onOpenPresets, onOpenGallery, onOpenExport }: Props) {
  const project = useStore((s) => s.project)
  const generating = useStore((s) => s.generating)
  const theme = useStore((s) => s.view.theme)
  const lockAspect = useStore((s) => s.view.lockAspect)
  const canUndoNow = useStore((s) => s.past.length > 0)
  const canRedoNow = useStore((s) => s.future.length > 0)
  const storageOk = useStore((s) => s.storageAvailable)
  const [seedDraft, setSeedDraft] = useState(() => formatSeed(project.seed))
  const [showSeed, setShowSeed] = useState(false)

  // Keep the seed field in sync when the seed changes elsewhere (randomise,
  // undo, preset load) — adjusted while rendering rather than in an effect.
  const [prevSeed, setPrevSeed] = useState(project.seed)
  if (prevSeed !== project.seed) {
    setPrevSeed(project.seed)
    setSeedDraft(formatSeed(project.seed))
  }
  // the gated roll runs off-thread but still takes a moment; keep the button
  // honest about it and stop a second press queueing a second gate
  const [rolling, setRolling] = useState(false)

  const applySeed = (raw: string) => {
    const s = parseSeed(raw)
    patchProject((p) => ({ ...p, seed: s }))
  }

  const stepSeed = (delta: number) => applySeed(String(((project.seed + delta) >>> 0) || 1))

  const doRandomize = async () => {
    setRolling(true)
    try {
      await randomise()
    } finally {
      setRolling(false)
    }
  }
  const doMutate = () => applyProject(mutateProject(getState().project, 0.18))

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-1.5 border-b bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-3">
      {/* brand */}
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-primary to-fuchsia-500 text-primary-foreground shadow-sm">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="hidden leading-none sm:block">
          <div className="text-sm font-bold tracking-tight">FX Forge</div>
          <div className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            procedural overlays
          </div>
        </div>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6" />

      {/* history */}
      <div className="flex items-center gap-0.5">
        <Tip label="Undo (Ctrl+Z)">
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={!canUndoNow}
            onClick={undo}
            aria-label="Undo"
          >
            <Undo2 />
          </Button>
        </Tip>
        <Tip label="Redo (Ctrl+Y)">
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={!canRedoNow}
            onClick={redo}
            aria-label="Redo"
          >
            <Redo2 />
          </Button>
        </Tip>
      </div>

      {/* seed */}
      <div className="hidden items-center gap-1 md:flex">
        <div className="flex h-7 items-center overflow-hidden rounded-md border bg-muted/50">
          <button
            aria-label="Decrease seed"
            onClick={() => stepSeed(-1)}
            className="h-full px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            −
          </button>
          <input
            value={seedDraft}
            aria-label="Seed"
            onChange={(e) => setSeedDraft(e.target.value)}
            onBlur={(e) => applySeed(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applySeed(seedDraft)
              if (e.key === 'Escape') setSeedDraft(formatSeed(project.seed))
            }}
            className="h-full w-[112px] bg-transparent text-center font-mono text-[11px] tabular-nums outline-none"
          />
          <button
            aria-label="Increase seed"
            onClick={() => stepSeed(1)}
            className="h-full px-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            +
          </button>
        </div>
        <Tip label="New random seed">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => applySeed(randomSeedString())}
            aria-label="New seed"
          >
            <Dices />
          </Button>
        </Tip>
        <Tip label="Show the current seed as text">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Copy seed"
            onClick={() => {
              setShowSeed(true)
              void navigator.clipboard?.writeText(String(project.seed)).catch(() => {})
            }}
          >
            <Copy />
          </Button>
        </Tip>
      </div>

      <div className="flex-1" />

      {/* headline actions */}
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 px-1.5 tabular-nums"
              aria-label="Canvas size and aspect ratio"
              title="Canvas size"
            >
              <Ratio className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="hidden text-[11px] md:inline">
                {project.canvas.w}×{project.canvas.h}
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Canvas size</DropdownMenuLabel>

            {/* The toggle is phrased as the action it performs. Off — the
                default — keeps the current w×h on every Randomise; on rolls a
                new shape each press. Stored as `lockAspect`, hence the
                negation here. */}
            <div className="flex items-center justify-between gap-3 px-2 py-1.5">
              <label
                htmlFor="randomise-aspect"
                className="cursor-pointer text-xs leading-tight"
              >
                Randomise aspect
                <span className="block text-[10px] text-muted-foreground">
                  {lockAspect ? 'Off — keeps the current size' : 'On — new ratio each roll'}
                </span>
              </label>
              <Switch
                id="randomise-aspect"
                checked={!lockAspect}
                onCheckedChange={(v) => setLockAspect(!v)}
              />
            </div>

            <DropdownMenuSeparator />
            <DropdownMenuLabel>Presets</DropdownMenuLabel>
            {SIZE_PRESETS.map((s) => {
              const active = project.canvas.w === s.w && project.canvas.h === s.h
              return (
                <DropdownMenuItem
                  key={s.label}
                  onSelect={() =>
                    patchProject((p) => ({ ...p, canvas: { ...p.canvas, w: s.w, h: s.h } }))
                  }
                  className="flex items-center justify-between gap-2"
                >
                  <span className={active ? 'font-medium text-foreground' : undefined}>
                    {s.label}
                  </span>
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {s.w}×{s.h}
                  </span>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          size="sm"
          variant="outline"
          onClick={() => void doRandomize()}
          disabled={rolling}
          title="Random project (R)"
        >
          <Dices className={rolling ? 'animate-spin' : undefined} />
          <span className="hidden lg:inline">{rolling ? 'Rolling…' : 'Randomise'}</span>
        </Button>
        <Button size="sm" variant="secondary" onClick={doMutate} title="Mutate current project">
          <Sparkles />
          <span className="hidden lg:inline">Mutate</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="px-1.5" aria-label="More variations">
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Explore
            </DropdownMenuLabel>
            <MenuItem onClick={onOpenGallery}>Evolve gallery (8 variations)</MenuItem>
            <MenuItem onClick={() => applyProject(breed(getState().project, getState().project))}>
              Breed with itself
            </MenuItem>
            <MenuItem
              onClick={() => {
                const vs = variations(getState().project, 6)
                if (vs[0]) applyProject(vs[0])
              }}
            >
              One-step variation
            </MenuItem>
            <DropdownMenuSeparator />
            <MenuItem onClick={onOpenPresets}>Browse preset library…</MenuItem>
            <MenuItem
              onClick={() =>
                setState({ gallery: variations(getState().project, 9) })
              }
            >
              Re-roll the gallery
            </MenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" variant="glow" onClick={onOpenExport}>
          <Download />
          <span className="hidden sm:inline">Export</span>
        </Button>
      </div>

      <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />

      {/* status + theme */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onOpenPresets}
              className="hidden h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground sm:flex"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Presets
            </button>
          </TooltipTrigger>
          <TooltipContent>Open the preset library</TooltipContent>
        </Tooltip>

        {!storageOk && (
          <Badge variant="warning" className="hidden md:inline-flex">
            <Bug className="h-3 w-3" /> Storage off
          </Badge>
        )}

        <Tip label={`Theme: ${theme}`}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Change theme"
            onClick={() => {
              const next =
                theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
              setState({ view: { ...getState().view, theme: next } })
              saveTheme()
            }}
          >
            {theme === 'light' ? (
              <Sun />
            ) : theme === 'dark' ? (
              <Moon />
            ) : (
              <Monitor />
            )}
          </Button>
        </Tip>
      </div>

      {/* live render status, absolutely centred so it never shifts the bar */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 lg:flex">
        {generating && (
          <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-primary" />
            generating…
          </span>
        )}
      </div>

      <SeedDialog open={showSeed} onClose={() => setShowSeed(false)} seed={project.seed} />
    </header>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full select-none items-center rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </button>
  )
}

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function SeedDialog({
  open,
  onClose,
  seed,
}: {
  open: boolean
  onClose: () => void
  seed: number
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Seed</DialogTitle>
          <DialogDescription>
            The seed fully determines the project. Share it to reproduce this exact render.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/50 p-3 text-center font-mono text-lg tabular-nums">
          {seed}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void navigator.clipboard?.writeText(String(seed)).catch(() => {})}
          >
            Copy number
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* end of TopBar */
