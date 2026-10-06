/**
 * feedbackStore — human taste feedback state (thumbs up / down on Randomise).
 *
 * Entries persist to localStorage (cap 500, try/catch in `lib/feedback.ts`).
 * Every rate recomputes bandit multipliers and pushes them into the
 * randomiser via `setLearnedGenMult`, so taste shifts take effect on the next
 * roll. Multipliers stay clamped to [0.3, 3] with age decay — see the lib.
 */

import { create } from 'zustand'
import {
  clearEntries,
  exportFeedback,
  generatorMultipliers,
  importFeedback,
  loadEntries,
  saveEntries,
  type FeedbackEntry,
  type FeedbackVerdict,
} from '../lib/feedback'
import { setLearnedGenMult } from '../lib/randomize'
import { lastChecked } from './randomise'
import { useProjectStore } from './projectStore'

interface FeedbackStore {
  entries: FeedbackEntry[]
  /** per-generator bandit multipliers derived from entries */
  mult: Record<string, number>
  /** rating (if any) for the project currently on stage */
  verdictForSeed: (seed: number) => FeedbackVerdict | null
  rateCurrent: (verdict: FeedbackVerdict) => void
  resetLearning: () => void
  exportJSON: () => string
  importJSON: (text: string) => number
}

function refreshMult(entries: FeedbackEntry[]): Record<string, number> {
  const mult = generatorMultipliers(entries)
  setLearnedGenMult(mult)
  return mult
}

function entryForCurrent(verdict: FeedbackVerdict): FeedbackEntry {
  const project = useProjectStore.getState().project
  const checked = lastChecked && lastChecked.project.seed === project.seed ? lastChecked : null
  const genIds = project.layers.map((l) => l.gen)
  return {
    seed: project.seed,
    recipeId: null, // recipes land in step 2; the field is reserved
    genIds,
    fams: [],
    palette: project.palette.colors.slice(),
    bgKind: project.canvas.bg.kind,
    metrics: checked
      ? {
          coverage: checked.metrics.coverage,
          meanLuma: checked.metrics.meanLuma,
          edge: checked.metrics.edge,
          hueCount: checked.metrics.hueCount,
          focal: checked.metrics.focal,
          whiteComposite: checked.metrics.whiteComposite,
        }
      : null,
    verdict,
    at: Date.now(),
  }
}

export const useFeedbackStore = create<FeedbackStore>()((set, get) => {
  const initial = loadEntries()
  setLearnedGenMult(generatorMultipliers(initial))
  return {
    entries: initial,
    mult: generatorMultipliers(initial),

    verdictForSeed: (seed) => {
      const hit = get().entries.find((e) => e.seed === seed)
      return hit ? hit.verdict : null
    },

    rateCurrent: (verdict) => {
      const entry = entryForCurrent(verdict)
      // one rating per seed: re-rating replaces the old verdict
      const rest = get().entries.filter((e) => e.seed !== entry.seed)
      const entries = [...rest, entry]
      saveEntries(entries)
      set({ entries, mult: refreshMult(entries) })
    },

    resetLearning: () => {
      clearEntries()
      setLearnedGenMult({})
      set({ entries: [], mult: {} })
    },

    exportJSON: () => exportFeedback(get().entries),

    importJSON: (text) => {
      const incoming = importFeedback(text)
      if (!incoming.length) return 0
      const bySeed = new Map(get().entries.map((e) => [e.seed, e] as const))
      for (const e of incoming) bySeed.set(e.seed, e)
      const entries = [...bySeed.values()]
      saveEntries(entries)
      set({ entries, mult: refreshMult(entries) })
      return incoming.length
    },
  }
})
