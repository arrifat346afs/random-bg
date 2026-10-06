/**
 * scripts/thirty.ts — 30 fresh gated random projects contact sheet.
 *
 * Usage: bun run scripts/thirty.ts   (dev server must be up)
 * Writes outputs/thirty.png (+ gate pass count to stdout).
 */

const ROOT = import.meta.dir + '/..'
const URL_ = process.env.APP_URL ?? 'http://localhost:5173/'

const seeds: number[] = []
for (let i = 0; i < 30; i++) seeds.push(1001 + i)

const tpl = await Bun.file(ROOT + '/scripts/_thirty.txt').text()
const expr = tpl.replace('const SEEDS = __SEEDS_PLACEHOLDER__', `const SEEDS = ${JSON.stringify(seeds)}`)
const exprFile = '/tmp/opencode/thirty.txt'
await Bun.write(exprFile, expr)

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
if (!body || body.startsWith('ERROR') || body.startsWith('TIMEOUT')) {
  console.error('thirty: in-page run failed')
  console.error(body.slice(0, 1000))
  process.exit(1)
}
const data = JSON.parse(body) as { png: string; ok: number; n: number }
const b64 = data.png.slice(data.png.indexOf(',') + 1)
await Bun.write(`${ROOT}/outputs/thirty.png`, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
console.log(`thirty: gate pass ${data.ok}/${data.n} → outputs/thirty.png`)
