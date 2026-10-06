/**
 * scripts/diversity.ts — STEP 1 sameness measurement.
 *
 * Measures 300 projects (seeds 1..300) in the dev-server page via
 * `scripts/cdp-eval.ts`, ~20 seeds per call, merged here (Option A, batched).
 * For each seed it captures the UNGATED `randomProject` and the GATED
 * `randomProjectChecked` result plus a 128 px descriptor (see
 * `scripts/_diversity-batch.txt`), then reports:
 *
 *  • generator/family frequencies before vs after the gate
 *  • share of results with a full-canvas layer (mosaic, gradShapes, smoke, grain)
 *  • coverage + background-luma histograms
 *  • mean pairwise descriptor distance + 10 most similar pairs
 *  • (a) mean quality score / rejection share per generator
 *  • (b) per-parameter spread vs registry rand ranges
 *  • (c) palette/background pool usage
 *
 * Artefacts: `outputs/diversity.json`, `outputs/diversity.md`,
 * `outputs/diversity-pairs.png`.
 *
 * Usage: bun run scripts/diversity.ts   (dev server must be up)
 *   APP_URL env overrides the default http://localhost:5173/
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { GENERATORS } from '../src/lib/generators'

const ROOT = import.meta.dir + '/..'
const URL_ = process.env.APP_URL ?? 'http://localhost:5173/'
const N = 300
const BATCH = 20
const FULLBLEED_IDS = ['mosaic', 'gradShapes', 'smoke', 'grain']

interface Row {
  seed: number
  error?: string
  ungated?: any
  gated?: any
  attempts?: Array<{
    genIds: string[]
    ok: boolean
    score: number
    cov: number
    luma: number
    nodes: number
    hard: string[]
    soft: string[]
  }>
}

/* ---- batch runner ------------------------------------------------------ */

async function runBatch(seeds: number[], waitMs: string): Promise<Row[]> {
  const tpl = readFileSync(ROOT + '/scripts/_diversity-batch.txt', 'utf8')
  const expr = tpl.replace('const SEEDS = __SEEDS__', `const SEEDS = ${JSON.stringify(seeds)}`)
  const exprFile = `/tmp/opencode/div-batch-${seeds[0]}-${seeds[seeds.length - 1]}.txt`
  writeFileSync(exprFile, expr)
  const proc = Bun.spawn(['bun', 'scripts/cdp-eval.ts', URL_, exprFile, waitMs], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: ROOT,
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  void exitCode
  void stderr
  const body = stdout.split('--- console ---')[0].trim()
  if (!body || body.startsWith('ERROR') || body.startsWith('TIMEOUT')) {
    throw new Error(`batch ${seeds[0]}..${seeds[seeds.length - 1]} failed: ${body.slice(0, 300)}`)
  }
  const data = JSON.parse(body) as { rows: Row[] }
  if (!Array.isArray(data.rows) || data.rows.length !== seeds.length) {
    throw new Error(`batch ${seeds[0]}..${seeds[seeds.length - 1]}: got ${data.rows?.length} rows`)
  }
  return data.rows
}

/* ---- descriptor distance ----------------------------------------------- */

function cosSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na <= 0 || nb <= 0) return 1
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Feature vector (standardised scalar part) + cosine parts for histograms. */
function describeVec(d: any): { z: number[]; hue: number[]; hist: number[] } {
  return {
    z: [d.coverage / 100, d.meanLuma / 255, d.meanSat, d.edge, d.cx, d.cy, d.sym],
    hue: d.hueHist,
    hist: d.hist,
  }
}

function standardise(vecs: number[][]): { m: number[]; s: number[] } {
  const k = vecs[0].length
  const m = new Array(k).fill(0)
  for (const v of vecs) for (let j = 0; j < k; j++) m[j] += v[j]
  for (let j = 0; j < k; j++) m[j] /= vecs.length
  const s = new Array(k).fill(0)
  for (const v of vecs) for (let j = 0; j < k; j++) s[j] += (v[j] - m[j]) ** 2
  for (let j = 0; j < k; j++) s[j] = Math.sqrt(s[j] / vecs.length) || 1
  return { m, s }
}

/* ---- main --------------------------------------------------------------- */

const batches: number[][] = []
for (let s = 1; s <= N; s += BATCH) {
  const b: number[] = []
  for (let i = s; i < Math.min(N + 1, s + BATCH); i++) b.push(i)
  batches.push(b)
}

