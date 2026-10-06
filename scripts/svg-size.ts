/**
 * scripts/svg-size.ts — SVG <image> embed sizes + scaled-view banding.
 *
 * Prints SVG bytes at 1920x1080 and 3840x2160, embedded PNG vs WebP weight,
 * and row-step banding when the SVG is viewed scaled down/up in Chrome.
 *
 * Usage: bun run scripts/svg-size.ts   (dev server must be up)
 */

const ROOT = import.meta.dir + '/..'
const URL_ = process.env.APP_URL ?? 'http://localhost:5173/'

const proc = Bun.spawn(['bun', 'scripts/cdp-eval.ts', URL_, ROOT + '/scripts/_svg-size.txt', '12000'], {
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
  console.error('svg-size: in-page run failed')
  console.error(body.slice(0, 1000))
  process.exit(1)
}
const data = JSON.parse(body) as {
  rows: Array<{ canvas: string; svgBytes: number; pngB64: number; webpB64: number; warnings: string[]; view480: number; viewBig: number }>
}
for (const r of data.rows) {
  const kb = (n: number): string => `${(n / 1024).toFixed(0)} KB`
  console.log(
    `${r.canvas}: svg=${kb(r.svgBytes)} embedded png=${kb(r.pngB64)} webp92=${r.webpB64 > 0 ? kb(r.webpB64) : 'n/a'} view480step=${r.view480} viewBigStep=${r.viewBig}`,
  )
  for (const w of r.warnings) console.log(`  warn: ${w}`)
}
