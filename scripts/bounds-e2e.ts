/**
 * scripts/bounds-e2e.ts — "does anything still get sliced off at a rectangle?"
 *
 * `scripts/check.ts` proves the engine is self-consistent in Node. This proves
 * the rendered pixels are, which needs a real Canvas2D implementation: the
 * failure mode guarded here only exists once an offscreen surface is involved.
 *
 * The bug: a layer's content was clipped to a rectangle derived from its bare
 * geometry, so a blurred additive layer lost 94 % of its pixels and was cut along
 * a hard straight seam. Four assertions now hold it shut:
 *
 *   1. edge continuity — the bug case with clipping on vs clipping forced off
 *      must be near-identical. Any difference is a clip that cropped something.
 *   2. straight edges  — no internal row or column may be a long, perfectly
 *      straight luminance discontinuity, in the bug case or in any of the 38
 *      original presets.
 *   3. bounds          — for every generator × every filter, the rectangle the
 *      renderer clips to must contain every pixel that ended up lit.
 *   4. parity          — preview, canvas export and SVG export must all be free
 *      of clipped edges.
 *
 * Exits non-zero on any breach. Needs the dev server up.
 *
 * Usage: bun run scripts/bounds-e2e.ts
 */

const URL_ = process.env.APP_URL ?? 'http://127.0.0.1:5199/'

/** Mean abs error (0–255/channel) the two paths may differ by. */
const MEAN_TOLERANCE = 0.5
/** Worst 16×16 block the two paths may differ by. */
const BLOCK_TOLERANCE = 12
/**
 * How far the canvas export's lit-pixel count may sit from the SVG export's.
 * The two blur kernels are not expected to match pixel for pixel, so this is
 * deliberately loose — but a backend that silently drops 93 % of a layer still
 * produces a perfectly smooth image, and only a count catches that.
 */
const COVERAGE_MIN = 0.85
const COVERAGE_MAX = 1.15

interface Edges {
  rows: { at: number; frac: number }[]
  cols: { at: number; frac: number }[]
  geometryRows: number
  geometryCols: number
}
interface Report {
  continuity: { mean: number; worstBlock: number; inkOn: number; inkOff: number }
  aliasing: { selfBlits: number; sites: string[] }
  edges: { bug: Edges; presetsWithStraightEdges: { id: string }[]; presetCount: number }
  bounds: {
    checked: number
    failed: number
    worstMiss: number
    failures: { gen: string; filter: string; over: number }[]
  }
  parity: {
    svgBytes: number
    svgDecoded: boolean
    preview: Edges
    export: Edges
    svg: Edges | null
    previewVsExport: { mean: number; worstBlock: number }
  }
  coverage: { canvasLit: number; svgLit: number | null; svgBytes: number }
}

const run = Bun.spawnSync(['bun', 'scripts/cdp-eval.ts', URL_, 'scripts/_bounds-e2e.txt', '9000'], {
  cwd: import.meta.dir + '/..',
})
const text = run.stdout.toString().split('--- console ---')[0].trim()

if (!text || text.startsWith('ERROR') || text.startsWith('TIMEOUT')) {
  console.error('bounds-e2e: the in-page run failed')
  console.error(text.slice(0, 3000))
  console.error(run.stderr.toString().slice(0, 2000))
  process.exit(1)
}

let report: Report
try {
  report = JSON.parse(text) as Report
} catch (err) {
  console.error('bounds-e2e: could not parse the in-page report')
  console.error(text.slice(0, 3000))
  console.error(err)
  process.exit(1)
}

const failures: string[] = []
const pad = (s: unknown, n: number) => String(s).padEnd(n)
const padS = (s: unknown, n: number) => String(s).padStart(n)
const describe = (e: Edges): string =>
  `${e.rows.length} row(s) ${JSON.stringify(e.rows.slice(0, 3))}, ` +
  `${e.cols.length} col(s) ${JSON.stringify(e.cols.slice(0, 3))}`
const verdict = (ok: boolean) => (ok ? 'ok' : '!! CLIPPED')

console.log('FX Forge — layer content must never be clipped to a rectangle (Chrome)')
console.log('')

/* 1. edge continuity -------------------------------------------------------- */
const c = report.continuity
console.log(`${pad('continuity', 26)}${padS('mean', 10)}${padS('worst blk', 12)}  verdict`)
console.log('-'.repeat(72))
const meanOk = c.mean <= MEAN_TOLERANCE
const blockOk = c.worstBlock <= BLOCK_TOLERANCE
if (!meanOk) fail(`clipping changes the render by ${c.mean}/255 (tolerance ${MEAN_TOLERANCE})`)
if (!blockOk) fail(`clipping changes the worst 16×16 block by ${c.worstBlock}/255 (tolerance ${BLOCK_TOLERANCE})`)
if (c.inkOn < c.inkOff * 0.98) {
  fail(`the clipped render lost artwork: ${c.inkOn} lit px vs ${c.inkOff} unclipped`)
}
console.log(
  pad('clipping on vs off', 26) + padS(c.mean.toFixed(4), 10) + padS(c.worstBlock.toFixed(2), 12) +
    `  ${verdict(meanOk && blockOk)}`,
)
console.log(`  lit pixels: ${c.inkOn} clipped / ${c.inkOff} unclipped`)

