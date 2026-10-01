/**
 * scripts/quality20.ts — The randomiser's acceptance gate.
 *
 * Rolls 20 fixed seeds through `randomProjectChecked()` in headless Chrome
 * (the gate needs a DOM and a 2D canvas, so it cannot run in plain Bun), then
 * reports:
 *
 *   • first-try pass rate — how good `randomProject()` is *before* any gate
 *   • final pass rate after reject-and-resample, and the average number of retries
 *   • how many results were blank (must be zero)
 *
 * Also writes the 20-project contact sheet to `outputs/random20.png`.
 *
 * Exits non-zero unless: final ≥ 18/20, first try ≥ 14/20, blank = 0.
 *
 * Usage: bun run scripts/quality20.ts   (dev server must be up)
 */

const URL_ = process.env.APP_URL ?? 'http://127.0.0.1:5199/'
const N = 20
const TARGET_FINAL = 18
const TARGET_FIRST = 14

const proc = Bun.spawn(
  ['bun', 'scripts/cdp-eval.ts', URL_, 'scripts/_quality20.txt', '8000'],
  { stdout: 'pipe', stderr: 'pipe', cwd: import.meta.dir + '/..' },
)
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
])

const body = stdout.split('--- console ---')[0].trim()
if (!body || body.startsWith('ERROR') || body.startsWith('TIMEOUT')) {
  console.error('quality20: the in-page run failed')
  console.error(body.slice(0, 2000))
  console.error(stderr.slice(0, 2000))
  process.exit(1)
}

const data = JSON.parse(body) as {
  rows: Array<Record<string, any>>
  png: string
}
const rows = data.rows
if (rows.length !== N) {
  console.error(`quality20: expected ${N} rows, got ${rows.length}`)
  process.exit(1)
}

/* ---- write the artefacts ------------------------------------------------ */

const outDir = import.meta.dir + '/../outputs'
await Bun.$`mkdir -p ${outDir}`.quiet()

const b64 = data.png.slice(data.png.indexOf(',') + 1)
const png = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
await Bun.write(`${outDir}/random20.png`, png)
await Bun.write(`${outDir}/random20.json`, JSON.stringify(rows, null, 2))

/* ---- report ------------------------------------------------------------- */

const pad = (s: any, n: number) => String(s).padEnd(n)
const padS = (s: any, n: number) => String(s).padStart(n)

console.log('FX Forge — randomise quality gate')
console.log(`20 fixed seeds, gate = reject-and-resample (max 8 tries / 750 ms)`)
console.log('')
console.log(
  pad('#', 4) +
    pad('seed', 12) +
    pad('1st', 6) +
    pad('final', 7) +
    padS('tries', 6) +
    padS('cov%', 8) +
    padS('luma', 7) +
    padS('white%', 8) +
    padS('nodes', 8) +
    pad(' bg', 12) +
    ' reasons',
)
console.log('-'.repeat(108))

let firstPass = 0
let finalPass = 0
let blanks = 0
let budgetHits = 0
let retries = 0
const failures: string[] = []

for (const r of rows) {
  if (r.error) {
    console.log(pad('#' + (r.i + 1), 4) + 'ERROR ' + r.error)
    failures.push(`#${r.i + 1} threw ${r.error}`)
    continue
  }
  if (r.firstOk) firstPass++
  if (r.finalOk) finalPass++
  if (r.hard && r.hard.includes('blank')) blanks++
  if (r.budgetHit) budgetHits++
  retries += Math.max(0, r.attempts - 1)
  if (!r.finalOk) failures.push(`#${r.i + 1} ${r.reasons.join('; ')}`)

  console.log(
    pad('#' + (r.i + 1), 4) +
      pad('0x' + (r.seed >>> 0).toString(16), 12) +
      pad(r.firstOk ? 'pass' : 'FAIL', 6) +
      pad(r.finalOk ? 'pass' : 'FAIL', 7) +
      padS(r.attempts, 6) +
      padS(r.cov.toFixed(1), 8) +
      padS(r.luma.toFixed(0), 7) +
      padS(r.white.toFixed(1), 8) +
      padS(r.nodes, 8) +
      pad(' ' + r.bg, 12) +
      (r.finalOk
        ? r.soft.join(',')
        : (r.hard || []).concat(r.soft || []).join(',')),
  )
}

const avgRetries = retries / N
console.log('')
console.log(`first try (no gate) : ${firstPass}/${N}   target ≥ ${TARGET_FIRST}`)
console.log(`final (with gate)   : ${finalPass}/${N}   target ≥ ${TARGET_FINAL}`)
console.log(`average retries     : ${avgRetries.toFixed(2)}`)
console.log(`blank results       : ${blanks}        target 0`)
console.log(`time-budget hits    : ${budgetHits} (gate returned best-scoring roll)`)
const missed = rows.filter((r) => r.firstOk === false)
if (missed.length) {
  console.log('')
  console.log(`first-try misses (${missed.length}):`)
  for (const r of missed)
    console.log(
      `  #${String(r.i + 1).padStart(2)} hard=[${(r.firstHard || []).join(',')}] soft=[${(r.firstSoft || []).join(',')}]` +
        ` cov=${r.firstCov}% luma=${r.firstLuma} white=${r.firstWhite}% nodes=${r.firstNodes}`,
    )
}
const penalised = rows.filter((r) => r.firstOk && (r.firstSoft || []).length)
if (penalised.length) {
  console.log('')
  console.log(`first-try passes carrying a penalty (${penalised.length}):`)
  for (const r of penalised)
    console.log(`  #${String(r.i + 1).padStart(2)} [${r.firstSoft.join(',')}] bg=${r.bg}`)
}
if (failures.length) {
  console.log('')
  console.log('failures:')
  for (const f of failures) console.log('  ' + f)
}
console.log('')
console.log(`contact sheet → outputs/random20.png  (${(png.length / 1024) | 0} KB)`)
console.log(`per-project metrics → outputs/random20.json`)

const ok = finalPass >= TARGET_FINAL && firstPass >= TARGET_FIRST && blanks === 0
console.log('')
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL')
if (exitCode !== 0) console.error(`(cdp-eval exited ${exitCode}: ${stderr.slice(0, 400)})`)
process.exit(ok ? 0 : 1)
