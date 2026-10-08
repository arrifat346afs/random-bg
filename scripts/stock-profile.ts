/**
 * Stock profile: every generator through the Adobe Stock (adobeCompat) path.
 * Asserts zero <filter> / filter= / fe* / mix-blend-mode / isolation / <style> /
 * class= / <image>, and reports blur→vector expansion sizes.
 *
 * Pixel-diff vs preview (mean abs diff ≤ 6/255 at 1080p) needs a real SVG
 * rasteriser (resvg/librsvg) + canvas; run scripts/filters-parity.ts for the
 * renderer-gated numbers. This script is the structural gate that runs
 * everywhere (bun, no DOM).
 *
 * Run: bun run scripts/stock-profile.ts
 */
import { createProject, createLayer } from '../src/lib/project'
import { generateLayer, activeLayers } from '../src/lib/pipeline'
import { buildIR } from '../src/lib/ir'
import { renderSVG } from '../src/lib/render/svg'
import { GENERATORS } from '../src/lib/generators'
import { toStockIR } from '../src/lib/render/stock'

const fails: string[] = []
const rows: { name: string; nodes: number; blurs: number; out: number; halos: number; bytes: number }[] = []

for (const gen of GENERATORS) {
  const p = createProject({ seed: 777, layers: [] })
  p.layers = [createLayer(gen.id, 777)]
  p.canvas.bg = { kind: 'solid', color: '#101014' }
  try {
    const results = []
    for (const layer of activeLayers(p)) results.push(await generateLayer(layer, p))
    const ir = buildIR(p.canvas.w, p.canvas.h, results.flatMap((r) => r.ir.nodes))
    const conv = toStockIR(ir)
    const svg = renderSVG(ir, { background: p.canvas.bg, adobeCompat: true })
    const bad: string[] = []
    if (/<filter[\s>]/i.test(svg)) bad.push('<filter>')
    if (/\sfilter\s*=/i.test(svg)) bad.push('filter=')
    if (/<fe[A-Za-z]/.test(svg)) bad.push('fe*')
    if (/mix-blend-mode/i.test(svg)) bad.push('mix-blend-mode')
    if (/isolation/i.test(svg)) bad.push('isolation')
    if (/<style[\s>]/i.test(svg)) bad.push('<style>')
    if (/\sclass\s*=/i.test(svg)) bad.push('class=')
    if (/\sstyle\s*=/i.test(svg)) bad.push('style=')
    if (/<image[\s>]/i.test(svg)) bad.push('<image>')
    if (bad.length) fails.push(`${gen.id}: ${bad.join(', ')}`)
    rows.push({ name: gen.id, nodes: ir.stats.count, blurs: ir.stats.blurs, out: conv.nodes.length, halos: conv.haloNodes, bytes: svg.length })
  } catch (e) {
    fails.push(`${gen.id}: ERROR ${e instanceof Error ? e.message : String(e)}`)
  }
}

rows.sort((a, b) => b.out - a.out)
console.log('— stock profile (worst expansion first) —')
for (const r of rows) {
  console.log(
    `${r.name.padEnd(14)} in=${String(r.nodes).padStart(6)} blurs=${String(r.blurs).padStart(5)} out=${String(r.out).padStart(6)} halos=${String(r.halos).padStart(6)} bytes=${String(r.bytes).padStart(8)}`,
  )
}
if (fails.length) {
  console.log('\nFAILURES:')
  for (const f of fails) console.log(`  !! ${f}`)
  process.exit(1)
}
console.log(`\nPASS: ${rows.length} generators, zero filter/blend/isolation/style/image constructs.`)
console.log('NOTE: pixel-diff vs preview (≤6/255 @1080p) is renderer-gated — run where resvg/librsvg is available; worst offenders are the highest halo/out rows above.')
