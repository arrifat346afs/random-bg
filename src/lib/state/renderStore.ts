/**
 * renderStore.ts — the generation loop's output.
 *
 * Holds the rendered IR for one project version plus the progress/error the
 * preview and status bar display. Split from the document because it is written
 * at a completely different cadence: the render service pushes a new result on
 * every debounced generation, and none of that is part of the saved document.
 *
 * Keeping it separate also stops a completed render from waking every UI
 * subscriber, which is what happened when this lived in the one global store.
 */

import { create } from 'zustand'
import type { LayerResult } from '../pipeline'

export interface Progress {
  done: number
  total: number
  label: string
}

export interface RenderStore {
  /** Latest generated layer IRs; null until the first render lands. */
  results: LayerResult[] | null
  /** Bumped whenever `results` changes — Preview draws on this. */
  resultsVersion: number
  primitiveCount: number
  truncated: boolean
  renderMs: number
  generating: boolean
  progress: Progress | null
  error: string | null
}

export const useRenderStore = create<RenderStore>()(() => ({
  results: null,
  resultsVersion: 0,
  primitiveCount: 0,
  truncated: false,
  renderMs: 0,
  // true until the first render settles, so the preview shows a progress bar
  // rather than an empty stage on first paint
  generating: true,
  progress: null,
  error: null,
}))

/** Reset the render surface before a new generation begins. */
export function beginRender(): void {
  useRenderStore.setState({ generating: true, error: null })
}

/** Land a completed render. */
export function finishRender(out: {
  results: LayerResult[]
  count: number
  truncated: boolean
  ms: number
}): void {
  useRenderStore.setState((s) => ({
    results: out.results,
    resultsVersion: s.resultsVersion + 1,
    primitiveCount: out.count,
    truncated: out.truncated,
    renderMs: out.ms,
    generating: false,
    progress: null,
  }))
}

/** Land a failed render. */
export function failRender(message: string): void {
  useRenderStore.setState({ generating: false, progress: null, error: message })
}