import { Component, Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { useStore } from '@/lib/state/useStore'
import { useRenderer } from '@/lib/state/useRenderer'
import {
  getState,
  setState,
  undo,
  redo,
  commit,
} from '@/lib/state/store'
import { randomise } from '@/lib/state/randomise'
import { duplicateLayer } from '@/lib/project'
import { isTyping } from '@/lib/keyboard'
import { TopBar } from '@/components/TopBar'
import { LayerPanel } from '@/components/LayerPanel'
import { Inspector } from '@/components/Inspector'
import { Preview } from '@/components/Preview'
import { PanelLeft, PanelRight, Settings2, X } from 'lucide-react'

/* Heavy dialogs are code-split: they are not needed for the first paint. */
const PresetBrowser = lazy(() =>
  import('@/components/PresetBrowser').then((m) => ({ default: m.PresetBrowser })),
)
const GalleryDialog = lazy(() =>
  import('@/components/GalleryDialog').then((m) => ({ default: m.GalleryDialog })),
)
const ExportDialog = lazy(() =>
  import('@/components/ExportDialog').then((m) => ({ default: m.ExportDialog })),
)
const SettingsDialog = lazy(() =>
  import('@/components/SettingsDialog').then((m) => ({ default: m.SettingsDialog })),
)

type DialogId = 'presets' | 'gallery' | 'export' | 'settings' | null

export default function App() {
  useRenderer()

  const theme = useStore((s) => s.view.theme)
  const leftSheet = useStore((s) => s.leftSheet)
  const rightSheet = useStore((s) => s.rightSheet)
  const [dialog, setDialog] = useState<DialogId>(null)
  const closeDialog = useCallback(() => setDialog(null), [])

  /* ---- theme: apply `dark` to <html> and honour the OS preference ---- */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  /* ---- global shortcuts ------------------------------------------------ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && key === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod && key === 'd') {
        e.preventDefault()
        const s = getState()
        const idx = s.project.layers.findIndex((l) => l.id === s.selectedLayerId)
        if (idx >= 0) {
          const copy = duplicateLayer(s.project.layers[idx])
          const next = s.project.layers.slice()
          next.splice(idx + 1, 0, copy)
          commit({ ...s.project, layers: next }, { select: copy.id })
        }
        return
      }
      if (mod) return

      switch (key) {
        case 'r':
          e.preventDefault()
          void randomise()
          break
        case 'e':
          e.preventDefault()
          setDialog('export')
          break
        case 'p':
          e.preventDefault()
          setDialog('presets')
          break
        case 'g':
          e.preventDefault()
          setState({ gallery: null })
          setDialog('gallery')
          break
        case ',':
          e.preventDefault()
          setDialog('settings')
          break
        case '0':
          setState({ view: { ...getState().view, zoom: 1, panX: 0, panY: 0 } })
          break
        case '=':
        case '+':
          setState({ view: { ...getState().view, zoom: Math.min(8, getState().view.zoom * 1.25) } })
          break
        case '-':
          setState({ view: { ...getState().view, zoom: Math.max(0.05, getState().view.zoom / 1.25) } })
          break
        case 'escape':
          setState({ leftSheet: false, rightSheet: false })
          break
        case '?':
          setDialog('settings')
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ---- Preview's empty-state "Randomise" button ------------------------ */
  useEffect(() => {
    const handler = () => void randomise()
    window.addEventListener('fx:randomize', handler)
    return () => window.removeEventListener('fx:randomize', handler)
  }, [])

  return (
    <TooltipProvider delayDuration={250}>
      <ErrorBoundary>
        <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
          <TopBar
            onOpenPresets={() => setDialog('presets')}
            onOpenGallery={() => setDialog('gallery')}
            onOpenExport={() => setDialog('export')}
            onOpenShortcuts={() => setDialog('settings')}
          />

          <div className="relative flex min-h-0 flex-1">
            {/* ---- left: layer stack ---- */}
            <aside className="hidden w-64 shrink-0 flex-col border-r bg-background lg:flex xl:w-72">
              <LayerPanel />
            </aside>

            {/* ---- centre: preview + project strip ---- */}
            <main className="flex min-w-0 flex-1 flex-col">
              <Preview />
              <ProjectStrip
                onOpenSettings={() => setDialog('settings')}
                leftOpen={leftSheet}
                rightOpen={rightSheet}
                onToggleLeft={() => setState({ leftSheet: !leftSheet, rightSheet: false })}
                onToggleRight={() => setState({ rightSheet: !rightSheet, leftSheet: false })}
              />
            </main>

            {/* ---- right: inspector ---- */}
            <aside className="hidden w-72 shrink-0 flex-col border-l bg-background lg:block xl:w-[22rem]">
              <Inspector />
            </aside>

            {/* ---- mobile sheet toggles live in the footer strip ---- */}
            {leftSheet && (
              <MobileSheet side="left" onClose={() => setState({ leftSheet: false })} title="Layers">
                <LayerPanel />
              </MobileSheet>
            )}
            {rightSheet && (
              <MobileSheet side="right" onClose={() => setState({ rightSheet: false })} title="Inspector">
                <Inspector />
              </MobileSheet>
            )}
          </div>
        </div>

        {/* ---- dialogs ---- */}
        <Suspense fallback={null}>
          {dialog === 'presets' && <PresetBrowser open onOpenChange={(v) => !v && closeDialog()} />}
          {dialog === 'gallery' && <GalleryDialog open onOpenChange={(v) => !v && closeDialog()} />}
          {dialog === 'export' && <ExportDialog open onOpenChange={(v) => !v && closeDialog()} />}
          {dialog === 'settings' && <SettingsDialog open onOpenChange={(v) => !v && closeDialog()} />}
        </Suspense>
      </ErrorBoundary>
    </TooltipProvider>
  )
}

/* ---- bottom project strip: canvas info + quick actions ------------------ */

function ProjectStrip({
  onOpenSettings,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
}: {
  onOpenSettings: () => void
  leftOpen: boolean
  rightOpen: boolean
  onToggleLeft: () => void
  onToggleRight: () => void
}) {
  const project = useStore((s) => s.project)
  const generating = useStore((s) => s.generating)
  const storageOk = useStore((s) => s.storageAvailable)

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
        <span className="hidden max-w-[8rem] truncate sm:inline">{project.name}</span>
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

function MobileSheet({
  side,
  title,
  children,
  onClose,
}: {
  side: 'left' | 'right'
  title: string
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`absolute inset-y-0 flex w-[88vw] max-w-sm flex-col bg-background shadow-2xl ${
          side === 'left'
            ? 'left-0 border-r animate-slide-from-left'
            : 'right-0 border-l animate-slide-from-right'
        }`}
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close panel">
            <X />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}

/* ---- error boundary: never let a render bug blank the whole app --------- */

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-lg font-semibold">Something broke in the UI</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Your project is still saved in this browser. Reload to get back to a clean state.
        </p>
        <pre className="max-w-lg overflow-auto rounded-lg border bg-muted p-3 text-left text-xs">
          {this.state.error.message}
        </pre>
        <div className="flex gap-2">
          <Button onClick={() => location.reload()}>Reload</Button>
          <Button
            variant="outline"
            onClick={() => {
              try {
                localStorage.removeItem('fx-forge:project:v1')
              } catch {
                /* ignore */
              }
              location.reload()
            }}
          >
            Reset saved project
          </Button>
        </div>
      </div>
    )
  }
}

/* end of App */
