/**
 * scripts/harshness.ts — 200-seed edge-harshness test + calibration.
 *
 * Measures the harshness distribution of gated finals and fails when the
 * gate is miscalibrated (median harsh project, or any regression seed
 * carrying a `harsh` verdict). Regression seeds from bug screenshots are
 * listed in REGRESSION_SEEDS — append screenshot seeds as they arrive.
 *
 * Harshness limit: HARSH_MAX in src/lib/quality.ts (tune from the p50/p95
 * printed here; the gate must reject the tail, not the body).
 *
 * Usage: bun run scripts/harshness.ts   (dev server must be up)
 *   SEEDS="1,2,3" bun run scripts/harshness.ts   (custom seed list)
 */

const ROOT = import.meta.dir + '/..'
const URL_ = process.env.APP_URL ?? 'http://localhost:5173/'

/** Bug-screenshot regression seeds (must never be harsh). Empty until the screenshots arrive. */
const REGRESSION_SEEDS: number[] = []

const { HARSH_MAX } = await import('../src/lib/quality')

const custom = process.env.SEEDS ? process.env.SEEDS.split(',').map(Number).filter(Number.isFinite) : null
const SEEDS = custom ?? [...REGRESSION_SEEDS, ...Array.from({ length: 200 }, (_, i) => 3001 + i)]

const BATCH = 20
const tpl = await Bun.file(ROOT + '/scripts/_harshness.txt').text()

const all: Array<{
  seed: number
  error?: string
  harsh?: number
  finalOk?: boolean
  codes?: string[]
  attempts?: number
  firstHarsh?: number | null
  rescued?: boolean
}> = []

for (let b = 0; b < SEEDS.length; b += BATCH) {
  const seeds = SEEDS.slice(b, b + BATCH)
  console.log(`harshness: batch ${b / BATCH + 1}/${Math.ceil(SEEDS.length / BATCH)} (seeds ${seeds[0]}..${seeds[seeds.length - 1]})…`)
  const expr = tpl.replace('const SEEDS = __SEEDS__', `const SEEDS = ${JSON.stringify(seeds)}`)
  const exprFile = `/tmp/opencode/harsh-${seeds[0]}.txt`
  await Bun.write(exprFile, expr)
  let rows = null
  for (let attempt = 0; attempt < 2 && !rows; attempt++) {
    const proc = Bun.spawn(['bun', 'scripts/cdp-eval.ts', URL_, exprFile, '12000'], {
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: ROOT,
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    void stderr
    void exitCode
    const body = stdout.split('--- console ---')[0].trim()
    try {
      const data = JSON.parse(body) as { rows: typeof all }
      if (Array.isArray(data.rows) && data.rows.length === seeds.length) rows = data.rows
    } catch {
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  if (!rows) throw new Error(`batch ${seeds[0]} failed twice`)
  all.push(...rows)
}

const ok = all.filter((r) => !r.error && r.harsh !== undefined)
const hs = ok.map((r) => r.harsh as number).sort((a, b) => a - b)
const q = (p: number): number => hs[Math.min(hs.length - 1, Math.floor(p * hs.length))] ?? NaN
const above = (t: number): number => hs.filter((h) => h > t).length
console.log(`measured ${ok.length}/${all.length} rows`)
console.log(`harshness p50=${q(0.5).toFixed(2)} p75=${q(0.75).toFixed(2)} p90=${q(0.9).toFixed(2)} p95=${q(0.95).toFixed(2)} max=${q(1).toFixed(2)}`)
console.log(`share above HARSH_MAX (${HARSH_MAX}): ${above(HARSH_MAX)}/${ok.length}`)
const harshFinals = ok.filter((r) => (r.codes ?? []).includes('harsh'))
console.log(`finals carrying harsh verdict: ${harshFinals.length}`)
const regFails = ok.filter((r) => REGRESSION_SEEDS.includes(r.seed) && (r.codes ?? []).includes('harsh'))
for (const r of regFails) console.log(`  REGRESSION FAIL seed ${r.seed} harsh=${r.harsh}`)
const fails: string[] = []
if (q(0.5) > HARSH_MAX) fails.push(`median harshness ${q(0.5).toFixed(2)} above the limit — gate miscalibrated`)
if (regFails.length) fails.push(`${regFails.length} regression seeds harsh`)
for (const f of fails) console.log(`  FAIL ${f}`)
console.log(fails.length ? 'RESULT: FAIL' : 'RESULT: PASS')
process.exit(fails.length ? 1 : 0)
