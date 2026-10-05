/**
 * migrate.ts — bring a loaded document up to the current schema.
 *
 * Pure and idempotent: running it twice changes nothing the second time. Every
 * saved project goes through `migrateProject` on load and on import, so a file
 * written by any earlier version opens without a special case at each use site.
 *
 * Migrations so far:
 *   - `layer.offset` → `layer.transform` (scale and rotation were added later)
 *
 * Kept out of `project.ts` so that file does not grow, and out of the stores so
 * both the app and the tests can normalise a project the same way.
 */

import type { Layer, Project } from './schema'
import { layerTransformOf } from './schema'
import { IDENTITY_TRANSFORM, transformFromOffset } from './transform'

/**
 * Fold a legacy `offset` into `transform`.
 *
 * A layer with no `offset` is returned untouched: `layerTransformOf` already
 * treats a missing `transform` as identity, so there is nothing to normalise and
 * leaving the object alone keeps this cheap for the common case.
 *
 * A layer that *does* have an offset has it consumed and dropped, so the two
 * fields can never both be set and disagree.
 */
export function migrateLayer(l: Layer): Layer {
  if (!l.offset) return l
  const { offset, ...rest } = l
  const transform = l.transform ?? transformFromOffset(offset)
  return { ...rest, transform }
}

/** Every layer in the project, migrated. */
export function migrateLayers(p: Project): Project {
  let changed = false
  const layers = p.layers.map((l) => {
    const next = migrateLayer(l)
    if (next !== l) changed = true
    return next
  })
  return changed ? { ...p, layers } : p
}

/**
 * Read a layer's placement, whatever shape the project on disk had. This is the
 * only place the legacy `offset` field is honoured.
 */
export function readTransform(l: Layer) {
  return layerTransformOf(l)
}

/** True when a layer carries no placement at all. */
export function isUnplaced(l: Layer): boolean {
  const t = layerTransformOf(l)
  return (
    t.x === IDENTITY_TRANSFORM.x &&
    t.y === IDENTITY_TRANSFORM.y &&
    t.scaleX === IDENTITY_TRANSFORM.scaleX &&
    t.scaleY === IDENTITY_TRANSFORM.scaleY &&
    t.rotation === IDENTITY_TRANSFORM.rotation
  )
}