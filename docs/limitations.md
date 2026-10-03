# Limitations — what FX Forge does not do, and why

An honest list. Nothing here is a crash or a data-loss bug; each entry is a
deliberate tradeoff or a known boundary of the procedural approach.

## Render fidelity

- **`ctx.filter` blur cost follows clip area, not shape size.** A wide soft glow
  is the most expensive thing the canvas backend does. Cost is bounded by
  `FILTER_PX_BUDGET` (600 M filtered pixels) and `MAX_FILTERED_OPS` (3 500 ops);
  past the budget, later blurs fall back to cheaper approximations. Wide blurs
  additionally render through a downscaled scratch (`drawBlurredWide`, ½ res,
  ¼ once σ ≥ 6 device px) — slightly softer than exact, ~130× cheaper.
- **Blur radius is quantised in canvas, exact in SVG.** Canvas buckets σ into
  adaptive steps for cache-friendliness; SVG uses the true `stdDeviation`.
  Pixel diffs between the two backends concentrate here (measured mean abs
  diff 0.93/255 across presets).
- **Blend-mode caveats in SVG.** `plus-lighter` is CSS-native but browser-only.
  It is exported as `mix-blend-mode="screen"` plus a `<style>` rule that
  upgrades browsers back to `plus-lighter`; renderers that ignore the
  stylesheet keep `screen` instead of dropping the blend. `screen`/`overlay`
  also differ subtly from canvas compositing.
- **Sharpness is raster-clamped at extreme zoom.** The preview renders vector
  IR, but zooming past the rasterised resolution magnifies pixels like any
  bitmap preview. Exports re-render at full resolution.
- **Irreducible-overdraw presets exist.** A handful of presets (`aurora-veil`,
  `sunset-light-trails`) are simply dense by design and will always be the
  slowest renders — that is their look, not a bug.

## SVG renderer portability

Exported SVG targets Inkscape, resvg, librsvg and browsers. Measured, not
assumed — `scripts/check.ts` fails the build if a renderer-hostile construct
reappears in generated output, and `scripts/filters-parity.ts` renders every
filter through librsvg and diffs it against our own canvas pipeline.

| Construct | Browser | Inkscape | librsvg |
| --- | --- | --- | --- |
| `stop-color` + `stop-opacity` | yes | yes | yes |
| `stop-color="rgba(...)"` | yes | **no — renders black** | yes |
| `mix-blend-mode="screen"` | yes | yes | yes |
| `mix-blend-mode="plus-lighter"` | yes | **no — blend dropped** | **no — blend dropped** |
| `<feGaussianBlur>` + `color-interpolation-filters="sRGB"` | yes | yes | yes |
| Presentation attributes over `style=""` | yes | yes | yes |
| `<feColorMatrix>` with **identical** colour rows | **no — applies the row to `(R,0,0,0,A)`** | — | **no — same** |
| `feColorMatrix type="saturate"` with `values > 1` | yes | — | **no — silently ignored** |
| `<feMerge>` (two inputs) | yes | yes | **no — output dropped entirely** |
| `<feTurbulence>` / arithmetic `feComposite` | yes | partial | **partial** |

Two rules the SVG backend follows because of this table:

- **Never `rgba()`/`hsl()` in a presentation attribute.** Alpha goes in a
  separate `stop-opacity`/`fill-opacity`. A `rgba()` gradient stop is not a
  cosmetic difference — Inkscape parses it as black, and since gradient fills
  are nearly every node in a glow preset, the whole export goes black.
- **Never `plus-lighter` in a presentation attribute.** The attribute carries
  `screen`; a `<style>` rule upgrades browsers, which outrank presentation
  attributes in the cascade. Renderers ignoring the stylesheet degrade to
  `screen` rather than losing the blend.

## Filters

The per-layer filter stack compiles to **one** `<filter>` with chained
primitives on the SVG side, and to the equivalent sequence of pixel passes on
the canvas side. Where they genuinely differ:

