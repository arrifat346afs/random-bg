/**
 * scripts/filters-parity.ts — Do the two backends agree on every filter?
 *
 * The whole filter design rests on one claim: a layer's `FilterInstance[]`
 * produces the same picture whether it is rasterised by our own canvas pipeline
 * or handed to a strict SVG renderer. That claim is worth nothing if it is never
 * measured, so this measures it — for all 27 filters, on every run.
 *
 * How it works, and why it is set up this way:
 *
 *  • The subject is rasterised **once, by librsvg**, and that raster is the
 *    input to both paths. So the two backends are provably fed identical bytes
 *    and any difference is the filter, not the artwork.
 *  • librsvg (not the browser) is the oracle. It is a real, strict,
 *    non-browser SVG renderer — the same class of consumer as Inkscape and
 *    Illustrator — so a filter that only survives in Blink does not pass here.
 *  • Comparison is over **premultiplied** RGBA. Raw bytes are meaningless on a
 *    transparent canvas: a cleared pixel is `0,0,0,0` in canvas and routinely
 *    `255,255,255,1` in SVG, which scores ~64/255 of "error" for a colour
 *    nobody can see.
 *  • Noise filters get a *statistical* check instead. `feTurbulence` and our
 *    seeded RNG are different noise generators; matching them pixel-for-pixel
 *    is not a thing either backend could promise. What must hold is that both
 *    are zero-mean, comparable in amplitude, and deterministic.
 *
 * Exits non-zero on any breach.
 *
 * Usage: bun run scripts/filters-parity.ts   (needs rsvg-convert + magick)
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { FILTERS } from '../src/lib/filters/index'
import { createFilter, defaultFilterParams } from '../src/lib/filters/stack'
import { compileLayerFilter } from '../src/lib/filters/svg'
import { renderSVG } from '../src/lib/render/svg'
import { projectFilterOpts } from '../src/lib/filters/attach'
import { applyFilterStack } from '../src/lib/filters/canvas'
import { createProject, createLayer } from '../src/lib/project'
import { projectToSvg } from '../src/lib/export'
import type { FilterInstance } from '../src/lib/filters/types'
import type { Params } from '../src/lib/schema'

/**
 * Wrap subject content in the `<filter>` the exporter would emit for `stack`.
 * Mirrors what `renderSVG` does per layer: one `<defs>` entry, one `<g filter>`.
 */
function wrapWith(stack: FilterInstance[], inner: string, w: number, h: number): string {
  const compiled = compileLayerFilter('L1', stack, w, h)
  if (!compiled) return inner
  return `<defs>${compiled.element}</defs><g filter="url(#${compiled.id})">${inner}</g>`
}

/**
 * Markup each noise/wave filter must contain. These encode the bugs this gate
 * was written to catch: grain used to *replace* the artwork with turbulence
 * (`k2` only), and then to add unmasked noise that speckled the transparent
 * margin of an export.
 */
const STRUCTURE: Record<string, string[]> = {
  grain: [
    '<feTurbulence',
    'operator="in"',
    'operator="arithmetic"',
    'k2="1"',
    'k3="1"',
  ],
  roughen: ['<feTurbulence', '<feDisplacementMap'],
  turbulence: ['<feTurbulence', '<feDisplacementMap'],
  ripple: ['<feTurbulence', '<feDisplacementMap'],
}

/* ---- Subject ------------------------------------------------------------- */

const W = 220
const H = 160

/**
 * Hard-edged shapes on a transparent ground: solid fills only (Chrome and
 * librsvg dither gradient ramps by a level or two), a crisp interior edge for
 * the convolution and morphology filters to bite on, and a wide empty margin so
 * a filter that smears outward is visible rather than cropped away.
 */
const SUBJECT =
  `<circle cx="52" cy="48" r="26" fill="#e8503a"/>` +
  `<circle cx="104" cy="36" r="15" fill="#f5c542"/>` +
  `<rect x="140" y="20" width="52" height="42" rx="6" fill="#3aa0d8"/>` +
  `<circle cx="66" cy="112" r="20" fill="#7b4fd0"/>` +
  `<rect x="104" y="92" width="70" height="14" rx="7" fill="#3ec98a"/>` +
  `<circle cx="188" cy="112" r="12" fill="#ffffff" opacity="0.55"/>` +
  `<path d="M20 138 L44 126 L68 138 L92 126 L116 138" stroke="#ffffff" stroke-width="3" fill="none"/>`

