/**
 * stageIR.ts — the preview's composed IR, as a pure helper.
 *
 * `composeIR(project, results)` reads layer placements from `project` but the
 * preview used to memo it on `results` alone. A committed transform
 * deliberately never regenerates layers, so `results` is unchanged after a
 * gesture commits and the memo went stale: the box (from `project`) moved
 * while the pixels (from the stale IR) stayed.
 *
 * Pure: no hooks, no DOM, no store. `Preview.tsx` memos on `[results, layers,
 * canvasW, canvasH]` so any committed placement / visibility / filter /
 * canvas edit recomposes, while a running gesture (which only writes
 * `liveTransform`, never `project.layers`) recomposes nothing per frame.
 */

import type { IR } from './ir'
import { composeIR, type LayerResult } from './pipeline'
import type { Project } from './schema'

/** Compose the stage IR, or null when there is nothing to draw yet. */
export function composeStageIR(
  project: Project,
  results: LayerResult[] | null,
): IR | null {
  if (!results) return null
  return composeIR(project, results)
}
