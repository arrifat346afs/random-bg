/**
 * history.ts — undo/redo stack policy for the project.
 *
 * Deliberately pure and framework-free. These are the parts of undo that are
 * easy to get subtly wrong — the coalescing window and the depth cap — so they
 * are separated from the store mechanics and tested directly.
 *
 * The history holds whole `Project` snapshots rather than inverse operations,
 * which is what makes "undo anything, including randomise" work for free.
 */

import type { Project } from '../lib/schema'
import { cloneProject } from '../lib/project'

/** Depth of the undo stack. Oldest entries fall off the bottom. */
export const HISTORY_LIMIT = 80

/**
 * How long consecutive commits sharing a coalesce key merge into one entry.
 *
 * This is what makes a drag, or a run of arrow-key nudges, a single undo
 * rather than one entry per frame or per keystroke.
 */
export const COALESCE_MS = 900

/** Opaque marker for "this commit records no history". */
export const SILENT = true as const

export interface CommitPolicy {
  /**
   * Merge with the previous entry instead of pushing a new one. Same string for
   * a whole gesture (e.g. `nudge:<layerId>`); omit for a standalone commit.
   */
  coalesce?: string
  /** Record no history at all — used when loading a project. */
  silent?: boolean
}

export interface HistoryCursor {
  key: string | null
  at: number
}

/** May this commit merge into the previous one? */
export function shouldCoalesce(
  prev: HistoryCursor,
  key: string | undefined,
  now: number,
  pastIsEmpty: boolean,
): boolean {
  if (!key) return false
  if (pastIsEmpty) return false // nothing to merge *into*
  if (prev.key !== key) return false
  return now - prev.at < COALESCE_MS
}

/**
 * Push a snapshot, trimming the oldest entries past `HISTORY_LIMIT`.
 *
 * The snapshot is cloned so later in-place mutation of the live project cannot
 * reach into the history.
 */
export function pushPast(past: Project[], snapshot: Project): Project[] {
  const next = [...past, cloneProject(snapshot)]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}

/** The cursor to store after a commit, given whether history was recorded. */
export function nextCursor(
  prev: HistoryCursor,
  policy: CommitPolicy,
  merged: boolean,
  now: number,
): HistoryCursor {
  // A merged commit keeps the original timestamp, so a long drag stays one
  // entry for its whole duration instead of starting a new window per frame.
  if (merged) return prev
  return policy.coalesce ? { key: policy.coalesce, at: now } : { key: null, at: 0 }
}

/**
 * Project state for `past[past.length - 1]`, or null when there is nothing to
 * undo. Also returns the stack with that entry popped, ready to become `future`.
 */
export function undoTarget(
  past: Project[],
): { project: Project | null; past: Project[] } | null {
  if (past.length === 0) return null
  const project = past[past.length - 1]
  return { project, past: past.slice(0, -1) }
}

/**
 * Project state for the next redo, or null when there is nothing.
 *
 * The redo stack is front-loaded (newest at index 0), matching the store's
 * original `state.future[0]` + `slice(1)`. Taking the last element instead
 * silently reverses a multi-step redo, which is exactly what the direct unit
 * test here is guarding.
 */
export function redoTarget(
  future: Project[],
): { project: Project | null; future: Project[] } | null {
  if (future.length === 0) return null
  const project = future[0]
  return { project, future: future.slice(1) }
}