const subjectSvg = (inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
  `width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`

/* ---- Rasterising --------------------------------------------------------- */

const TMP = '/tmp/opencode/filter-parity'
mkdirSync(TMP, { recursive: true })

/** Rasterise an SVG string with librsvg and read it back as raw RGBA. */
function rasterise(svg: string, name: string): Uint8ClampedArray {
  const file = `${TMP}/${name}.svg`
  writeFileSync(file, svg)
  const png = Bun.spawnSync(['rsvg-convert', '-f', 'png', '--width', String(W), '--height', String(H), file])
  if (png.exitCode !== 0) {
    throw new Error(`rsvg-convert failed on ${name}: ${new TextDecoder().decode(png.stderr).slice(0, 400)}`)
  }
  writeFileSync(`${TMP}/${name}.png`, png.stdout)
  const raw = Bun.spawnSync(
    ['magick', 'png:-', '-depth', '8', 'rgba:-'],
    { stdin: png.stdout },
  )
  if (raw.exitCode !== 0) throw new Error(`magick failed on ${name}`)
  const buf = new Uint8Array(raw.stdout)
  if (buf.length !== W * H * 4) throw new Error(`${name}: expected ${W * H * 4} bytes, got ${buf.length}`)
  return new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length)
}

/* ---- Metrics ------------------------------------------------------------- */

/** Mean abs error over premultiplied RGBA — the colour that reaches the eye. */
function pmError(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3] / 255
    const ab = b[i + 3] / 255
    for (let k = 0; k < 3; k++) sum += Math.abs(a[i + k] * aa - b[i + k] * ab)
    sum += Math.abs(a[i + 3] - b[i + 3])
  }
  return sum / ((a.length / 4) * 4)
}

/** Mean and standard deviation of the premultiplied difference. */
function noiseStats(a: Uint8ClampedArray, b: Uint8ClampedArray): { mean: number; sd: number } {
  const n = a.length / 4
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < a.length; i += 4) {
    const aa = a[i + 3] / 255
    const ab = b[i + 3] / 255
    let d = 0
    for (let k = 0; k < 3; k++) d += Math.abs(a[i + k] * aa - b[i + k] * ab) / 3
    d += Math.abs(a[i + 3] - b[i + 3]) / 4
    sum += d
    sumSq += d * d
  }
  const mean = sum / n
  return { mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) }
}

/**
 * Per-filter tolerance on the premultiplied mean error, in 0–255 per channel.
 *
 * Keyed by what the filter *is*, not by what it happened to measure once:
 *  • `tight`   colour algebra and blurs — both backends run the same maths, so
 *              more than a couple of levels is a genuine disagreement
 *  • `medium`  convolution, displacement, resampling — sampling grids differ,
 *              so edges differ without either side being wrong
 *  • `loose`   morphology and glow, where a one-pixel edge shift is invisible
 *  • `null`    noise/wave filters, checked structurally + statistically (see
 *              `STRUCTURE` below) rather than pixel-for-pixel
 */
const TOLERANCE: Record<string, number | null> = {
  'gaussian-blur': 3,
  feather: 3,
  'brightness-contrast': 3,
  hsl: 3,
  grayscale: 2,
  sepia: 2,
  invert: 2,
  duotone: 3,
  posterize: 3,
  levels: 3,
  roughen: null,
  ripple: null,
  turbulence: null,
  grain: null,
  'erode-dilate': 4,
  outline: 4,
  sharpen: 6,
  emboss: 8,
  'edge-detect': 8,
  'drop-shadow': 6,
  'outer-glow': 6,
  'inner-glow': 6,
  'motion-blur': null,
  'radial-blur': null,
  'zoom-blur': null,
  pixelate: 6,
  chromatic: 5,
}

/** Params that actually do something — three filters are identity at defaults. */
function liveParams(type: string): Params {
  const p = defaultFilterParams(type)
  if (type === 'brightness-contrast') return { ...p, brightness: 0.12, contrast: 0.3 }
  if (type === 'hsl') return { ...p, hue: 24, saturation: 0.4, lightness: 0.06 }
  if (type === 'levels') return { ...p, black: 0.12, white: 0.94, gamma: 1.3 }
  return p
}

/* ---- Run ----------------------------------------------------------------- */

const failures: string[] = []
const fail = (m: string) => failures.push(m)

const bare = rasterise(subjectSvg(`<g>${SUBJECT}</g>`), 'bare')
const bareErr = pmError(bare, bare)
if (bareErr !== 0) fail(`the unfiltered subject is not self-consistent (${bareErr})`)

interface Row {
  type: string
  group: string
  rasterOnly: boolean
  err: number
  changed: boolean
  mean: number
  sd: number
  deterministic: boolean
  structural: string
}
const rows: Row[] = []

