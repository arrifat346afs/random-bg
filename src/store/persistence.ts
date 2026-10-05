/**
 * persistence.ts — localStorage access for the app's saved state.
 *
 * Every read/write is wrapped because a locked-down browser (private mode, a
 * blocked third-party context, a full quota) can throw on `localStorage`. The
 * app has to keep working with autosave simply off, which is what
 * `storageAvailable` in the store reports.
 */

/** Every `localStorage` entry this app owns, namespaced and versioned. */
export const KEYS = {
  project: 'fx-forge:project:v1',
  presets: 'fx-forge:presets:v1',
  theme: 'fx-forge:theme',
  view: 'fx-forge:view',
} as const

export function loadJSON<T>(key: string): T | null {
  const raw = loadRaw(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Raw read — null when missing *or* unreadable, never throws. */
export function loadRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Best-effort backup of an unreadable blob so a fallback never destroys work. */
export function backupRaw(key: string, raw: string): void {
  try {
    localStorage.setItem(`${key}:corrupt:${Date.now().toString(36)}`, raw)
  } catch {
    /* quota/blocked — nothing more we can do */
  }
}

/** Returns whether the write landed, so the caller can surface "autosave off". */
export function saveJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/** The theme key stores a bare string, not JSON — quoted so it is a safe write. */
export function saveThemeKey(value: string): boolean {
  try {
    localStorage.setItem(KEYS.theme, value)
    return true
  } catch {
    return false
  }
}