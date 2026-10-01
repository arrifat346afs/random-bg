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
reappears in generated output.

| Construct | Browser | Inkscape | librsvg |
| --- | --- | --- | --- |
| `stop-color` + `stop-opacity` | yes | yes | yes |
| `stop-color="rgba(...)"` | yes | **no — renders black** | yes |
| `mix-blend-mode="screen"` | yes | yes | yes |
| `mix-blend-mode="plus-lighter"` | yes | **no — blend dropped** | **no — blend dropped** |
| `<feGaussianBlur>` + `color-interpolation-filters="sRGB"` | yes | yes | yes |
| Presentation attributes over `style=""` | yes | yes | yes |

Two rules the SVG backend follows because of this table:

- **Never `rgba()`/`hsl()` in a presentation attribute.** Alpha goes in a
  separate `stop-opacity`/`fill-opacity`. A `rgba()` gradient stop is not a
  cosmetic difference — Inkscape parses it as black, and since gradient fills
  are nearly every node in a glow preset, the whole export goes black.
- **Never `plus-lighter` in a presentation attribute.** The attribute carries
  `screen`; a `<style>` rule upgrades browsers, which outrank presentation
  attributes in the cascade. Renderers ignoring the stylesheet degrade to
  `screen` rather than losing the blend.

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
  for. First-try pass rate on the fixed 20-seed set is 14/20; the gate brings
  the final rate to 20/20 with ~0.35 retries on average.
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
  gate if it covers enough canvas. Sparse is a penalty, not a rejection.

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
