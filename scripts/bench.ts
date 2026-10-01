/**
 * bench.ts — how many nodes do presets actually produce, and how many of them
 * need an expensive per-node canvas blur filter? Run: bun run scripts/bench.ts
 */
import { PRESETS, buildPreset } from '../src/lib/presets'
import { generateProject } from '../src/lib/pipeline'

let grand = 0
let grandBlur = 0
let grandMs = 0

for (const p of PRESETS) {
  const t0 = performance.now()
  const project = buildPreset(p)
  const results = await generateProject(project, { useCache: false })
  const ms = performance.now() - t0
  const nodes = results.flatMap((r) => r.ir.nodes)
  const blur = nodes.filter((n) => (n.blur ?? 0) > 0.05).length
  const fade = nodes.filter((n) => n.fade).length
  const max = Math.max(0, ...results.map((r) => r.ir.stats.count))
  grand += nodes.length
  grandBlur += blur
  grandMs += ms
  console.log(
    `${p.id.padEnd(26)} ${String(nodes.length).padStart(6)} nodes  ${String(blur).padStart(5)} blur  ${String(fade).padStart(4)} fade  max/layer ${String(max).padStart(6)}  ${ms.toFixed(0)}ms`,
  )
}
console.log(
  `\nAVERAGE ${Math.round(grand / PRESETS.length)} nodes, ${Math.round(grandBlur / PRESETS.length)} blurred/layer-set, ${(grandMs / PRESETS.length).toFixed(0)}ms`,
)
