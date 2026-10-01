/**
 * keyboard.ts — shared keyboard helpers.
 *
 * Kept out of any component file so both `App` (global shortcuts) and
 * `Preview` (space-to-pan) can use them without creating circular imports or
 * breaking fast-refresh.
 */

/** True when the keystroke should be left alone (user is typing in a field). */
export function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    t.isContentEditable === true
  )
}

/**
 * Space-to-pan lives at module scope so the keydown listener in `Preview` and
 * the cursor style agree on a single source of truth.
 */
let spaceHeld = false

export function isSpaceHeld(): boolean {
  return spaceHeld
}

export function setSpaceHeld(v: boolean): void {
  spaceHeld = v
}
