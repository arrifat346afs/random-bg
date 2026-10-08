import { describe, expect, test } from 'bun:test'
import { createRng } from './rng'
import { BLUR_FILTER_TYPES, randomLayer, randomProject } from './randomize'
import { defaultRandomPool } from './random-pool'
import { composeIR, type LayerResult } from './pipeline'
import { buildIR, type Node } from './ir'
import { createLayer } from './project'

const blurryNodes: Node[] = [
  { g: { k: 'circle', x: 50, y: 50, r: 20 }, fill: { k: 'solid', c: '#ff8800' }, blur: 6 },
  { g: { k: 'path', d: 'M0 0L10 10' }, stroke: { k: 'solid', c: '#00ff00' }, sw: 4, blur: 3 },
  { g: { k: 'rect', x: 0, y: 0, w: 10, h: 10 }, fill: { k: 'solid', c: '#0000ff' } },
]

function resultsFor(projectSeed: number, layerId: string): LayerResult[] {
  return [{ ir: buildIR(200, 200, blurryNodes), layerId, truncated: false, key: `k${projectSeed}`, ms: 0 }]
}

describe('random pool blur toggle', () => {
  test('blur-banned pool flags the project noBlur; default pool leaves it absent', () => {
    const banned = randomProject(999, { pool: { ...defaultRandomPool(), allowBlur: false } })
    expect(banned.noBlur).toBe(true)
    const def = randomProject(999, { pool: defaultRandomPool() })
    expect(def.noBlur).toBeUndefined()
    const legacy = randomProject(999)
    expect(legacy.noBlur).toBeUndefined()
  })

  test('composeIR strips every node blur for noBlur projects only', () => {
    const layer = createLayer('bokeh', 1)
    const base = randomProject(999, { pool: { ...defaultRandomPool(), allowBlur: false } })
    const project = { ...base, layers: [{ ...layer, visible: true }] }
    const results = resultsFor(999, project.layers[0].id)
    const stripped = composeIR(project, results)
    expect(stripped.stats.blurs).toBe(0)
    for (const n of stripped.nodes) expect(n.blur).toBeUndefined()
    // geometry and paint survive the strip
    expect(stripped.nodes.length).toBe(blurryNodes.length)

    const plain = { ...project, noBlur: undefined }
    const kept = composeIR(plain, results)
    expect(kept.stats.blurs).toBe(2)
  })

  test('blur-banned pool excludes blur filters from random stacks', () => {
    const pool = { ...defaultRandomPool(), allowBlur: false }
    const rng = createRng(12345)
    for (let i = 0; i < 30; i++) {
      const layer = randomLayer({ rng, pool })
      for (const f of layer.filters ?? []) {
        expect(BLUR_FILTER_TYPES.has(f.type)).toBe(false)
      }
    }
  })

  test('default pool can still roll blur filters', () => {
    const pool = defaultRandomPool()
    const rng = createRng(12345)
    let sawBlurFilter = false
    for (let i = 0; i < 60; i++) {
      const layer = randomLayer({ rng, pool })
      if ((layer.filters ?? []).some((f) => BLUR_FILTER_TYPES.has(f.type))) sawBlurFilter = true
    }
    expect(sawBlurFilter).toBe(true)
  })
})
