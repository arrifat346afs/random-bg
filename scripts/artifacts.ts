/**
 * scripts/artifacts.ts — artefact repro + gradient regression probe.
 *
 * Renders fixed suspect configurations in the dev-server page (see
 * `scripts/_artifact-hunt.txt`), prints the column/row luminance-cliff table,
 * and writes `outputs/artifacts.png`. The gradient-only cliff check is the
 * regression test for Fix D(c): a smooth field must have no sharp
 * column/row step.
 *
 * Thresholds: mesh-only maxColStep must stay < 6.0 (a smooth 256 px ramp
 * steps ~1–2 per column); any suspect above 12.0 is flagged for a fix.
 *
 * Usage: bun run scripts/artifacts.ts   (dev server must be up)
 */

const ROOT = import.meta.dir + '/..'
const URL_ = process.env.APP_URL ?? 'http://localhost:5173/'

const proc = Bun.spawn(['bun', 'scripts/cdp-eval.ts', URL_, ROOT + '/scripts/_artifact-hunt.txt', '12000'], {
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
  console.error('artifacts: in-page run failed')
  console.error(body.slice(0, 1000))
  process.exit(1)
}
const data = JSON.parse(body) as {
  rows: Array<{ id: string; why: string; maxColStep: number; atX: number; maxRowStep: number; w: number; h: number; nodes: number }>
  thumbs: Array<{ id: string; url: string }>
}

console.log('id                maxCol  atX   maxRow  nodes')
for (const r of data.rows) {
  const flag = r.id === 'mesh-only' && r.maxColStep >= 6 ? '  <-- REGRESSION' : r.maxColStep >= 12 ? '  <-- sharp' : ''
  console.log(
    `${r.id.padEnd(18)}${String(r.maxColStep).padStart(6)}${String(r.atX).padStart(6)}${String(r.maxRowStep).padStart(7)}${String(r.nodes).padStart(7)}${flag}`,
  )
  console.log(`  ${r.why}`)
}

// contact sheet from the returned data-URLs (decoded + stitched in Bun would
// need an image codec — instead re-emit them side by side via a second tiny
// in-page pass is overkill; the thumbs are inspected individually on demand).
await Bun.$`mkdir -p ${ROOT}/outputs`.quiet()
for (const t of data.thumbs) {
  const b64 = t.url.slice(t.url.indexOf(',') + 1)
  await Bun.write(`${ROOT}/outputs/artifact-${t.id}.png`, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
}
console.log(`thumbs → outputs/artifact-<id>.png`)

const mesh = data.rows.find((r) => r.id === 'mesh-only')
if (mesh && mesh.maxColStep >= 6) {
  console.log('RESULT: FAIL (mesh-only cliff)')
  process.exit(1)
}
console.log('RESULT: PASS')