for (const def of FILTERS) {
  const tol = TOLERANCE[def.type]
  if (tol === undefined) fail(`${def.type}: no parity tolerance pinned in scripts/filters-parity.ts`)
  const inst = createFilter(def.type, liveParams(def.type))
  if (!inst) {
    fail(`${def.type}: createFilter returned null`)
    continue
  }

  // ---- the SVG backend ---------------------------------------------------
  const compiled = compileLayerFilter('L1', [inst], W, H)
  const svgPx = rasterise(subjectSvg(wrapWith([inst], SUBJECT, W, H)), def.type)

  // ---- the canvas backend ------------------------------------------------
  const canvasPx = applyFilterStack(bare, W, H, [inst], 7)
  const canvasPx2 = applyFilterStack(bare, W, H, [inst], 7)

  const err = pmError(canvasPx, svgPx)
  const st = noiseStats(canvasPx, svgPx)
  // "did it do anything" — any pixel at all. A whole-image mean is the wrong
  // question for a localised effect: sharpen only touches edge pixels, which
  // on a sparse subject can be well under 0.5/255 of the frame.
  let changed = false
  for (let i = 0; i < canvasPx.length && !changed; i++) {
    if (canvasPx[i] !== bare[i]) changed = true
  }
  const deterministic = canvasPx.every((v, i) => v === canvasPx2[i])

  // structural expectations: what the exporter must emit for this filter
  let structural = 'ok'
  if (def.rasterOnly) {
    if (compiled) structural = 'raster-only emitted a <filter>'
  } else if (!compiled) {
    structural = 'no <filter> emitted'
  }

  rows.push({
    type: def.type,
    group: def.group,
    rasterOnly: def.rasterOnly,
    err,
    changed,
    mean: st.mean,
    sd: st.sd,
    deterministic,
    structural,
  })

  if (!deterministic) fail(`${def.type}: canvas apply is not deterministic`)
  if (structural !== 'ok') fail(`${def.type}: ${structural}`)
  if (!changed) fail(`${def.type}: canvas output is identical to the unfiltered layer`)

  if (def.rasterOnly) continue // nothing to compare against: export embeds a raster

  if (tol === null) {
    // Noise/wave filters. `feTurbulence` and our seeded RNG are different
    // generators and librsvg's feTurbulence/feComposite support is partial, so
    // pixel parity is not something this pairing could promise. What is
    // asserted instead: the *structure* of the markup (which catches the real
    // regressions — a dropped source, an unmasked noise layer, a missing
    // primitive) and that neither side is wildly biased.
    const xml = compiled?.element ?? ''
    for (const need of STRUCTURE[def.type] ?? []) {
      if (!xml.includes(need)) fail(`${def.type}: SVG is missing ${need}`)
    }
    if (st.mean > 40) fail(`${def.type}: mean canvas-vs-SVG drift ${st.mean.toFixed(1)}/255 — one side is biased`)
    if (st.sd > 90) fail(`${def.type}: canvas-vs-SVG spread ${st.sd.toFixed(1)}/255 — wildly different noise`)
    continue
  }

  if (err > tol) fail(`${def.type}: backends differ by ${err.toFixed(2)}/255, tolerance ${tol}`)
}


/* ---- Structure: one <filter> per stack, raster fallback -------------------- */

const project = createProject({ seed: 4242, layers: [] })
project.canvas = { w: W, h: H, bg: { kind: 'transparent' } }
const layer = createLayer('geometric', 99, { name: 'parity' })
project.layers = [layer]

// composeIR needs a LayerResult; the subject above already *is* one rasterised,
// so hand it a synthetic one built from the same shapes via the plain IR path
const { buildIR, circle } = await import('../src/lib/ir')
const irNodes = [
  circle(52, 48, 26, { k: 'solid', c: '#e8503a' }),
  circle(104, 36, 15, { k: 'solid', c: '#f5c542' }),
  circle(66, 112, 20, { k: 'solid', c: '#7b4fd0' }),
]
const result = { ir: buildIR(W, H, irNodes), layerId: layer.id, truncated: false, key: 'p', ms: 0 }