const all: Row[] = []
for (let bi = 0; bi < batches.length; bi++) {
  const seeds = batches[bi]
  console.log(`diversity: batch ${bi + 1}/${batches.length} (seeds ${seeds[0]}..${seeds[seeds.length - 1]})…`)
  let rows: Row[] | null = null
  for (let attempt = 0; attempt < 2 && !rows; attempt++) {
    try {
      rows = await runBatch(seeds, bi === 0 ? '12000' : '8000')
    } catch (e) {
      console.log(`  retry (${String(e).slice(0, 160)})`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  if (!rows) throw new Error(`batch ${seeds[0]}..${seeds[seeds.length - 1]} failed twice`)
  all.push(...rows)
}

const errors = all.filter((r) => r.error || !r.gated)
if (errors.length) {
  console.log(`diversity: ${errors.length} error rows (first: ${JSON.stringify(errors[0]).slice(0, 300)})`)
}

const ok = all.filter((r) => r.gated && r.ungated) as Array<Required<Pick<Row, 'seed' | 'ungated' | 'gated'>> & Pick<Row, 'attempts'>>
console.log(`diversity: ${ok.length}/${N} measured rows`)

/* ---- frequencies -------------------------------------------------------- */

const genIds = GENERATORS.map((g) => g.id)
const famOf = new Map(GENERATORS.map((g) => [g.id, g.family]))

const countInto = (ids: string[], map: Map<string, number>): void => {
  for (const id of new Set(ids)) map.set(id, (map.get(id) ?? 0) + 1)
}
const gatedGen = new Map<string, number>()
const ungatedGen = new Map<string, number>()
const gatedFam = new Map<string, number>()
const ungatedFam = new Map<string, number>()
let gatedFull = 0
let ungatedFull = 0
for (const r of ok) {
  countInto(r.gated.genIds, gatedGen)
  countInto(r.ungated.genIds, ungatedGen)
  countInto(r.gated.fams, gatedFam)
  countInto(r.ungated.fams, ungatedFam)
  if (r.gated.fullBleed) gatedFull++
  if (r.ungated.fullBleed) ungatedFull++
}

/* ---- (a) per-generator score / rejection --------------------------------- */

const scoreSum = new Map<string, number>()
const scoreN = new Map<string, number>()
const rejN = new Map<string, number>()
const rejD = new Map<string, number>()
for (const r of ok) {
  for (const a of r.attempts ?? []) {
    for (const g of new Set(a.genIds)) {
      scoreSum.set(g, (scoreSum.get(g) ?? 0) + a.score)
      scoreN.set(g, (scoreN.get(g) ?? 0) + 1)
      rejD.set(g, (rejD.get(g) ?? 0) + 1)
      if (!a.ok) rejN.set(g, (rejN.get(g) ?? 0) + 1)
    }
  }
}

/* ---- histograms ---------------------------------------------------------- */

const covBins = [0, 3, 10, 25, 50, 75, 101]
const covHist = new Array(covBins.length - 1).fill(0)
const bgBins = [0, 30, 90, 150, 185, 256]
const bgHist = new Array(bgBins.length - 1).fill(0)
const bin = (v: number, edges: number[]): number => {
  for (let i = 0; i < edges.length - 1; i++) if (v >= edges[i] && v < edges[i + 1]) return i
  return edges.length - 2
}
for (const r of ok) {
  covHist[bin(r.gated.desc.coverage, covBins)]++
  bgHist[bin(r.gated.bgLuma, bgBins)]++
}

/* ---- pairwise distance ---------------------------------------------------- */

const vecs = ok.map((r) => describeVec(r.gated.desc))
const { m, s } = standardise(vecs.map((v) => v.z))
const Z = vecs.map((v) => v.z.map((x, j) => (x - m[j]) / s[j]))
let sumD = 0
let pairs = 0
let closest: Array<{ a: number; b: number; d: number }> = []
const dist = (i: number, j: number): number => {
  let e = 0
  for (let k = 0; k < Z[i].length; k++) e += (Z[i][k] - Z[j][k]) ** 2
  e = Math.sqrt(e)
  return e + (1 - cosSim(vecs[i].hue, vecs[j].hue)) + (1 - cosSim(vecs[i].hist, vecs[j].hist))
}
for (let i = 0; i < ok.length; i++) {
  for (let j = i + 1; j < ok.length; j++) {
    const d = dist(i, j)
    sumD += d
    pairs++
    if (closest.length < 10 || d < closest[closest.length - 1].d) {
      closest.push({ a: i, b: j, d })
      closest.sort((x, y) => x.d - y.d)
      closest = closest.slice(0, 10)
    }
  }
}
const meanD = sumD / Math.max(1, pairs)

/* ---- (b) per-parameter spread ---------------------------------------------- */

interface Spread {
  gen: string
  key: string
  type: string
  n: number
  min: number
  p5: number
  med: number
  p95: number
  max: number
  uniq: number
  regMin?: number
  regMax?: number
  randMin?: number
  randMax?: number
  spreadRatio?: number
  enumTop?: Array<[string, number]>
}
const numVals = new Map<string, number[]>()
const enumVals = new Map<string, Map<string, number>>()
for (const r of ok) {
  for (const l of r.gated.layers) {
    for (const [k, v] of Object.entries(l.params as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        const key = `${l.gen}.${k}`
        if (!numVals.has(key)) numVals.set(key, [])
        numVals.get(key)!.push(v)
      } else if (typeof v === 'string' || typeof v === 'boolean') {
        const key = `${l.gen}.${k}`
        if (!enumVals.has(key)) enumVals.set(key, new Map())
        const mm = enumVals.get(key)!
        mm.set(String(v), (mm.get(String(v)) ?? 0) + 1)
      }
    }
  }
}
const q = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
const defOf = (genId: string, key: string) =>
  GENERATORS.find((g) => g.id === genId)?.params.find((d) => d.key === key)
const spreads: Spread[] = []
for (const [key, vals] of numVals) {
  const [gen, ...rest] = key.split('.')
  const k = rest.join('.')
  const sorted = [...vals].sort((a, b) => a - b)
  const def = defOf(gen, k)
  const lo = def?.rand?.min ?? def?.min
  const hi = def?.rand?.max ?? def?.max
  const span = lo !== undefined && hi !== undefined && hi > lo ? hi - lo : sorted[sorted.length - 1] - sorted[0] || 1
  spreads.push({
    gen,
    key: k,
    type: def?.type ?? '?',
    n: vals.length,
    min: sorted[0],
    p5: q(sorted, 0.05),
    med: q(sorted, 0.5),
    p95: q(sorted, 0.95),
    max: sorted[sorted.length - 1],
    uniq: new Set(vals).size,
    regMin: def?.min,
    regMax: def?.max,
    randMin: def?.rand?.min,
    randMax: def?.rand?.max,
    spreadRatio: +((q(sorted, 0.95) - q(sorted, 0.05)) / span).toFixed(3),
  })
}
spreads.sort((a, b) => a.spreadRatio! - b.spreadRatio!)
const enumTop: Spread[] = []
for (const [key, mm] of enumVals) {
  const [gen, ...rest] = key.split('.')
  const total = [...mm.values()].reduce((a, b) => a + b, 0)
  const top = [...mm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) as Array<[string, number]>
  enumTop.push({ gen, key: rest.join('.'), type: 'enum', n: total, min: 0, p5: 0, med: 0, p95: 0, max: 0, uniq: mm.size, enumTop: top })
}

/* ---- (c) palette / background pools ------------------------------------------ */

const paletteNames = new Map<string, number>()
const paletteSets = new Set<string>()
const bgKinds = new Map<string, number>()
const bgColors = new Set<string>()
for (const r of ok) {
  const p = r.gated.palette
  paletteNames.set(p.name ?? '?', (paletteNames.get(p.name ?? '?') ?? 0) + 1)
  paletteSets.add([...p.colors].sort().join('|'))
  const bg = r.gated.bg
  bgKinds.set(bg.kind, (bgKinds.get(bg.kind) ?? 0) + 1)
  if (bg.kind === 'solid') bgColors.add(bg.color)
  if (bg.kind === 'gradient') bgColors.add(`${bg.from}>${bg.to}@${bg.angle}`)
  if (bg.kind === 'noise') bgColors.add(`noise:${bg.color}`)
}

/* ---- artefacts -------------------------------------------------------------- */

mkdirSync(ROOT + '/outputs', { recursive: true })
writeFileSync(ROOT + '/outputs/diversity.json', JSON.stringify({
  meta: { n: N, seeds: '1..300', attempts: 8, descPx: 128, fullbleedIds: FULLBLEED_IDS },
  gatedGen: [...gatedGen],
  ungatedGen: [...ungatedGen],
  gatedFam: [...gatedFam],
  ungatedFam: [...ungatedFam],
  gatedFullShare: gatedFull / ok.length,
  ungatedFullShare: ungatedFull / ok.length,
  covHist,
  bgHist,
  meanPairwise: meanD,
  closest: closest.map((c) => ({ aSeed: ok[c.a].seed, bSeed: ok[c.b].seed, d: +c.d.toFixed(3) })),
  perGenScore: genIds.map((g) => ({
    gen: g,
    meanScore: scoreN.get(g) ? +((scoreSum.get(g) ?? 0) / scoreN.get(g)!).toFixed(1) : null,
    rejShare: rejD.get(g) ? +((rejN.get(g) ?? 0) / rejD.get(g)!).toFixed(3) : null,
    attempts: rejD.get(g) ?? 0,
  })),
  spreads,
  enumTop,
  palettes: { names: [...paletteNames], distinctSets: paletteSets.size },
  bgs: { kinds: [...bgKinds], distinctColors: bgColors.size },
  rows: ok,
}, null, 1))

const pct = (n: number): string => (n / ok.length * 100).toFixed(1) + '%'
const lines: string[] = []
lines.push(`# diversity — STEP 1 sameness report`)
lines.push(``)
lines.push(`300 seeds (1..300), gated \`randomProjectChecked\` (8 attempts, 30 s budget — verdict-identical to the 750 ms gate bar timing noise) vs ungated \`randomProject\`. Descriptor from a 128 px render. Measured ${ok.length}/${N} rows.`)
lines.push(``)
lines.push(`## generator frequency (gated finals, n=${ok.length})`)
lines.push(``)
lines.push(`| gen | family | gated | ungated |`)
lines.push(`| --- | --- | --- | --- |`)
for (const g of genIds) {
  lines.push(`| ${g} | ${famOf.get(g)} | ${gatedGen.get(g) ?? 0} (${pct(gatedGen.get(g) ?? 0)}) | ${ungatedGen.get(g) ?? 0} (${pct(ungatedGen.get(g) ?? 0)}) |`)
}
lines.push(``)
lines.push(`## family frequency`)
lines.push(``)
lines.push(`| family | gated | ungated |`)
lines.push(`| --- | --- | --- |`)
for (const [f, n] of [...gatedFam].sort((a, b) => b[1] - a[1])) {
  lines.push(`| ${f} | ${n} (${pct(n)}) | ${ungatedFam.get(f) ?? 0} (${pct(ungatedFam.get(f) ?? 0)}) |`)
}
lines.push(``)
lines.push(`## full-bleed share (mosaic | gradShapes | smoke | grain present)`)
lines.push(``)
lines.push(`- gated: ${gatedFull}/${ok.length} (${pct(gatedFull)})`)
lines.push(`- ungated: ${ungatedFull}/${ok.length} (${pct(ungatedFull)})`)
lines.push(``)
lines.push(`## coverage histogram (gated, 128 px alpha %)`)
lines.push(``)
for (let i = 0; i < covHist.length; i++) lines.push(`- ${covBins[i]}–${covBins[i + 1] === 101 ? '100' : covBins[i + 1]}%: ${covHist[i]} (${pct(covHist[i])})`)
lines.push(``)
lines.push(`## background luma histogram (gated)`)
lines.push(``)
for (let i = 0; i < bgHist.length; i++) lines.push(`- ${bgBins[i]}–${bgBins[i + 1] === 256 ? '255' : bgBins[i + 1]}: ${bgHist[i]} (${pct(bgHist[i])})`)
lines.push(``)
lines.push(`## pairwise descriptor distance (gated finals)`)
lines.push(``)
lines.push(`- mean over ${pairs} pairs: ${meanD.toFixed(3)}  (z-scored scalars + hue-cos + hist-cos)`)
lines.push(`- 10 closest pairs:`)
for (const c of closest) {
  const A = ok[c.a], B = ok[c.b]
  lines.push(`  - seeds ${A.seed}–${B.seed} d=${c.d.toFixed(3)} [${A.gated.genIds.join('+')}] vs [${B.gated.genIds.join('+')}]`)
}
lines.push(``)
lines.push(`## (a) gate favouritism — score & rejection per generator (all attempts)`)
lines.push(``)
lines.push(`| gen | mean score | reject share | attempts |`)
lines.push(`| --- | --- | --- | --- |`)
for (const g of genIds) {
  const ms = scoreN.get(g) ? ((scoreSum.get(g) ?? 0) / scoreN.get(g)!).toFixed(1) : '—'
  const rj = rejD.get(g) ? ((rejN.get(g) ?? 0) / rejD.get(g)!).toFixed(3) : '—'
  lines.push(`| ${g} | ${ms} | ${rj} | ${rejD.get(g) ?? 0} |`)
}
lines.push(``)
lines.push(`## (b) per-parameter spread (gated finals, narrowest first)`)
lines.push(``)
lines.push(`spreadRatio = (p95−p5) / rand-span (or registry span when no rand). Low = clustered.`)
lines.push(``)
lines.push(`| param | type | n | min | p5 | med | p95 | max | uniq | rand | spread |`)
lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`)
for (const s of spreads) {
  lines.push(`| ${s.gen}.${s.key} | ${s.type} | ${s.n} | ${s.min} | ${s.p5} | ${s.med} | ${s.p95} | ${s.max} | ${s.uniq} | ${s.randMin ?? '—'}..${s.randMax ?? '—'} | ${s.spreadRatio} |`)
}
lines.push(``)
lines.push(`### enum params (top values)`)
lines.push(``)
for (const s of enumTop.sort((a, b) => a.gen.localeCompare(b.gen) || a.key.localeCompare(b.key))) {
  lines.push(`- ${s.gen}.${s.key} (n=${s.n}, ${s.uniq} values): ${s.enumTop!.map(([v, n]) => `${v}=${((n / s.n) * 100).toFixed(0)}%`).join(', ')}`)
}
lines.push(``)
lines.push(`## (c) palette / background pools`)
lines.push(``)
lines.push(`- palette names used: ${[...paletteNames].map(([k, v]) => `${k}=${v}`).join(', ')}`)
lines.push(`- distinct palette colour-sets: ${paletteSets.size}/${ok.length}`)
lines.push(`- bg kinds: ${[...bgKinds].map(([k, v]) => `${k}=${v}`).join(', ')}; distinct bg colours/specs: ${bgColors.size}`)
lines.push(``)
writeFileSync(ROOT + '/outputs/diversity.md', lines.join('\n'))

/* ---- contact sheet for the 10 closest pairs ---------------------------------- */

const items = closest.flatMap((c, pi) => {
  const A = ok[c.a], B = ok[c.b]
  return [
    { seed: A.seed, label: `P${pi + 1}a seed ${A.seed} [${A.gated.genIds.join('+')}] d=${c.d.toFixed(2)}` },
    { seed: B.seed, label: `P${pi + 1}b seed ${B.seed} [${B.gated.genIds.join('+')}] d=${c.d.toFixed(2)}` },
  ]
})
const sheetTpl = readFileSync(ROOT + '/scripts/_diversity-sheet.txt', 'utf8')
const sheetExpr = sheetTpl.replace('const ITEMS = __ITEMS__', `const ITEMS = ${JSON.stringify(items)}`)
const sheetFile = '/tmp/opencode/div-sheet.txt'
writeFileSync(sheetFile, sheetExpr)
console.log('diversity: rendering contact sheet…')
const proc = Bun.spawn(['bun', 'scripts/cdp-eval.ts', URL_, sheetFile, '12000'], {
  stdout: 'pipe',
  stderr: 'pipe',
  cwd: ROOT,
})
const [sout, serr, sexit] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
])
void serr
void sexit
const sbody = sout.split('--- console ---')[0].trim()
if (!sbody || sbody.startsWith('ERROR') || sbody.startsWith('TIMEOUT')) {
  throw new Error(`sheet failed: ${sbody.slice(0, 300)}`)
}
const spng = (JSON.parse(sbody) as { png: string }).png
const b64 = spng.slice(spng.indexOf(',') + 1)
await Bun.write(ROOT + '/outputs/diversity-pairs.png', Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
console.log('diversity: done → outputs/diversity.{json,md} outputs/diversity-pairs.png')
