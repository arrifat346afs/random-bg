/**
 * scripts/wallpaper-sheet.ts — wallpaper seeds at 4K downsampled + 100% crops.
 *
 * Usage: bun run scripts/wallpaper-sheet.ts [flowWaves|ribbonFlow]
 * Writes outputs/wallpaper-<gen>-8.png, outputs/wallpaper-<gen>-crops.png,
 * and individual outputs/wallpaper-crop-<seed>.png (worst 200x200 @1x, 2x).
 */

const ROOT = import.meta.dir + '/..'
const URL_ = process.env.APP_URL ?? 'http://localhost:5173/'

const GEN = process.argv[2] ?? 'flowWaves'
const SEEDS = GEN === 'ribbonFlow'
  ? [6201, 6202, 6203, 6204, 6205, 6206, 6207, 6208]
  : [6101, 6102, 6103, 6104, 6105, 6106, 6107, 6108]

const tpl = await Bun.file(ROOT + '/scripts/_wallpaper-sheet.txt').text()
const expr = tpl
  .replace('const GEN = __GEN__', `const GEN = ${JSON.stringify(GEN)}`)
  .replace('const SEEDS = __SEEDS__', `const SEEDS = ${JSON.stringify(SEEDS)}`)
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
  rows: Array<{ seed: number; detail: string; white: number; hues: number; maxStep: number; maskedMax: number; maskedCov: number; nodes: number }>
  thumbs: Array<{ seed: number; url: string }>
  crops: Array<{ seed: number; url: string }>
}
console.log('seed  detail   white% hues maxStep masked/maxCov nodes')
for (const r of data.rows) {
  console.log(
    `${r.seed}  ${r.detail.padEnd(8)}${String(r.white).padStart(6)}${String(r.hues).padStart(5)}${String(r.maxStep).padStart(8)}${String(r.maskedMax).padStart(7)}/${r.maskedCov}%${String(r.nodes).padStart(6)}`,
  )
}

const stitch = async (items: Array<{ url: string }>, labels: string[], cols: number, tw: number, th: number, title: string, out: string) => {
  const sheetExpr = `(() => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const work = async () => {
      const sheet = document.createElement('canvas');
      const PAD = 8, LABEL = 20, HEADER = 34;
      const cw = ${tw} + PAD * 2, ch = ${th} + LABEL + PAD * 2;
      const rows = Math.ceil(${items.length} / ${cols});
      sheet.width = cw * ${cols};
      sheet.height = HEADER + ch * rows;
      const g = sheet.getContext('2d');
      g.fillStyle = '#14141a';
      g.fillRect(0, 0, sheet.width, sheet.height);
      g.fillStyle = '#e8e8ee';
      g.font = 'bold 15px ui-monospace, monospace';
      g.fillText(${JSON.stringify(title)}, 12, 22);
      const urls = ${JSON.stringify(items.map((t) => t.url))};
      const names = ${JSON.stringify(labels)};
      for (let i = 0; i < urls.length; i++) {
        const img = new Image();
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = urls[i]; });
        const cx = (i % ${cols}) * cw, cy = HEADER + Math.floor(i / ${cols}) * ch;
        g.drawImage(img, cx + PAD, cy + PAD, ${tw}, ${th});
        g.fillStyle = '#b9b9c6';
        g.font = '11px ui-monospace, monospace';
        g.fillText(names[i], cx + PAD, cy + PAD + ${th} + 14);
        await sleep(0);
      }
      return JSON.stringify({ png: sheet.toDataURL('image/png') });
    };
    return Promise.race([work(), sleep(120000).then(() => 'TIMEOUT-120s')]);
  })()`
  const f = '/tmp/opencode/wallpaper-stitch.txt'
  await Bun.write(f, sheetExpr)
  const p2 = Bun.spawn(['bun', 'scripts/cdp-eval.ts', URL_, f, '12000'], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: ROOT,
  })
  const [sout] = await Promise.all([
    new Response(p2.stdout).text(),
    new Response(p2.stderr).text(),
    p2.exited,
  ])
  const sbody = sout.split('--- console ---')[0].trim()
  if (!sbody || sbody.startsWith('ERROR') || sbody.startsWith('TIMEOUT')) {
    console.error(`stitch failed for ${out}`)
    console.error(sbody.slice(0, 500))
    process.exit(1)
  }
  const spng = (JSON.parse(sbody) as { png: string }).png
  await Bun.write(`${ROOT}/outputs/${out}`, Uint8Array.from(atob(spng.slice(spng.indexOf(',') + 1)), (c) => c.charCodeAt(0)))
  console.log(`sheet → outputs/${out}`)
}

await stitch(
  data.thumbs,
  data.rows.map((r) => `#${r.seed} ${r.detail} white ${r.white}% hues ${r.hues} masked ${r.maskedMax}`),
  4, 480, 270,
  `${GEN} — 8 seeds at 4K downsampled`,
  `wallpaper-${GEN}-8.png`,
)
await stitch(
  data.crops,
  data.rows.map((r) => `#${r.seed} worst 200x200 @1x 2x (masked ${r.maskedMax})`),
  4, 400, 400,
  `${GEN} — worst 200x200 crops at 100%, enlarged 2x`,
  `wallpaper-${GEN}-crops.png`,
)
for (let i = 0; i < data.crops.length; i++) {
  const seed = data.rows[i].seed
  await Bun.write(
    `${ROOT}/outputs/wallpaper-crop-${seed}.png`,
    Uint8Array.from(atob(data.crops[i].url.slice(data.crops[i].url.indexOf(',') + 1)), (x) => x.charCodeAt(0)),
  )
}
console.log('crops → outputs/wallpaper-crop-<seed>.png')
