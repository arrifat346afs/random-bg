/**
 * Test harness for the state layer.
 *
 * The store is a module singleton and touches `localStorage`, which bun has no
 * DOM for. This installs a minimal in-memory shim and exposes a reset so each
 * test starts from a known state — without a reset, module-level state leaks
 * between cases and the suite order becomes load-bearing.
 *
 * Imported for its side effects from every test file, before the store.
 */

const mem = new Map<string, string>()

// Bun types are only present for the test runner, so this file's shape is
// hand-written rather than declared as `Storage` — the real DOM lib would
// reject the `as unknown as Storage` cast this needs anyway.
const shim = {
  getItem: (k: string): string | null => (mem.has(k) ? (mem.get(k) as string) : null),
  setItem: (k: string, v: string): void => void mem.set(k, String(v)),
  removeItem: (k: string): void => void mem.delete(k),
  clear: (): void => mem.clear(),
  key: (i: number): string | null => [...mem.keys()][i] ?? null,
  get length(): number {
    return mem.size
  },
}

;(globalThis as unknown as { localStorage: unknown }).localStorage = shim

/** Seed a saved value as if a previous session had written it. */
export function seedStorage(key: string, value: unknown): void {
  mem.set(key, JSON.stringify(value))
}

/** Raw read, for asserting exactly what got persisted. */
export function readStorage(key: string): string | null {
  return mem.has(key) ? (mem.get(key) as string) : null
}

export function clearStorage(): void {
  mem.clear()
}