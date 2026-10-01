/**
 * App — application shell.
 *
 * Layout and nothing else: it composes the chrome and reads which dialog is
 * open. Everything with behaviour lives elsewhere — see `useGlobalShortcuts` for
 * input handling, `useThemeEffect` for dark mode, `useRenderer` for the
 * generation loop, and the components below for anything that renders pixels.
 */

import { Suspense, lazy } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { MobileSheet } from '@/components/MobileSheet'
import { ProjectStrip } from '@/components/ProjectStrip'
import { LayerPanel } from '@/components/LayerPanel'
import { Preview } from '@/components/Preview'
import { Inspector } from '@/components/Inspector'
import { TopBar } from '@/components/TopBar'
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts'
import { useThemeEffect } from '@/hooks/useThemeEffect'
import { useRenderer } from '@/store/useRenderer'
import { useUiStore } from '@/store/uiStore'

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
  useGlobalShortcuts()

  const leftSheet = useUiStore((s) => s.leftSheet)
  const rightSheet = useUiStore((s) => s.rightSheet)
  const dialog = useUiStore((s) => s.dialog)
  // Actions are stable across renders, so this never re-subscribes.
  const ui = () => useUiStore.getState()

  return (
    <TooltipProvider delayDuration={250}>
      <ErrorBoundary>
        <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
          <TopBar
            onOpenPresets={() => ui().openDialog('presets')}
            onOpenGallery={() => ui().openDialog('gallery')}
            onOpenExport={() => ui().openDialog('export')}
            onOpenShortcuts={() => ui().openDialog('settings')}
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
                onOpenSettings={() => ui().openDialog('settings')}
                leftOpen={leftSheet}
                rightOpen={rightSheet}
                onToggleLeft={() => ui().toggleSheet('left')}
                onToggleRight={() => ui().toggleSheet('right')}
              />
            </main>

            {/* ---- right: inspector ---- */}
            <aside className="hidden w-72 shrink-0 flex-col border-l bg-background lg:block xl:w-88">
              <Inspector />
            </aside>

            {/* ---- mobile sheet toggles live in the footer strip ---- */}
            {leftSheet && (
              <MobileSheet side="left" onClose={() => ui().closeSheet('left')} title="Layers">
                <LayerPanel />
              </MobileSheet>
            )}
            {rightSheet && (
              <MobileSheet side="right" onClose={() => ui().closeSheet('right')} title="Inspector">
                <Inspector />
              </MobileSheet>
            )}
          </div>
        </div>

        {/* ---- dialogs ---- */}
        <Suspense fallback={null}>
          {dialog === 'presets' && <PresetBrowser open onOpenChange={() => ui().closeDialog()} />}
          {dialog === 'gallery' && <GalleryDialog open onOpenChange={() => ui().closeDialog()} />}
          {dialog === 'export' && <ExportDialog open onOpenChange={() => ui().closeDialog()} />}
          {dialog === 'settings' && <SettingsDialog open onOpenChange={() => ui().closeDialog()} />}
        </Suspense>
      </ErrorBoundary>
    </TooltipProvider>
  )
}