- **Noise and wave filters cannot match pixel-for-pixel.** `grain`, `roughen`
  and `turbulence` use `feTurbulence` in SVG and a seeded PRNG on canvas;
  `ripple` uses Perlin-style turbulence in SVG and a pure sine on canvas. Both
  sides are deterministic and both are zero-mean, but the noise *pattern* is
  genuinely different, and librsvg's `feTurbulence`/`feComposite` support is
  partial. `scripts/filters-parity.ts` asserts these structurally (the markup
  must keep the source and must mask the noise) plus statistically, rather than
  pretending to a parity it cannot deliver.
- **Morphology and glow differ by a level or two at antialiased edges.** SVG's
  `feMorphology` carries the colour of the pixel that won; a canvas port has to
  do that explicitly or it leaves a black halo. The gate's per-filter
  tolerances (3–8/255) cover the remaining sampling difference.
- **Raster-only filters are not vectors.** Motion blur, radial/zoom blur,
  pixelate and chromatic aberration have no SVG primitive, so SVG export draws
  that layer through the canvas pipeline and embeds it as a PNG `<image>`,
  with a one-line notice in the export dialog and a warning on the result. The
  rest of the file stays vector; the affected layer stops being editable in
  Illustrator/Inkscape, and its resolution is fixed at export time.
- **Filters are a post-process on a rasterised layer.** They run after the
  layer's primitives are generated, so they cannot change geometry — an erode
  moves the alpha silhouette but re-running generation would be needed to move
  the vector itself. This is also why editing a filter never re-runs generation.
- **Transparent exports rely on `color-interpolation-filters="sRGB"`.** Without
  it a colour filter grades the empty margin too and every shape gets a dark
  halo on a transparent background. It is set on every emitted `<filter>`, and
  `scripts/filters-parity.ts` fails if a colour filter paints more than 1% of
  the empty margin.
- **Heavier stacks degrade.** Above a summed cost weight of 14 the inspector
  shows a "heavy" badge, and above 22 the preview renders at reduced
  resolution. Both are heuristics, not guarantees.

## Randomiser and quality gate

- **The randomiser never invents a canvas ratio.** Sizes come from one curated
  list of coherent pairs (`RANDOM_CANVAS_SIZES`), not two independent pools —
  independent pools pair up arbitrarily and used to produce 1920×500 (3.84:1)
  and 1200×500 (2.40:1) on a few percent of rolls each. The pool is capped at
  1920 on the long edge: the gate renders every attempt inside a 750 ms budget
  and a 4K roll costs ~4× the pixels, which would blow the budget and silently
  degrade randomise to a single ungated roll. Use a size preset for 4K.
- **The aspect lock is on by default**, so Randomise keeps the current w×h
  unless you switch it on. The canvas-size dropdown beside Randomise in the top
  bar holds both the "Randomise aspect" switch and the size presets, so changing
  the aspect ratio is one click from the button that would otherwise change it
  for you. The bottom strip's `w×h` readout and Settings → Canvas are the other
  two routes. This matches `mutateProject` and `breed`, which inherit the canvas
  via `structuredClone` — Randomise was the only path that reshaped it. The lock
  applies to the ungated fallback roll too, not just the gated one.
- **White-out comes from inside the generators.** `emitters` and `streaks`
  composite their trails with node-level `screen` blending, so a dense roll
  saturates to white *within the layer*, regardless of the layer's own blend
  mode or opacity. No layer-level budget can predict this without rendering —
  it is exactly what the reject-and-resample gate (`src/lib/quality.ts`) is
  for. The three new generators carry their own guard as well
  (`generators/density.ts#alphaForLoad`): ribbons, gradient packs and mosaic
  grids dim per-node opacity as overlap grows, so a dense random roll keeps
  its shape instead of clipping. First-try pass rate on the fixed 20-seed set
  was 16/20 at the time the ribbons/gradient/mosaic families landed (final
  19/20, ~0.15 retries on average); the gate brings the final rate up with
  reject-and-resample. `bun run scripts/quality20.ts` is the arbiter — the
  numbers move whenever the generator or modifier pool changes, because every
  new family redraws all 20 seeds.
- **The gate measures, it does not understand.** Thresholds (coverage ≥ 3%,
  mean luma ≥ 3, pure white ≤ 30%, penalties for low contrast / low
  content-ground separation / < 16 primitives) are heuristics tuned against the
  20-seed set. A different seed batch can dip below them; `bun run
  scripts/quality20.ts` is the arbiter.
