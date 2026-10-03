/**
 * scripts/filters-e2e.ts — Preview vs SVG export, in a real browser.
 *
 * `filters-parity.ts` proves the two backends agree by running our canvas
 * pipeline against librsvg. This closes the loop from the other side: it runs
 * them inside Chrome, where the exporter's raster-only fallback actually has to
 * build a `<canvas>`, call `toDataURL` and hand a PNG to an SVG `<image>` —
 * something no Node-side check can exercise.
 *
 * The subject is hand-built (solid fills, hard edges, no per-node blur) on
 * purpose. A generated layer blurs half its nodes, and `ctx.filter` disagrees
 * with `feGaussianBlur` at every blurred edge — with a generated subject the
 * *unfiltered* baseline alone measures ~55/255 and swamps every signal.
 *
 * Exits non-zero on any breach. Needs the dev server up.
 *
 * Usage: bun run scripts/filters-e2e.ts
 */

const URL_ = process.env.APP_URL ?? 'http://127.0.0.1:5199/'

/** Per-case slack above the measured baseline, in 0–255 per channel. */
const TOLERANCE: Record<string, number> = {
  'no filters': 0,
  'colour stack': 2,
  'glow stack': 3,
  outline: 6,
  duotone: 2,
  grain: 12,
  bypassed: 0,
  'raster-only': 0,
}

const proc = Bun.spawn(
  ['bun', 'scripts/cdp-eval.ts', URL_, 'scripts/_filter-e2e.txt', '8000'],
  { stdout: 'pipe', stderr: 'pipe', cwd: import.meta.dir + '/..' },
)
const [stdout, stderr] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  await proc.exited,
])

const body = stdout.split('--- console ---')[0].trim()
if (!body || body.startsWith('ERROR') || body.startsWith('TIMEOUT')) {
  console.error('filters-e2e: the in-page run failed')
  console.error(body.slice(0, 2000))
  console.error(stderr.slice(0, 2000))
  process.exit(1)
}

const { rows } = JSON.parse(body) as {
  rows: Array<{
    label: string
    err: number
    warnings: string
    hasFilter: boolean
    hasGroup: boolean
    hasImage: number
    imageOk: string
    svgBytes: number
  }>
}

const failures: string[] = []
const pad = (s: unknown, n: number) => String(s).padEnd(n)
const padS = (s: unknown, n: number) => String(s).padStart(n)

console.log('FX Forge — filter preview vs SVG export (Chrome)')
console.log('')
console.log(
  pad('case', 16) + padS('err', 9) + padS('tol', 6) + padS('<filter>', 10) +
  padS('<g flt>', 8) + padS('<img>', 7) + ' verdict',
)
console.log('-'.repeat(76))

let baseline = Number.NaN
for (const r of rows) {
  const tol = TOLERANCE[r.label]
  if (tol === undefined) failures.push(`${r.label}: no tolerance pinned`)
  if (r.label === 'no filters') baseline = r.err
  if (tol !== undefined && r.err > tol) {
    failures.push(`${r.label}: preview and export differ by ${r.err}/255, tolerance ${tol}`)
  }
  // a filtered layer must actually carry a filter, unless it is bypassed or
  // rasterised — otherwise the stack was silently dropped
  const expectsFilter = !['no filters', 'bypassed', 'raster-only'].includes(r.label)
  if (expectsFilter && (!r.hasFilter || !r.hasGroup)) {
    failures.push(`${r.label}: export has no <filter>/<g filter> — the stack was dropped`)
  }
  if (!expectsFilter && (r.hasFilter || r.hasGroup)) {
    failures.push(`${r.label}: export emitted a <filter> it should not have`)
  }
  console.log(
    pad(r.label, 16) +
      padS(r.err.toFixed(3), 9) +
      padS(tol ?? '?', 6) +
      padS(r.hasFilter ? 'yes' : 'no', 10) +
      padS(r.hasGroup ? 'yes' : 'no', 8) +
      padS(r.hasImage || '-', 7) +
      (tol !== undefined && r.err <= tol ? ' ok' : ' !! OVER TOLERANCE'),
  )
  if (r.warnings !== '—') console.log(`${' '.repeat(16)}↳ ${r.warnings}`)
  if (r.hasImage && !/decoded$/.test(r.imageOk)) {
    failures.push(`${r.label}: the embedded <image> did not decode (${r.imageOk})`)
  }
  if (r.hasImage && r.imageOk) console.log(`${' '.repeat(16)}↳ embedded bitmap ${r.imageOk}`)
}

console.log('')
if (!Number.isFinite(baseline) || baseline > 0.5) {
  failures.push(`the unfiltered baseline is ${baseline}/255 — the two backends disagree before any filter runs`)
}
console.log(`unfiltered baseline ${baseline}/255 (the floor everything else is measured against)`)

if (failures.length) {
  console.log('')
  console.log('failures:')
  for (const f of failures) console.log(`  ${f}`)
}
console.log('')
console.log(failures.length === 0 ? 'RESULT: PASS' : `RESULT: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)