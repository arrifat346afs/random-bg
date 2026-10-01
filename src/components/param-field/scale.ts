/** Rounding and log-scale mapping for numeric parameter fields. */
export function logToNorm(v: number, min: number, max: number): number {
  const a = Math.log(Math.max(1e-6, min || 1e-6))
  const b = Math.log(max)
  return (Math.log(Math.max(1e-6, v)) - a) / (b - a || 1)
}

export function normToLog(t: number, min: number, max: number): number {
  const a = Math.log(Math.max(1e-6, min || 1e-6))
  const b = Math.log(max)
  return Math.exp(a + t * (b - a))
}

export function round(v: number, step: number): number {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)) || 2)
  return Number(v.toFixed(decimals))
}
