/**
 * state/randomise.ts — The UI-facing "Randomise" action.
 *
 * Wires the quality gate (`lib/quality.ts`) to the store so the top bar, the
 * `R` shortcut and the preview's empty state all share one code path — and one
 * loading state.
 *
 * The gate is a *refinement*, never a dependency: if it throws (worker
 * timeout, a canvas it cannot read) we fall back to a single un-gated roll, so
 * pressing Randomise always produces a project.
 */

import { randomProject } from '../randomize'
import { randomProjectChecked, type CheckedRandom, type RandomOpts } from '../quality'
import { applyProject, setState } from './store'

/** True while a gated randomise is in flight — used to disable the button. */
let busy = false
export const isRandomising = (): boolean => busy

/**
 * Roll a random project under the quality gate and install it.
 *
 * Drives the store's existing `generating`/`progress` flags, so the preview's
 * progress bar and the top bar's "generating…" pill appear for the duration —
 * typically one roll (≈100 ms), never more than the gate's 750 ms budget.
 */
export async function randomise(opts: RandomOpts = {}): Promise<CheckedRandom | null> {
  if (busy) return null
  busy = true
  const max = opts.attempts ?? 8
  setState({ generating: true, error: null, progress: { done: 0, total: max, label: 'randomising' } })
  try {
    let checked: CheckedRandom | null = null
    try {
      checked = await randomProjectChecked(undefined, opts, (done, total) =>
        setState({ progress: { done, total, label: 'randomising' } }),
      )
    } catch {
      checked = null // fall through to the ungated roll below
    }

    const project = checked ? checked.project : randomProject()
    applyProject(project)
    return checked
  } finally {
    busy = false
    // `applyProject` bumps `version`, and `useRenderer` re-raises `generating`
    // on the next effect pass — so this clears the gate's flags without ever
    // leaving the app stuck in a loading state.
    setState({ generating: false, progress: null })
  }
}
