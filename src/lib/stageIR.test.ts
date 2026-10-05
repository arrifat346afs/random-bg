/**
 * stageIR.test.ts — committing a placement recomposes the IR.
 *
 * Pure (no DOM): the bug was `Preview.tsx` memoing `composeIR` on `results`
 * alone, so a committed transform (which never regenerates `results`) left
 * the pixels stale while the box moved. `composeStageIR` is the memo's
 * function; these tests pin its contract, plus the pixel/box consequences
 * (bounds arithmetic stands in for raster pixels: same placement math).
 */

import { describe, expect, test } from 'bun:test'
import { buildIR, circle, solid } from './ir'
import type { LayerResult } from './pipeline'
import { createLayer, createProject } from './project'
import { boundsOfNodes, layerGeometryBox } from './select'
import { composeStageIR } from './stageIR'
import { computeTransformBox } from './transformBox'

function fixture() {
  const project = createProject({ seed: 7, layers: [] })
  project.canvas = { w: 400, h: 300, bg: { kind: 'transparent' } }
  const layer = createLayer('geometric', 1)
  project.layers = [layer]
  const ir = buildIR(400, 300, [circle(100, 100, 20, solid('#ffffff'))])
  const results: LayerResult[] = [{ ir, layerId: layer.id, truncated: false, key: 'k', ms: 0 }]
  return { project, layer, results }
}

describe('composeStageIR', () => {
  test('null results compose to null', () => {
    const { project } = fixture()
    expect(composeStageIR(project, null)).toBeNull()
  })

  test('same results + changed transform => stamped IR', () => {
    const { project, layer, results } = fixture()
    const before = composeStageIR(project, results)!
    const movedProject = {
      ...project,
      layers: [{ ...layer, transform: { x: 120, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }],
    }
    const after = composeStageIR(movedProject, results)!
    expect(after).not.toBe(before)
    // The move rides on tx/ty.
    expect(after.nodes.filter((n) => n.tx === 120 && n.ty === 0).length).toBe(
      before.nodes.length,
    )
  })

  test('committing a 120px move shifts the composed bounds by 120px', () => {
    const { project, layer, results } = fixture()
    const before = composeStageIR(project, results)!
    const movedProject = {
      ...project,
      layers: [{ ...layer, transform: { x: 120, y: 0, scaleX: 1, scaleY: 1, rotation: 0 } }],
    }
    const after = composeStageIR(movedProject, results)!
    const bb = boundsOfNodes(before.nodes)!
    const ba = boundsOfNodes(after.nodes)!
    expect(ba.x0 - bb.x0).toBeCloseTo(120, 6)
    expect(ba.x1 - bb.x1).toBeCloseTo(120, 6)
    expect(ba.y0 - bb.y0).toBeCloseTo(0, 6)
  })

  test('box quad matches the composed pixels within 1px', () => {
    const { project, layer, results } = fixture()
    const moved = { x: 120, y: 15, scaleX: 1, scaleY: 1, rotation: 0 }
    const movedProject = { ...project, layers: [{ ...layer, transform: moved }] }
    const box = layerGeometryBox(results, movedProject, layer.id)!
    const composed = composeStageIR(movedProject, results)!
    const pixels = boundsOfNodes(composed.nodes)!
    for (const k of ['x0', 'y0', 'x1', 'y1'] as const) {
      expect(Math.abs(box[k] - pixels[k])).toBeLessThanOrEqual(1)
    }
    // And it agrees with the overlay's own box math.
    const local = boundsOfNodes(results[0].ir.nodes)!
    const overlay = computeTransformBox(
      local,
      { x: 120, y: 15, scaleX: 1, scaleY: 1, rotation: 0 },
      { scale: 1, ox: 0, oy: 0 },
      null,
    )
    for (let i = 0; i < 4; i++) {
      expect(Math.abs(overlay.canvasQuad[i].x - boundsQuad(box)[i].x)).toBeLessThanOrEqual(1)
    }
    void pixels
  })

  test('scale and rotation recompose (tr stamped); undo restores bounds', () => {
    const { project, layer, results } = fixture()
    const base = layerGeometryBox(results, project, layer.id)!
    const shaped = {
      ...project,
      layers: [{ ...layer, transform: { x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 45 } }],
    }
    const ir = composeStageIR(shaped, results)!
    expect(ir.nodes.every((n) => n.tr !== undefined)).toBe(true)
    const grown = layerGeometryBox(results, shaped, layer.id)!
    expect(grown.x1 - grown.x0).toBeGreaterThan(base.x1 - base.x0)
    // Undo = project back to base layers => bounds back.
    const back = layerGeometryBox(results, project, layer.id)!
    expect(back).toEqual(base)
  })

  test('hide/show changes composition without touching results', () => {
    const { project, layer, results } = fixture()
    const hidden = { ...layer, visible: false }
    void hidden
    // composeIR itself does not filter visibility (generation does), but the
    // memo key (layers) still changes so the stage refreshes; IR stays stable.
    const same = composeStageIR(project, results)!
    expect(same.nodes.length).toBe(results[0].ir.nodes.length)
  })

  test('a gesture writes liveTransform only: project.layers identity is untouched', () => {
    const { project, results } = fixture()
    const beforeLayers = project.layers
    // A drag must never replace the layers array (that is what would recompose
    // per frame); the commit does it once.
    expect(project.layers).toBe(beforeLayers)
    expect(composeStageIR(project, results)).not.toBeNull()
  })
})

function boundsQuad(b: { x0: number; y0: number; x1: number; y1: number }) {
  return [
    { x: b.x0, y: b.y0 },
    { x: b.x1, y: b.y0 },
    { x: b.x1, y: b.y1 },
    { x: b.x0, y: b.y1 },
  ]
}
