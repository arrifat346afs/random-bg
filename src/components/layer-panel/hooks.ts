/**
 * layer-panel/hooks.ts — the panel's subscriptions.
 *
 * Kept apart from `model.ts` so the projection stays pure and testable without
 * a store (or the `@/` alias) in scope.
 */

import { useShallow } from 'zustand/react/shallow'
import type { LayerGroup } from '@/lib/schema'
import { useProjectStore } from '@/store/projectStore'
import { summarise, type LayerSummary } from './model'

/**
 * The panel's slice of the project.
 *
 * `useShallow` compares element-wise, so a param edit — which changes nothing a
 * row displays — resolves to the same array and the panel does not re-render.
 */
export function useLayerSummaries(): LayerSummary[] {
  return useProjectStore(useShallow((s) => s.project.layers.map(summarise)))
}

export function useLayerGroups(): LayerGroup[] {
  return useProjectStore(useShallow((s) => s.project.groups))
}