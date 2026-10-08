/**
 * stock-check.ts — "Stock check" validator for the Adobe Stock export path.
 *
 * String-level checks on the final SVG plus size/filename rules.
 * Returns one pass/fail row per rule so the dialog can render the list.
 */

export interface StockRule {
  id: string
  label: string
  pass: boolean
  detail: string
}

export const STOCK_MIN_MP = 15.5

export function checkStockSvg(svg: string, width: number, height: number, filename: string): StockRule[] {
  const has = (re: RegExp) => re.test(svg)
  const mp = (width * height) / 1_000_000
  const ascii = /^[\x20-\x7E]+$/.test(filename)
  return [
    {
      id: 'no-filter-elem',
      label: 'No <filter> elements',
      pass: !has(/<filter[\s>]/i),
      detail: has(/<filter[\s>]/i) ? 'Found <filter> — Stock path must expand blurs to gradients.' : 'No <filter> elements.',
    },
    {
      id: 'no-filter-attr',
      label: 'No filter= attributes (no feGaussianBlur, feTurbulence, …)',
      pass: !has(/\sfilter\s*=/i) && !has(/<fe[A-Za-z]/),
      detail:
        has(/\sfilter\s*=/i) || has(/<fe[A-Za-z]/)
          ? 'Found filter references or fe* primitives.'
          : 'No filter attributes or fe* primitives.',
    },
    {
      id: 'no-blend',
      label: 'No blend modes / isolation',
      pass: !has(/mix-blend-mode/i) && !has(/isolation\s*:/i) && !has(/\sisolate\b/i),
      detail:
        has(/mix-blend-mode/i) || has(/isolation\s*:/i)
          ? 'Found mix-blend-mode or isolation.'
          : 'All layers composite as normal.',
    },
    {
      id: 'no-style',
      label: 'No <style> / class attributes',
      pass: !has(/<style[\s>]/i) && !has(/\sclass\s*=/i) && !has(/\sstyle\s*=/i),
      detail:
        has(/<style[\s>]/i) || has(/\sclass\s*=/i) || has(/\sstyle\s*=/i)
          ? 'Found <style>, class= or style=.'
          : 'No stylesheets or classes.',
    },
    {
      id: 'no-raster',
      label: 'No embedded raster',
      pass: !has(/<image[\s>]/i) && !has(/data:image\//i),
      detail: has(/<image[\s>]/i) ? 'Found <image> — Stock vector must be pure vector.' : 'Pure vector, no <image>.',
    },
    {
      id: 'no-editor',
      label: 'No editor metadata',
      pass: !has(/inkscape:/i) && !has(/sodipodi:/i) && !has(/adobe/i),
      detail: 'No Inkscape/editor namespaces.',
    },
    {
      id: 'artboard',
      label: `Artboard ≥ ${STOCK_MIN_MP} MP`,
      pass: mp >= STOCK_MIN_MP,
      detail: `${width}×${height} = ${mp.toFixed(2)} MP${mp >= STOCK_MIN_MP ? '' : ` — below ${STOCK_MIN_MP} MP; raise Scale.`}`,
    },
    {
      id: 'filename',
      label: 'ASCII filename, no @ or (1)',
      pass: ascii && !filename.includes('@') && !filename.includes('(1)'),
      detail: ascii && !filename.includes('@') ? filename : `Rename to ASCII without @: ${filename}`,
    },
    {
      id: 'xml',
      label: 'Valid XML shell',
      pass: svg.startsWith('<svg') && svg.trimEnd().endsWith('</svg>'),
      detail: 'Single <svg> root.',
    },
  ]
}

export function stockPasses(rules: StockRule[]): boolean {
  return rules.every((r) => r.pass)
}
