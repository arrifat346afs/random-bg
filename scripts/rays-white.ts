/**
 * scripts/rays-white.ts — rays generator white + edge audit.
 *
 * 100 single-layer soft-rays rolls: none may exceed 3% composite pure white
 * or an 8% contiguous white region. Beam edge check: soft 1px luminance
 * steps must stay under the sharp threshold that classic hard polygons blow
 * past (printed for contrast). Also writes `outputs/rays-12.png` (12 soft
 * ray projects) for human review.
 *
 * Usage: bun run scripts/rays-white.ts   (dev server must be up)
 */

const ROOT = import.meta.dir + '/..'
const URL_ = process.env.APP_URL ?? 'http://localhost:5173/'

/** 1px-step above which a beam edge reads hard (calibrated soft vs classic). */
const EDGE_SHARP = 90

const proc = Bun.spawn(['bun', 'scripts/cdp-eval.ts', URL_, ROOT + '/scripts/_rays-probe.txt', '12000'], {
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
  console.error('rays-white: in-page run failed')
  console.error(body.slice(0, 1000))
  process.exit(1)
}
const data = JSON.parse(body) as {
  soft: Array<{ seed: number; white: number; region: number; mode: string }>
  classicSteps: number[]
  softSteps: number[]
  thumbs: Array<{ seed: number; mode: string; step: number; url: string }>
}

const whiteFails = data.soft.filter((r) => r.white > 3 || r.region > 8)
console.log(`soft white audit: ${data.soft.length - whiteFails.length}/${data.soft.length} within 3%/8%`)
for (const f of whiteFails.slice(0, 10)) {
  console.log(`  FAIL seed ${f.seed} [${f.mode}] white=${f.white}% region=${f.region}%`)
}
const whites = data.soft.map((r) => r.white).sort((a, b) => a - b)
console.log(`white p50=${whites[50]}% p95=${whites[94]}% max=${whites[whites.length - 1]}%`)

const sMax = Math.max(...data.softSteps)
const cMax = Math.max(...data.classicSteps)
console.log(`edge 1px-step: soft max=${sMax} (threshold ${EDGE_SHARP}), classic max=${cMax}`)
for (const t of data.thumbs) console.log(`  thumb seed ${t.seed} [${t.mode}] step=${t.step}`)
const edgeFails = data.softSteps.filter((s) => s >= EDGE_SHARP).length
console.log(`soft edge audit: ${data.softSteps.length - edgeFails}/${data.softSteps.length} below threshold`)

// 12-up contact sheet (stitched from data-URLs via canvas in Bun is not
// available — compose a 4x3 grid with a second tiny in-page pass instead).
const sheetExpr = `(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const work = async () => {
    const [rz, ex, cv, svc] = await Promise.all([
      import('/src/lib/randomize.ts'),
      import('/src/lib/export.ts'),
      import('/src/lib/render/canvas.ts'),
      import('/src/lib/render/service.ts'),
    ]);
    const rng0 = (await import('/src/lib/rng.ts')).createRng(5000);
    void rng0;
    const DARK = { kind: 'solid', color: '#0a0a10' };
    const TW = 300, TH = 300, PAD = 8, LABEL = 20, HEADER = 34, COLS = 4;
    const cw = TW + PAD * 2, ch = TH + LABEL + PAD * 2;
    const sheet = document.createElement('canvas');
    sheet.width = cw * COLS;
    sheet.height = HEADER + ch * 3;
    const g = sheet.getContext('2d');
    g.fillStyle = '#14141a';
    g.fillRect(0, 0, sheet.width, sheet.height);
    g.fillStyle = '#e8e8ee';
    g.font = 'bold 15px ui-monospace, monospace';
    g.fillText('soft rays — 12 review thumbs (seeds 5001..5012)', 12, 22);
    const R = (await import('/src/lib/rng.ts'));
    for (let i = 0; i < 12; i++) {
      const rng = R.createRng(5000 + i + 1);
      const layer = rz.randomLayer({ genId: 'rays', rng });
      layer.params = { ...layer.params, style: 'soft' };
      const project = { v: 1, name: 'r', canvas: { w: 1080, h: 1080, bg: DARK }, seed: 5000 + i + 1, palette: { name: 'custom', colors: ['#e9fff9', '#7cf5c4', '#00c2a8', '#032b3a'] }, layers: [layer], groups: [], motion: { drift: 0, twinkle: 0, pulse: 0, flow: 0, speed: 1 } };
      const cx = (i % COLS) * cw, cy = HEADER + Math.floor(i / COLS) * ch;
      g.fillStyle = '#0c0c11';
      g.fillRect(cx + PAD, cy + PAD, TW, TH);
      const out = await svc.requestRender(project, () => {});
      const ir = ex.compositeLayers(project, out.results);
      const c = document.createElement('canvas');
      cv.renderCanvas(ir, c, { scale: TW / ir.w });
      g.drawImage(c, cx + PAD, cy + PAD);
      g.fillStyle = '#b9b9c6';
      g.font = '11px ui-monospace, monospace';
      g.fillText('#' + (i + 1) + ' seed ' + (5000 + i + 1) + ' [' + layer.params.mode + ']', cx + PAD, cy + PAD + TH + 14);
      await sleep(0);
    }
    return JSON.stringify({ png: sheet.toDataURL('image/png') });
  };
  return Promise.race([work(), sleep(120000).then(() => 'TIMEOUT-120s')]);
})()`
const sheetFile = '/tmp/opencode/rays-12.txt'
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
  console.error('rays-white: sheet run failed')
  console.error(sbody.slice(0, 500))
  process.exit(1)
}
const spng = (JSON.parse(sbody) as { png: string }).png
await Bun.write(
  `${ROOT}/outputs/rays-12.png`,
  Uint8Array.from(atob(spng.slice(spng.indexOf(',') + 1)), (c) => c.charCodeAt(0)),
)
console.log('sheet → outputs/rays-12.png')

const ok = whiteFails.length === 0 && edgeFails === 0
console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL')
process.exit(ok ? 0 : 1)
