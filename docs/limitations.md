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
- **Blend-mode caveats in SVG.** `plus-lighter` has no SVG equivalent and is
  approximated; `screen`/`overlay` also differ subtly from canvas compositing.
- **Sharpness is raster-clamped at extreme zoom.** The preview renders vector
  IR, but zooming past the rasterised resolution magnifies pixels like any
  bitmap preview. Exports re-render at full resolution.
- **Irreducible-overdraw presets exist.** A handful of presets (`aurora-veil`,
  `sunset-light-trails`) are simply dense by design and will always be the
  slowest renders — that is their look, not a bug.

## Randomiser and quality gate

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

- **No git repository** in the working directory — all history lives in the
  session, not in version control.
- **Screenshots lie; metrics do not.** The `read` tool has returned
  stale/incorrect images in this environment, so all visual QA here is
  programmatic (CDP geometry, pixel statistics, `outputs/random20.png` is
  machine-written, not eyeballed).
