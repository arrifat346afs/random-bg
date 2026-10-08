/**
 * randomise — the UI-facing "Randomise" action.
 *
 * Wires the quality gate (`lib/quality.ts`) to the stores so the top bar, the `R`
 * shortcut and the preview's empty state all share one code path — and one
 * loading state.
 *
 * The gate is a *refinement*, never a dependency: if it throws (worker timeout, a
 * canvas it cannot read) we fall back to a single un-gated roll, so pressing
 * Randomise always produces a project.
 *
 * The aspect lock is read here and handed to the roll, because only this module
 * knows both the lock and the canvas it should apply to.
 */

import { randomProject } from '../lib/randomize'
import { randomProjectChecked, type CheckedRandom, type RandomOpts } from '../lib/quality'
import { useProjectStore } from './projectStore'
import { useRenderStore } from './renderStore'
import { useUiStore } from './uiStore'

/** True while a gated randomise is in flight — used to disable the button. */
let busy = false
export const isRandomising = (): boolean => busy

/**
 * The most recent gated roll (null when the fallback path was taken). The
 * feedback loop reads the seed, generator mix and gate metrics from here so
 * a rating costs zero extra renders.
 */
export let lastChecked: CheckedRandom | null = null

/**
 * Roll a random project under the quality gate and install it.
 *
 * Drives the render store's `generating`/`progress` flags, so the preview's
 * progress bar and the top bar's "generating…" pill appear for the duration —
 * typically one roll (≈100 ms), never more than the gate's 750 ms budget.
 */
export async function randomise(opts: RandomOpts = {}): Promise<CheckedRandom | null> {
  if (busy) return null
  busy = true
  // Snapshot the canvas *before* the first await: installing the result replaces
  // it, and the aspect lock has to describe the project the user is looking at,
  // not the one this roll produced.
  const { project: current } = useProjectStore.getState()
  const roll: RandomOpts = {
    ...opts,
    pool: opts.pool ?? useUiStore.getState().randomPool,
    canvas: useUiStore.getState().view.lockAspect
      ? { w: current.canvas.w, h: current.canvas.h }
      : undefined,
  }
  const max = roll.attempts ?? 8
  useRenderStore.setState({
    generating: true,
    error: null,
    progress: { done: 0, total: max, label: 'randomising' },
  })
  try {
    let checked: CheckedRandom | null = null
    try {
      checked = await randomProjectChecked(undefined, roll, (done, total) =>
        useRenderStore.setState({ progress: { done, total, label: 'randomising' } }),
      )
    } catch {
      checked = null // fall through to the ungated roll below
    }

    // The ungated fallback has to honour the lock as well — it is the path
    // taken exactly when the gate fails, so ignoring it would reshape the canvas
    // on the rolls the user is most likely to notice.
    const next = checked ? checked.project : randomProject(undefined, roll)
    lastChecked = checked
    useProjectStore.getState().applyProject(next)
    return checked
  } finally {
    busy = false
    // `applyProject` bumps `version`, and `useRenderer` re-raises `generating`
    // on the next effect pass — so this clears the gate's flags without ever
    // leaving the app stuck in a loading state.
    useRenderStore.setState({ generating: false, progress: null })
  }
}