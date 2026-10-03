# Adding a generator

Generators are the only thing you need to touch to add a new effect family.
Everything else — inspector UI, randomiser, presets, SVG + canvas export —
is built from the registry, so a new generator shows up everywhere with no UI
code changes.

## The two steps

1. Create `src/lib/generators/myGen/` with one responsibility per file
   (`index.ts`, `params.ts`, `generate.ts`, plus helpers as needed — see
   `neon-ribbons/` for a curve-based example, `gradient-shapes/` for a
   layout-based one, `tile-mosaic/` for a grid-based one). `index.ts` only
   exports the `GeneratorDef` and registers nothing itself.
2. Import it in `src/lib/generators/index.ts` and add it to `GENERATORS`.

## What a generator declares

```ts
export const myGen: GeneratorDef = {
  id: 'mygen',                 // unique, stable — stored in project JSON
  name: 'My effect',
  icon: 'waves',               // lucide icon name used by the layer list
  family: 'particles' | 'light' | 'atmosphere' | 'geometry' | 'texture',
  tags: ['glow', 'dots'],      // searched by the preset browser
  description: 'One line for tooltips.',
  params: [ /* ParamDef[] — the inspector is auto-built from these */ ],
  defaults: () => ({ count: 320, size: 8, /* … */ }),
  density: (p) => num(p, 'count', 320) * 1.4, // expected primitives
  generate(p, ctx) { /* …return done(ctx.w, ctx.h, nodes) */ },
}
```

**Params** (`ParamDef`) carry `key`, `label`, `type` (`int`/`float`/`enum`/`bool`/
`color`/`gradient`), `min`/`max`, `default`, `section` (`shape`/`color`/`motion`),
an optional `rand: { min, max }` range for the randomiser, and optional `when`
clauses that show/hide a param based on another (see `rays.ts` `ghosts`).

**kit.ts helpers** keep generators short — use them instead of hand-rolling:

- `num` / `int` / `str` / `bool` — read a param with a fallback.
- `countParam(def, max, randMax)` — the shared count field (floor 16, see below).
- `sizeParam(def, …)` — the shared size field.
- `emitCount(p, dflt)` — read `count` with the particle floor applied.
- `colorOf(ctx, sample, size01)` — the layer's colour mapping (palette /
  position / size / random), already resolved for one sample.
- `sampleDistribution(ctx, count)` (in `dist.ts`) — the layer's point
  distribution; every sample carries `x, y, t, mask` for colour + masking.
- `emitDot` / `emitStroke` — emit the common glow-dot / ribbon primitives.
- `done(w, h, nodes)` — wrap nodes into an IR.

## Rules your `generate()` must follow

1. **Deterministic.** Use only `ctx.rng` (and `createNoise(hashOf(ctx.seed))`
   for fields). Never `Math.random()`, `Date.now()`, or module-level mutable
   state — the same seed must produce the same pixels, and `scripts/check.ts`
   verifies it.
2. **Emit IR nodes, never pixels.** Your output is rendered to *both* canvas
   and SVG from the same data, so express everything with IR geometry
   (`circle`, `path`, fills, gradients, blurs). Anything canvas-only will
   silently vanish from SVG export.
3. **Respect the primitive cap.** `pipeline.ts` truncates at 40 000 nodes per
   layer; keep `density()` honest so progress bars and the gallery stay sane.
4. **Read `count` through `emitCount`.** Particle-style generators (fields of
   many dots/lines/puffs) call `emitCount(p, dflt)`, which floors at
   `MIN_EMIT = 16` — a layer that rolls 1–3 primitives reads as broken. If your
   generator's whole point can be *one* object (a lens flare, a hero ray, a
   single trail), pass `1` explicitly — `emitCount(p, dflt, 1)` — and add
   nothing to `MIN_EMIT_GENS`.

## The `MIN_EMIT_GENS` decision

`src/lib/generators/index.ts` exports `MIN_EMIT_GENS`, the set of generator
ids that get the 16-primitive floor. When you register a generator, decide
which side of the line it falls on:

- **In the set** (`particles`, `bokeh`, `flow`, `emitters`, `scatter`,
  `smoke`): it emits a *field*, and a low-teens count is always a bug.
- **Out of the set** (`rays`, `streaks`, `geometric`, `grain`, `ribbons`,
  `gradShapes`, `mosaic`): a single primitive is a legitimate, often
  intended, result. `mosaic` is driven by `cols`/`rows` rather than `count`,
  so the floor never applies to it in practice.

The floor is enforced at render time by `emitCount`, so it also covers old
project JSON; the set itself tells the randomiser how far it may thin a
layer's density (`minCountFor()`).

## Shared helpers for new generators

- `generators/density.ts` — `alphaForLoad(base, load)`: density-aware alpha
  so additive stacks (ribbons, dense packs) do not clip to white. Estimate
  the overlap with `ribbonLoad()` or `count × (0.4 + overlap)` and guard the
  per-node opacity with it.
- `generators/shade.ts` — `lightenHex` / `darkenHex` / `shadeLadder`: the one
  shared copy. Older generators (`scatter`, `geometric`) carry private copies
  for historical reasons; new code uses this module.
- `modifiers.ts#mirror` — cartesian mirror / four-way symmetry as a shared
  post-processor (`amount` = axis angle, `secondary` = 1 or 2 planes).
  `kaleido` (radial) and `colorByPos` already existed; `mirror` is the
  cartesian counterpart. Generators with their own symmetry param (mosaic)
  fold the colour source instead of duplicating nodes.

## Checklist before you call it done

- `bunx tsc -p tsconfig.app.json --noEmit`, `bun run lint`, `bun run build`
- `bun run scripts/check.ts` — renders all generators and presets, including
  the new-generator gates (determinism, non-empty, count limits, parameter
  extremes), the filter gates and the pinned preset-id list
- Add a preset or two exercising it in its own `presets.ts` (tagged), wired
  into `src/lib/presets.ts` — the check pins every preset id, so a dropped
  preset fails the build
- Re-render all presets and confirm only yours changed
  (`scripts/_preset-sig.txt` is the snapshot pattern: signature every preset
  before/after via `scripts/cdp-eval.ts` and diff)
