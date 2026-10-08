import { describe, expect, test } from 'bun:test'
import { blurredDiscStops, erfc, gaussianEdgeAlpha, toStockIR } from './stock'
import { buildIR, type Node } from '../ir'
import { renderSVG } from './svg'
import { checkStockSvg, stockPasses } from './stock-check'

describe('erfc edge profile', () => {
  test('erfc(0) = 1, centre opaque, far field transparent', () => {
    expect(Math.abs(erfc(0) - 1)).toBeLessThan(1e-6)
    expect(gaussianEdgeAlpha(0, 10, 2)).toBeCloseTo(1, 3)
    expect(gaussianEdgeAlpha(10, 10, 2)).toBeCloseTo(0.5, 3)
    expect(gaussianEdgeAlpha(10 + 6 * 2, 10, 2)).toBeLessThan(0.001)
  })
  test('disc stops: ≥24, rim zero, profile matches blurred disc within 3%', () => {
    const stops = blurredDiscStops('#ff0000', 1, 20, 4)
    expect(stops.length).toBeGreaterThanOrEqual(24)
    expect(stops[stops.length - 1].o).toBe(0)
    for (const s of stops) {
      const R = 20 + 3 * 4
      const expected = gaussianEdgeAlpha(s.t * R, 20, 4)
      expect(Math.abs(s.o - expected)).toBeLessThan(0.03)
    }
  })
})

describe('stock IR conversion', () => {
  test('blurred circle becomes one gradient node, no blur/blend left', () => {
    const nodes: Node[] = [
      { g: { k: 'circle', x: 50, y: 50, r: 20 }, fill: { k: 'solid', c: '#ff8800' }, blur: 6, blend: 'screen', op: 0.9 },
      { g: { k: 'path', d: 'M0 0L10 10' }, stroke: { k: 'solid', c: '#00ff00' }, sw: 4, blur: 3 },
      { g: { k: 'rect', x: 0, y: 0, w: 100, h: 20 }, fill: { k: 'solid', c: '#0000ff' }, blend: 'plus-lighter' },
    ]
    const conv = toStockIR(buildIR(200, 200, nodes))
    expect(conv.blurredNodes).toBe(2)
    expect(conv.flattenedBlends).toBe(2)
    for (const n of conv.nodes) {
      expect(n.blur).toBeUndefined()
      expect(n.blend ?? 'normal').toBe('normal')
    }
    // circle kept as a single node with a radial gradient of ≥24 stops
    const grad = conv.nodes.find((n) => n.g.k === 'circle')
    expect(grad?.fill?.k).toBe('radial')
    if (grad?.fill?.k === 'radial') expect(grad.fill.stops.length).toBeGreaterThanOrEqual(24)
  })
})

describe('stock SVG output', () => {
  test('zero filter/blend/isolation/style/class/image on a blur+blend project', () => {
    const ir = buildIR(1920, 1080, [
      { g: { k: 'circle', x: 200, y: 200, r: 60 }, fill: { k: 'solid', c: '#ff0088' }, blur: 12, blend: 'screen' },
      { g: { k: 'rect', x: 400, y: 300, w: 500, h: 120 }, fill: { k: 'solid', c: '#00aaff' }, blur: 8, blend: 'plus-lighter' },
      { g: { k: 'path', d: 'M10 10L500 500' }, stroke: { k: 'solid', c: '#ffffff' }, sw: 6, blur: 5 },
    ])
    const svg = renderSVG(ir, { background: { kind: 'noise', color: '#0a0a10', amount: 0.16 }, scale: 4, adobeCompat: true })
    expect(svg).not.toMatch(/<filter[\s>]/i)
    expect(svg).not.toMatch(/\sfilter\s*=/i)
    expect(svg).not.toMatch(/<fe[A-Za-z]/)
    expect(svg).not.toMatch(/mix-blend-mode/i)
    expect(svg).not.toMatch(/isolation/i)
    expect(svg).not.toMatch(/<style[\s>]/i)
    expect(svg).not.toMatch(/\sclass\s*=/i)
    expect(svg).not.toMatch(/\sstyle\s*=/i)
    expect(svg).not.toMatch(/<image[\s>]/i)
    expect(svg).not.toContain('xmlns:xlink')
    expect(svg).toContain('viewBox="0 0 1920 1080')
    const rules = checkStockSvg(svg, 7680, 4320, 'my-art-stock.svg')
    expect(stockPasses(rules)).toBe(true)
  })
})