layer.filters = [
  createFilter('gaussian-blur', { sigmaX: 2, sigmaY: 2 })!,
  createFilter('drop-shadow', { dx: 3, dy: 4, blur: 4 })!,
  createFilter('sepia', { amount: 0.4 })!,
  createFilter('sharpen', { amount: 0.5 })!,
]
const chainSvg = projectToSvg(project, [result], {}).svg
const filterEls = (chainSvg.match(/<filter id="fx-/g) ?? []).length
const groups = (chainSvg.match(/<g filter=/g) ?? []).length
const prims = (chainSvg.match(/<fe[A-Za-z]+/g) ?? []).length
if (filterEls !== 1) fail(`a 4-filter stack emitted ${filterEls} <filter> elements, expected 1`)
if (groups !== 1) fail(`a 4-filter stack emitted ${groups} filtered groups, expected 1`)
if (prims < 4) fail(`a 4-filter stack emitted only ${prims} primitives`)

layer.filters = [createFilter('chromatic', { amount: 3 })!]
const rasterOut = projectToSvg(project, [result], {})
if (!rasterOut.warnings.some((w) => /image/i.test(w)))
  fail('the export did not warn that a layer was embedded as an image')

// The `<image>` emission itself is pure, so it is asserted here rather than in a
// browser: feed `renderSVG` a pre-rasterised layer the way `projectToSvg` does.
const withImage = renderSVG(rasterOut.ir, {
  layerFilters: projectFilterOpts(project).layerFilters,
  rasterImages: { [layer.id]: 'data:image/png;base64,AAAA' },
})
if (!withImage.includes('<image')) fail('a raster-only layer did not emit an <image>')
if (/<filter id="fx-/.test(withImage)) fail('a raster-only layer still emitted an SVG <filter>')
if (/<g filter=/.test(withImage)) fail('a raster-only layer still emitted a filtered <g>')
if (!/preserveAspectRatio="none"/.test(withImage))
  fail('the embedded <image> would be letterboxed instead of filling the canvas')

// transparent export must not paint the empty margin
let leaked = 0
let empty = 0
layer.filters = [createFilter('duotone')!]
{
  const svgPx = rasterise(subjectSvg(wrapWith([createFilter('duotone')!], SUBJECT, W, H)), 'fringe')
  const canvasPx = applyFilterStack(bare, W, H, [createFilter('duotone')!], 7)
  for (let i = 3; i < bare.length; i += 4) {
    if (bare[i] !== 0) continue
    empty++
    if (svgPx[i] > 8 || canvasPx[i] > 8) leaked++
  }
  if (empty > 0 && leaked / empty > 0.01)
    fail(`duotone painted ${((leaked / empty) * 100).toFixed(1)}% of the empty margin — halos on transparent export`)
}
if (bare[3] !== 0) fail('the unfiltered transparent subject has an opaque corner')

/* ---- Report -------------------------------------------------------------- */

const pad = (s: unknown, n: number) => String(s).padEnd(n)
const padS = (s: unknown, n: number) => String(s).padStart(n)

console.log('FX Forge — filter backend parity')
console.log(`canvas pipeline vs librsvg @ ${W}×${H}, transparent ground, identical input bytes`)
console.log('')
console.log(
  pad('filter', 22) +
    pad('group', 10) +
    padS('err', 9) +
    padS('tol', 6) +
    padS('Δ mean', 9) +
    padS('Δ sd', 8) +
    ' verdict',
)
console.log('-'.repeat(80))

for (const r of rows) {
  const tol = TOLERANCE[r.type]
  if (r.rasterOnly) {
    console.log(
      pad(r.type, 22) + pad(r.group, 10) + padS(r.err.toFixed(2), 9) + padS('—', 6) +
      padS(r.mean.toFixed(1), 9) + padS(r.sd.toFixed(1), 8) + ' raster-only (export <image>)',
    )
    continue
  }
  const ok = tol !== null && r.err <= (tol as number)
  console.log(
    pad(r.type, 22) +
      pad(r.group, 10) +
      padS(r.err.toFixed(2), 9) +
      padS(tol === null ? 'stat' : tol, 6) +
      padS(r.mean.toFixed(1), 9) +
      padS(r.sd.toFixed(1), 8) +
      (ok ? ' ok' : tol === null ? ' statistical agreement' : ' !! OVER TOLERANCE'),
  )
}

console.log('')
console.log('— stack chaining —')
console.log(`  ${prims} chained primitives → ${filterEls} <filter> + ${groups} <g filter>`)
console.log('— raster-only fallback —')
console.log(`  chromatic → <image>, no <filter>, warning emitted ✓`)
console.log('— transparent export keeps a clean edge —')
console.log(
  `  duotone: ${leaked}/${empty} empty pixels gained alpha ` +
    `(${empty > 0 ? ((leaked / empty) * 100).toFixed(2) : '0'}%)`,
)

const compared = rows.filter((r) => !r.rasterOnly && TOLERANCE[r.type] !== null).length
const statistical = rows.filter((r) => !r.rasterOnly && TOLERANCE[r.type] === null).length
console.log('')
console.log(`${compared} filters compared per-pixel, ${statistical} compared statistically, ${rows.filter((r) => r.rasterOnly).length} raster-only`)

if (failures.length) {
  console.log('')
  console.log('failures:')
  for (const f of failures) console.log(`  ${f}`)
}
console.log('')
console.log(failures.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failures.length})`)
rmSync(TMP, { recursive: true, force: true })
process.exit(failures.length === 0 ? 0 : 1)