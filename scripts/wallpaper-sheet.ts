/**
 * scripts/wallpaper-sheet.ts — 8 Flow waves seeds at 4K downsampled.
 *
 * Per-seed white share, hue census and row-step stats print to stdout;
 * `outputs/wallpaper-8.png` carries the 4x2 contact sheet for review.
 *
 * Usage: bun run scripts/wallpaper-sheet.ts   (dev server must be up)
 */

const ROOT = import.meta.dir + '/..'
const URL_ = process.env.APP_URL ?? 'http://localhost:5173/'

const seeds = [6101, 6102, 6103, 6104, 6105, 6106, 6107, 6108]
const tpl = await Bun.file(ROOT + '/scripts/_wallpaper-sheet.txt').text()
const expr = tpl.replace('const SEEDS = __SEEDS__', `const SEEDS = ${JSON.stringify(seeds)}`)
const exprFile = '/tmp/opencode/wallpaper-sheet.txt'
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
  console.error('wallpaper-sheet: in-page run failed')
  console.error(body.slice(0, 1000))
  process.exit(1)
}
const data = JSON.parse(body) as {
  rows: Array<{ seed: number; bands: number; variant: string; white: number; hues: number; maxStep: number; nodes: number }>
  thumbs: Array<{ seed: number; url: string }>
}
console.log('seed  bands variant white% hues maxStep nodes')
for (const r of data.rows) {
  console.log(
    `${r.seed}  ${String(r.bands).padStart(5)} ${String(r.variant).padEnd(6)}${String(r.white).padStart(6)}${String(r.hues).padStart(5)}${String(r.maxStep).padStart(8)}${String(r.nodes).padStart(6)}`,
  )
}

// 4x2 contact sheet, stitched in-page (canvas available there)
const sheetExpr = `(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const work = async () => {
    const sheet = document.createElement('canvas');
    sheet.width = 4 * 496;
    sheet.height = 34 + 2 * 305;
    const g = sheet.getContext('2d');
    g.fillStyle = '#14141a';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.fillStyle = '#e8e8ee';
    g.font = 'bold 15px ui-monospace, monospace';
    g.fillText('flow waves — 8 seeds at 4K downsampled', 12, 22);
    const urls = ${JSON.stringify(data.thumbs.map((t) => t.url))};
    const rows = ${JSON.stringify(data.rows.map((r) => `#${r.seed} ${r.bands} bands ${r.variant} white ${r.white}% hues ${r.hues}`))};
    for (let i = 0; i < urls.length; i++) {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = urls[i]; });
      const cx = (i % 4) * 496, cy = 34 + Math.floor(i / 4) * 305;
      g.drawImage(img, cx + 8, cy + 8, 480, 270);
      g.fillStyle = '#b9b9c6';
      g.font = '11px ui-monospace, monospace';
      g.fillText(rows[i], cx + 8, cy + 292);
      await sleep(0);
    }
    return JSON.stringify({ png: sheet.toDataURL('image/png') });
  };
  return Promise.race([work(), sleep(120000).then(() => 'TIMEOUT-120s')]);
})()`
const sheetFile = '/tmp/opencode/wallpaper-sheet-2.txt'
await Bun.write(sheetFile, sheetExpr)
const proc2 = Bun.spawn(['bun', 'scripts/cdp-eval.ts', URL_, sheetFile, '12000'], {
  stdout: 'pipe',
  stderr: 'pipe',
  cwd: ROOT,
})
const [sout] = await Promise.all([
  new Response(proc2.stdout).text(),
  new Response(proc2.stderr).text(),
  proc2.exited,
])
const sbody = sout.split('--- console ---')[0].trim()
if (!sbody || sbody.startsWith('ERROR') || sbody.startsWith('TIMEOUT')) {
  console.error('wallpaper-sheet: stitch failed')
  console.error(sbody.slice(0, 500))
  process.exit(1)
}
const spng = (JSON.parse(sbody) as { png: string }).png
await Bun.write(
  `${ROOT}/outputs/wallpaper-8.png`,
  Uint8Array.from(atob(spng.slice(spng.indexOf(',') + 1)), (c) => c.charCodeAt(0)),
)
console.log('sheet → outputs/wallpaper-8.png')
