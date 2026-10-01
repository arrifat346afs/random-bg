/**
 * App — application shell.
 *
 * Layout and nothing else: it composes the chrome and owns which dialog is
 * open. Everything with behaviour lives elsewhere — see `useGlobalShortcuts` and
 * `useThemeEffect` for input handling, `useRenderer` for the generation loop,
 * and the components below for anything that renders pixels.
 */

import { Suspense, lazy, useCallback, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { MobileSheet } from '@/components/MobileSheet'
import { ProjectStrip } from '@/components/ProjectStrip'
import { LayerPanel } from '@/components/LayerPanel'
import { Preview } from '@/components/Preview'
import { Inspector } from '@/components/Inspector'
import { TopBar } from '@/components/TopBar'
import { useGlobalShortcuts, type DialogId } from '@/hooks/useGlobalShortcuts'
import { useThemeEffect } from '@/hooks/useThemeEffect'
import { useRenderer } from '@/lib/state/useRenderer'
import { useStore } from '@/lib/state/useStore'
import { setState } from '@/lib/state/store'

// Dialogs are heavy and rarely opened, so they stay out of the initial bundle.
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

export default function App() {
  useRenderer()
  useThemeEffect()

  const leftSheet = useStore((s) => s.leftSheet)
  const rightSheet = useStore((s) => s.rightSheet)
  const [dialog, setDialog] = useState<DialogId>(null)

  // stable identity: useGlobalShortcuts re-subscribes on this
  const openDialog = useCallback((id: DialogId) => setDialog(id), [])
  const closeDialog = useCallback(() => setDialog(null), [])

  useGlobalShortcuts(openDialog)

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
            <aside className="hidden w-72 shrink-0 flex-col border-l bg-background lg:block xl:w-88">
              <Inspector />
            </aside>

            {/* ---- mobile sheet toggles live in the footer strip ---- */}
            {leftSheet && (
              <MobileSheet side="left" onClose={() => setState({ leftSheet: false })} title="Layers">
                <LayerPanel />
              </MobileSheet>
            )}
            {rightSheet && (
              <MobileSheet
                side="right"
                onClose={() => setState({ rightSheet: false })}
                title="Inspector"
              >
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