/* 1b. aliasing invariant ---------------------------------------------------- */
const al = report.aliasing
console.log('')
console.log(`${pad('aliasing invariant', 26)}${padS('self-blits', 26)}  verdict`)
console.log('-'.repeat(72))
if (al.selfBlits > 0) {
  fail(
    `a surface was composited onto itself ${al.selfBlits} time(s) — an offscreen surface is ` +
      `being shared between nested draws, which clears the outer one`,
  )
  for (const s of al.sites) console.log(`  ↳ ${s}`)
}
console.log(
  pad('self-composites', 26) + padS(al.selfBlits, 26) + `  ${verdict(al.selfBlits === 0)}`,
)

/* 2. straight edges --------------------------------------------------------- */
console.log('')
console.log(`${pad('straight edges', 26)}${padS('clip rows', 11)}${padS('clip cols', 11)}  verdict`)
console.log('-'.repeat(72))
const bug = report.edges.bug
const bugOk = bug.rows.length === 0 && bug.cols.length === 0
if (!bugOk) fail(`the bug case has clip-only straight edges: ${describe(bug)}`)
console.log(
  pad('bug case', 26) + padS(bug.rows.length, 11) + padS(bug.cols.length, 11) + `  ${verdict(bugOk)}`,
)
const dirty = report.edges.presetsWithStraightEdges
for (const p of dirty) fail(`preset "${p.id}" has a clip-only straight edge`)
console.log(
  pad(`${report.edges.presetCount} presets`, 26) + padS(dirty.length, 11) + padS('', 11) +
    `  ${verdict(dirty.length === 0)}`,
)
for (const p of dirty) console.log(`  ↳ ${p.id}`)
console.log('  (only edges absent from the unfiltered render count — axis-aligned')
console.log('   artwork such as rings or gems is present either way)')

/* 3. bounds ----------------------------------------------------------------- */
console.log('')
const b = report.bounds
console.log(
  `${pad('bounds', 26)}${padS('checked', 10)}${padS('outside', 10)}${padS('worst', 9)}  verdict`,
)
console.log('-'.repeat(72))
if (b.failed > 0) {
  fail(`${b.failed}/${b.checked} generator×filter pairs lit pixels outside renderBounds (worst ${b.worstMiss}px)`)
}
console.log(
  pad('generator × filter', 26) + padS(b.checked, 10) + padS(b.failed, 10) +
    padS(b.worstMiss.toFixed(2), 9) + `  ${verdict(b.failed === 0)}`,
)
for (const f of b.failures) console.log(`  ↳ ${f.gen} + ${f.filter}: ${f.over}px outside`)

/* 4. parity ----------------------------------------------------------------- */
console.log('')
const p = report.parity
console.log(`${pad('backend parity', 26)}${padS('clip rows', 11)}${padS('clip cols', 11)}  verdict`)
console.log('-'.repeat(72))
if (!p.svgDecoded) fail('the SVG export could not be rasterised for comparison')
for (const [label, edges] of [
  ['preview', p.preview],
  ['canvas export', p.export],
  ['svg export', p.svg],
] as const) {
  if (!edges) continue
  const ok = edges.rows.length === 0 && edges.cols.length === 0
  if (!ok) fail(`${label} has clip-only straight edges: ${describe(edges)}`)
  console.log(
    pad(label, 26) + padS(edges.rows.length, 11) + padS(edges.cols.length, 11) + `  ${verdict(ok)}`,
  )
}
console.log(
  `  svg ${p.svgBytes} bytes · preview vs canvas export ${p.previewVsExport.mean.toFixed(3)}/255 mean, ` +
    `${p.previewVsExport.worstBlock.toFixed(2)}/255 worst block`,
)

/* 5. coverage across backends ------------------------------------------------ */
const cov = report.coverage
console.log('')
console.log(`${pad('coverage', 26)}${padS('canvas', 12)}${padS('svg', 12)}${padS('ratio', 9)}  verdict`)
console.log('-'.repeat(72))
if (cov.svgLit === null) {
  fail('the SVG export of the bug case could not be rasterised for a coverage comparison')
} else if (cov.svgLit > 0) {
  const ratio = cov.canvasLit / cov.svgLit
  if (ratio < COVERAGE_MIN || ratio > COVERAGE_MAX) {
    fail(
      `the canvas export lit ${cov.canvasLit} px where the SVG export lit ${cov.svgLit} ` +
        `(ratio ${ratio.toFixed(3)}, allowed ${COVERAGE_MIN}–${COVERAGE_MAX}) — a backend is dropping content`,
    )
  }
  console.log(
    pad('bug case, canvas vs svg', 26) + padS(cov.canvasLit, 12) + padS(cov.svgLit, 12) +
      padS(cov.svgLit ? (cov.canvasLit / cov.svgLit).toFixed(3) : '-', 9) +
      `  ${verdict(cov.svgLit !== null && cov.canvasLit / cov.svgLit >= COVERAGE_MIN && cov.canvasLit / cov.svgLit <= COVERAGE_MAX)}`,
  )
  console.log('  (coverage must agree even though the two blur kernels need not)')
}

function fail(msg: string): void {
  failures.push(msg)
}

console.log('')
if (failures.length) {
  console.log('failures:')
  for (const f of failures) console.log(`  ${f}`)
}
console.log('')
console.log(failures.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)