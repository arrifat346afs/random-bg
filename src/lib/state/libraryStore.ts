/**
 * libraryStore.ts — user-saved presets.
 *
 * The user's own saved projects, kept out of `projectStore` because they are a
 * collection *of* projects rather than part of the open one. Saving snapshots
 * whatever is currently open, which is the one place this store reads another.
 */

import { create } from 'zustand'
import { cloneProject } from '../project'
import type { Project } from '../schema'
import { KEYS, loadJSON, saveJSON } from './persistence'
import { useProjectStore } from './projectStore'
import { useUiStore } from './uiStore'

export interface UserPreset {
  id: string
  name: string
  tags: string[]
  createdAt: number
  project: Project
}

/** Presets are a convenience, not a document; cap so storage cannot grow forever. */
const MAX_PRESETS = 200

export interface LibraryStore {
  userPresets: UserPreset[]
  saveUserPreset: (name: string, tags: string[]) => boolean
  deleteUserPreset: (id: string) => void
  importUserPresets: (json: string) => { ok: boolean; count: number; error?: string }
}

export const useLibraryStore = create<LibraryStore>()((set, get) => ({
  userPresets: loadJSON<UserPreset[]>(KEYS.presets) ?? [],

  saveUserPreset: (name, tags) => {
    const preset: UserPreset = {
      id: `u${Date.now().toString(36)}`,
      name,
      tags,
      createdAt: Date.now(),
      // snapshot, not a reference: the open project keeps moving afterwards
      project: cloneProject(useProjectStore.getState().project),
    }
    const list = [preset, ...get().userPresets].slice(0, MAX_PRESETS)
    const ok = saveJSON(KEYS.presets, list)
    set({ userPresets: list })
    useUiStore.getState().reportStorage(ok)
    return ok
  },

  deleteUserPreset: (id) => {
    const list = get().userPresets.filter((p) => p.id !== id)
    set({ userPresets: list })
    saveJSON(KEYS.presets, list)
  },

  importUserPresets: (json) => {
    try {
      const parsed = JSON.parse(json)
      const items: UserPreset[] = Array.isArray(parsed) ? parsed : [parsed]
      // drop anything that is not a v1 project, rather than failing the import
      const clean = items.filter((p) => p && p.project && p.project.v === 1)
      if (!clean.length) return { ok: false, count: 0, error: 'No valid presets found in that file.' }
      const now = Date.now().toString(36)
      const list = [
        ...clean.map((p, i) => ({ ...p, id: p.id || `i${now}${i}` })),
        ...get().userPresets,
      ].slice(0, MAX_PRESETS)
      set({ userPresets: list })
      saveJSON(KEYS.presets, list)
      return { ok: true, count: clean.length }
    } catch (err) {
      return { ok: false, count: 0, error: err instanceof Error ? err.message : 'Invalid JSON' }
    }
  },
}))