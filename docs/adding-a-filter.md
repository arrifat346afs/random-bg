# Adding a filter

Filters are **data**, not code in components. A layer holds a `FilterInstance[]`
and the registry holds the definitions; both backends compile from that same
array, so the preview and the exported file cannot drift apart.

Adding one is two steps, the same shape as adding a generator:

1. Create `src/lib/filters/<group>/<name>.ts` exporting a `FilterDef`
   (`blur/gaussian.ts` is the minimal example).
2. Import it in `src/lib/filters/index.ts` and add it to `FILTERS`.

That's it. The inspector, the randomiser, both compilers and the exporter all
read the registry, so a new filter appears everywhere with no UI changes.

## What a filter declares

```ts
export const myDef: FilterDef = {
  type: 'my-filter',            // unique, stable — stored in project JSON
  label: 'My filter',           // shown in the Add menu and the stack list
  group: 'color',               // blur | glow | color | distort | texture
                                // | shape | relief | raster
  description: 'One line for tooltips.',
  isVectorSafe: true,           // false → the layer rasterises to <image>
  rasterOnly: false,            // true → "raster" badge in the Add menu
  cost: 2,                      // 1 (cheap) → 10 (heavy); drives the budget UI
  params: [ /* ParamDef[] — the inspector is auto-built from these */ ],

  spread: (p) => 0,             // optional: how far pixels can move outward
  toSvg(params, ctx) { /* … */ },   // string | null (null = identity)
  apply(src, w, h, params, seed) {  // Uint8ClampedArray → Uint8ClampedArray
    return src.slice()
  },
}
```

`apply` is a pure RGBA transform with **no DOM** — that is what lets the same
code run in the browser, in Node and in `scripts/check.ts`. `toSvg` gets a
`FilterSvgCtx` (`{ filterId, input, output, width, height }`) and must read
`ctx.input` and write `ctx.output`, so several filters can chain.

## The one rule that is not negotiable

**`toSvg` and `apply` must implement the same function.**

A layer's stack compiles to a single `<filter>` on the SVG side and to the
equivalent sequence of pixel passes on the canvas side. `scripts/filters-parity.ts`
rasterises both with librsvg and compares them per-pixel; a filter whose two
implementations disagree by more than a couple of levels fails the build.

It has already caught a list worth reading before you write yours:

| Symptom | Cause |
| --- | --- |
| The SVG export is greyscale | `feColorMatrix` whose three colour rows are **identical** — Chrome and librsvg apply the row to `(R,0,0,0,A)`. Use `feComponentTransfer type="linear"` for per-channel affine maps. |
| The filter does nothing | `type="table"` maps input 0 → `tableValues[0]`, so an invert is `"1 0"`, not `"0 1"`. |
| One channel comes out flat | A "luma into R" matrix leaves G and B at 0, and `feFuncG`/`feFuncB` then read black. Desaturate with `type="saturate" values="0"` first. |
| The whole silhouette turns solid | `flood ∩ dilated` is the *grown shape*, not a ring. Subtract with `operator="out"`. |
| The artwork is replaced, not filtered | An arithmetic composite with only `k2` computes `k2·in1` — the source never enters. Use `k2` and `k3`. |
| Transparent exports get a halo | `feTurbulence` has alpha 1 everywhere. Mask it with `operator="in"` against the source first. |

Two habits that avoid most of that table:

- **Prefer `feComponentTransfer` over `feColorMatrix`** for per-channel maths.
  It is exact, it is well supported, and it cannot degenerate into the
  identical-rows form.
- **Never emit `feMerge`.** It is spec-valid for two inputs but librsvg drops
  it entirely — every glow and outline filter exported as *nothing*. Use
  `feComposite operator="over"`, which is equivalent and universally supported.

## Other things the gates check

- **`apply` must be deterministic** and must not mutate its input. Seeded noise
  uses the `seed` argument (`filterSeed(seed, filterId)`), never `Math.random()`.
- **Default params must be harmless** — the gate applies the whole catalogue at
  defaults and fails if the mean alpha drops by more than 8/255. A colour
  filter's identity must also be neutral.
- **`toSvg` must be deterministic and self-contained**: balanced markup, only
  real SVG 1.1 primitives, no `rgba()`/`hsl()` colours, no `mix-blend-mode`,
  no `NaN`.
- **Every numeric default must sit inside the param's `rand` range.** The
  randomiser clamps into that range on an evolve walk, so a default outside it
  makes the layer visibly jump the first time someone presses Evolve.
- **Declare `spread`** if the filter can push pixels away from where they were
  (blurs, shadows, glows, displacements). The canvas backend uses it to size the
  offscreen surface it filters on: too small clips the shadow, too big burns
  pixels on empty margin. Colour filters omit it.

## Raster-only filters

Some things have no SVG primitive — motion/radial/zoom blur, pixelate,
chromatic aberration. Set `isVectorSafe: false` and `rasterOnly: true`, and
return `null` from `toSvg`.

`projectToSvg` then draws that layer through the canvas pipeline, embeds it as a
PNG `<image>` and adds a one-line warning. Everything else in the file stays
vector. See `docs/limitations.md` for what that costs.

## Checklist before you call it done

- `npx tsc -b --noEmit`, `npx eslint .`
- `npx tsx scripts/check.ts` — registry integrity, per-filter determinism,
  default-params-no-harm, SVG validity, byte-identical filter-free output
- `bun run scripts/filters-parity.ts` — canvas vs librsvg, per-pixel
- `bun run scripts/filters-e2e.ts` — preview vs SVG export in Chrome
- `bun run scripts/quality20.ts` — the randomiser still passes its gate