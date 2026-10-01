/**
 * _probe.ts — how many filtered canvas ops does each preset need per regime?
 * Run: bun run scripts/_probe.ts
 */
import { PRESETS, buildPreset } from '../src/lib/presets'
import { generateProject } from '../src/lib/pipeline'
import type { Node } from '../src/lib/ir'

const SAFE_DIRECT_OPS = 3200
const BATCH_MIN = 6
const bucket = (r: number) => Math.round(Math.log2(Math.max(r, 0.01)) * 16)
const additive = (n: Node) => n.blend === 'plus-lighter'

const rows: string[] = []
let worstBatch = 0
let worstDirect = 0

for (const p of PRESETS) {
  const results = await generateProject(buildPreset(p), { useCache: false })
  let blurred = 0
  let directOps = 0
  let batchOps = 0
  for (const r of results) {
    const ns = r.ir.nodes
    for (const n of ns) if ((n.blur ?? 0) > 0.05) blurred++
    let i = 0
    while (i < ns.length) {
      const n = ns[i]
      const b = (n.blur ?? 0) > 0.05
      if (b && !additive(n)) {
        directOps++
        i++
        continue
      }
      if (b && additive(n)) {
        let j = i
        while (j < ns.length && additive(ns[j])) j++
        const groups = new Map<number, number>()
        for (let k = i; k < j; k++) {
          if ((ns[k].blur ?? 0) <= 0.05) continue
          const key = bucket(ns[k].blur as number)
          groups.set(key, (groups.get(key) ?? 0) + 1)
        }
        for (const size of groups.values()) {
          if (size >= BATCH_MIN) batchOps++
          else batchOps += size // falls back to one filtered draw each
        }
        i = j
        continue
      }
      i++
    }
  }
  const regime = blurred <= SAFE_DIRECT_OPS ? 'direct' : 'batched'
  const ops = regime === 'direct' ? blurred : batchOps + directOps
  worstDirect = Math.max(worstDirect, blurred)
  worstBatch = Math.max(worstBatch, ops)
  rows.push(
    `${p.id.padEnd(26)} blurred ${String(blurred).padStart(5)}  regime ${regime.padEnd(7)}  filtered ops ${String(ops).padStart(5)}`,
  )
}
rows.sort()
console.log(rows.join('\n'))
console.log(`\nworst direct-candidate count: ${worstDirect}`)
console.log(`worst batched filtered ops:   ${worstBatch}`)