- **Vignette layers look like edge darkening on transparent export.** Dark
  low-alpha pixels hugging the border (e.g. `gold-dust`) are the vignette
  *content*, not a premultiply halo — colour-only presets show ~0.5% fringe
  with healthy hue.
- **A single flare is a valid project.** Flare/hero-ray/single-streak layers
  are exempt from the 16-primitive floor, so a one-object project can pass the
  gate if it covers enough canvas. Sparse is a penalty, not a rejection. The
  same exemption covers `ribbons` (one bundle), `gradShapes` (one shape) and
  `mosaic` (a grid driven by `cols`/`rows`, not `count`).

## New families and their visual boundaries

- **Neon ribbons** are vector light trails, not photographs of neon: the glow
  is a tapered gradient outline plus a `plus-lighter` core, blurred sparkles
  included. SVG fallback is the documented one — `plus-lighter` degrades to
  `screen` outside browsers, `feGaussianBlur` on the sparkles. A dense roll is
  deliberately dimmed (`alphaForLoad`) rather than allowed to clip.
- **Gradient shapes** are flat vector gradients (two stops per shape, linear
  or radial). Both backends render these natively, so preview and SVG agree
  with no fallback. They do not do photographic shading: no inner shadows,
  no scene lighting, no texture — a sphere is a radial highlight, not a 3D
  render.
- **Tile mosaic** is opaque flat triangles with a centroid inset for grout —
  no strokes, no blurs, no blends, so the SVG export is exact. Symmetry is a
  colour-source fold, not duplicated geometry: the pattern reads as mirrored
  while the node count stays stable. Photographic stone/paper grain is out of
  scope; pair with the `grain` generator for that.

## Layer selection and placement

- **Placement is a transform, not a regeneration.** `Layer.offset` is stamped onto
  each node as `tx`/`ty` at compose time (`composeIR`), and deliberately left out
  of `layerCacheKey` — the cache holds untranslated geometry, so dragging reuses
  it. Baking the offset into the geometry instead would regenerate up to 40 000
  primitives per pointer move.
- **The selection box is geometry-only.** A glow layer's visible halo extends
  well past the box, which is honest about what the layer *is* (its particles)
  rather than what it looks like. Bounds are conservative for curves: control
  points are used, so a bezier's box never clips its own ink, but can be
  slightly larger than the true extent.
- **Click-to-select is bounding-box, not exact-shape.** Testing real containment
  would mean parsing thousands of paths per click, and a click in a gap between
  particles would select nothing. A click inside a layer's extent selects it.
- **Moving is unbounded.** A layer can sit entirely off-canvas; it stops being
  selected or hit-testable but is still in the layer list, still exports, and
  still counts toward the primitive total. The quality gate will reject a
  *randomise* that produced such a project on coverage grounds.
- **Randomise resets placement; Mutate and Breed keep it.** A fresh random
  project has no offsets (every layer at the origin). `mutateProject`, `breed`
  and `variations` derive via `structuredClone`, so they preserve it.
- **Arrows nudge, they do not pan.** Arrow keys move the selected layer 1 px
  (10 px with shift) and collapse into one undo entry; the stage pans by
  space-drag or middle-drag, so there is no keyboard pan to lose.

## Scale and format boundaries

- **40 000 primitives per layer** (`MAX_PRIMITIVES` in `pipeline.ts`); the
  gallery uses a lower budget per thumbnail.
- **Export size caps** (`MAX_EXPORT_DIM`, `MAX_EXPORT_PIXELS` ≈ 40 MP in
  `export.ts`); requested scales above the cap are reduced with a warning.
- **WebM export requires browser MediaRecorder support** (`supportsWebM()`
  gate); otherwise PNG-sequence-equivalent stills are the path.
- **Workers are bypassed for image-mask layers** (masks decode with
  `document`), so those layers generate on the main thread with a 12 s
  watchdog (`WORKER_TIMEOUT_MS`).

## Process boundaries

- **Screenshots lie; metrics do not.** The `read` tool has returned
  stale/incorrect images in this environment, so all visual QA here is
  programmatic (CDP geometry, pixel statistics, `outputs/random20.png` is
  machine-written, not eyeballed).
