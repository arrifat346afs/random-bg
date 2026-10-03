/**
 * render/path.ts — the SVG path parser.
 *
 * Pure: it only ever calls methods on the context-like object it is handed, so
 * the same function paints a canvas path and records an extent (see
 * `bounds.pathBounds`, which passes a stub context). Lives apart from
 * `render/canvas.ts` so `bounds.ts` can measure a path without importing a
 * module that imports `bounds.ts`.
 *
 * We only ever consume path data produced by our own builders, so a full spec
 * implementation is unnecessary — but arcs are handled for user-imported SVG
 * shapes in the scatter generator.
 */

/** The subset of the 2D context this parser touches. */
export interface PathSink {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  bezierCurveTo(a: number, b: number, c: number, d: number, x: number, y: number): void
  quadraticCurveTo(a: number, b: number, x: number, y: number): void
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number): void
  closePath(): void
}

/**
 * Replay `d` onto `sink`. Absolute and relative M/L/H/V/C/Q/A/Z, plus lowercase
 * variants. Unparseable input is skipped rather than thrown on: a hand-edited
 * project must still render its other layers.
 */
export function drawSvgPath(sink: PathSink, d: string): void {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g)
  if (!tokens) return
  let i = 0
  let cmd = ''
  let x = 0
  let y = 0
  let sx = 0
  let sy = 0
  const num = () => {
    const v = parseFloat(tokens[i++])
    return Number.isFinite(v) ? v : 0
  }
  while (i < tokens.length) {
    const t = tokens[i]
    if (/[a-zA-Z]/.test(t)) {
      cmd = t
      i++
    } else if (!cmd) {
      i++
      continue
    }
    switch (cmd) {
      case 'M': {
        x = num()
        y = num()
        sink.moveTo(x, y)
        sx = x
        sy = y
        cmd = 'L'
        break
      }
      case 'm': {
        x += num()
        y += num()
        sink.moveTo(x, y)
        sx = x
        sy = y
        cmd = 'l'
        break
      }
      case 'L': {
        x = num()
        y = num()
        sink.lineTo(x, y)
        break
      }
      case 'l': {
        x += num()
        y += num()
        sink.lineTo(x, y)
        break
      }
      case 'H': {
        x = num()
        sink.lineTo(x, y)
        break
      }
      case 'h': {
        x += num()
        sink.lineTo(x, y)
        break
      }
      case 'V': {
        y = num()
        sink.lineTo(x, y)
        break
      }
      case 'v': {
        y += num()
        sink.lineTo(x, y)
        break
      }
      case 'C': {
        const a = num()
        const b = num()
        const c = num()
        const e = num()
        x = num()
        y = num()
        sink.bezierCurveTo(a, b, c, e, x, y)
        break
      }
      case 'c': {
        const a = x + num()
        const b = y + num()
        const c = x + num()
        const e = y + num()
        x += num()
        y += num()
        sink.bezierCurveTo(a, b, c, e, x, y)
        break
      }
      case 'Q': {
        const a = num()
        const b = num()
        x = num()
        y = num()
        sink.quadraticCurveTo(a, b, x, y)
        break
      }
      case 'q': {
        const a = x + num()
        const b = y + num()
        x += num()
        y += num()
        sink.quadraticCurveTo(a, b, x, y)
        break
      }
      case 'A': {
        const rx = num()
        const ry = num()
        num() // x-axis-rotation
        num() // large-arc
        num() // sweep
        x = num()
        y = num()
        sink.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2)
        break
      }
      case 'a': {
        const rx = num()
        const ry = num()
        num()
        num()
        num()
        x += num()
        y += num()
        sink.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), 0, 0, Math.PI * 2)
        break
      }
      case 'Z':
      case 'z':
        sink.closePath()
        x = sx
        y = sy
        break
      default:
        i++
    }
  }
}