/**
 * scripts/regression.ts — harshness positive/negative controls.
 *
 * Positives (hand-made from bug screenshots, fixed JSON): must score ABOVE
 * the harshness limit before rescue and BELOW it after `softenHarsh`.
 * Negatives (calm pinned presets): must stay BELOW the limit untouched.
 * Prints every score with its margin to the limit.
 *
 * Usage: bun run scripts/regression.ts   (dev server must be up)
 */

const ROOT = import.meta.dir + '/..'
const URL_ = process.env.APP_URL ?? 'http://localhost:5173/'

const { HARSH_MAX } = await import('../src/lib/quality')

const proc = Bun.spawn(['bun', 'scripts/cdp-eval.ts', URL_, ROOT + '/scripts/_regression.txt', '12000'], {
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
if (!body || body.startsWith('ERROR') || body.startsWith('TIMEOUT')) {
  console.error('regression: in-page run failed')
  console.error(body.slice(0, 1000))
  process.exit(1)
}
const data = JSON.parse(body) as {
  rows: Array<{ kind: string; id: string; error?: string; pre?: number; preCodes?: string[]; post?: number | null; postCodes?: string[] | null; diag?: any }>
}

const fails: string[] = []
console.log(`limit HARSH_MAX=${HARSH_MAX}`)
for (const r of data.rows) {
  if (r.error) {
    console.log(`${r.kind} ${r.id}: ${r.error}`)
    fails.push(`${r.id}: ${r.error}`)
    continue
  }
  if (r.kind === 'positive') {
    const preOk = (r.pre ?? 0) > HARSH_MAX
    const postOk = (r.post ?? 99) <= HARSH_MAX && !(r.postCodes ?? []).includes('harsh')
    console.log(
      `positive ${r.id}: pre=${r.pre} (margin +${((r.pre ?? 0) - HARSH_MAX).toFixed(2)}) [${(r.preCodes ?? []).join(',')}] → post=${r.post} (margin ${((r.post ?? 0) - HARSH_MAX).toFixed(2)}) [${(r.postCodes ?? []).join(',')}] diag=${JSON.stringify(r.diag)}`,
    )
    if (!preOk) fails.push(`${r.id}: pre-rescue ${r.pre} not above the limit`)
    if (!postOk) fails.push(`${r.id}: post-rescue still harsh (${r.post})`)
  } else {
    const ok = (r.pre ?? 99) <= HARSH_MAX && !(r.preCodes ?? []).includes('harsh')
    console.log(`negative ${r.id}: score=${r.pre} (margin ${((r.pre ?? 0) - HARSH_MAX).toFixed(2)}) [${(r.preCodes ?? []).join(',')}]`)
    if (!ok) fails.push(`${r.id}: negative control harsh (${r.pre})`)
  }
}
for (const f of fails) console.log(`  FAIL ${f}`)
console.log(fails.length ? 'RESULT: FAIL' : 'RESULT: PASS')
process.exit(fails.length ? 1 : 0)
