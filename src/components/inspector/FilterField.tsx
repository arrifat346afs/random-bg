/**
 * inspector/FilterField.tsx — Schema-driven controls for one filter param.
 *
 * Deliberately lighter than `ParamField`: filters have no per-parameter lock
 * (the whole stack is toggled by one eye) and no randomise button (the stack
 * presets cover that), so this is just the control the `ParamDef` asks for.
 */

import type { ParamDef, ParamValue } from '@/lib/schema'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface FilterFieldProps {
  def: ParamDef
  value: ParamValue
  disabled: boolean
  /** namespacing the numeric draft so two filters' "Amount" stay independent */
  draftKey: string
  onChange: (v: ParamValue) => void
}

export function FilterField({ def, value, disabled, draftKey, onChange }: FilterFieldProps) {
  const step = def.step ?? (def.type === 'int' ? 1 : 0.01)

  if (def.type === 'bool') {
    return (
      <div className="flex items-center justify-between gap-3 py-1">
        <span className="text-[11px] text-muted-foreground">{def.label}</span>
        <Switch
          checked={value === true}
          disabled={disabled}
          onCheckedChange={onChange}
          aria-label={def.label}
        />
      </div>
    )
  }

  if (def.type === 'color') {
    return (
      <div className="flex items-center justify-between gap-3 py-1">
        <span className="text-[11px] text-muted-foreground">{def.label}</span>
        <input
          type="color"
          aria-label={def.label}
          disabled={disabled}
          value={typeof value === 'string' && value.startsWith('#') ? value.slice(0, 7) : '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-9 cursor-pointer rounded border border-input bg-background p-0.5 disabled:opacity-50"
        />
      </div>
    )
  }

  if (def.type === 'enum') {
    return (
      <div className="flex items-center justify-between gap-3 py-1">
        <span className="text-[11px] text-muted-foreground">{def.label}</span>
        <Select
          value={String(value)}
          disabled={disabled}
          onValueChange={(v) => {
            const opt = def.options?.find((o) => String(o.value) === v)
            onChange(opt ? (opt.value as ParamValue) : (v as ParamValue))
          }}
        >
          <SelectTrigger className="h-7 w-[130px] text-xs" aria-label={def.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {def.options?.map((o) => (
              <SelectItem key={String(o.value)} value={String(o.value)}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (def.type === 'text' || def.type === 'path') {
    return (
      <div className="py-1">
        <p className="mb-1 text-[11px] text-muted-foreground">{def.label}</p>
        <input
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-full rounded-md border border-input bg-background px-2 font-mono text-[11px]"
        />
      </div>
    )
  }

  /* numeric */
  const v = typeof value === 'number' ? value : Number(def.default)
  const min = def.min ?? 0
  const max = def.max ?? 1
  // wide ranges (blur 0–40, displacement 0–120) are unusable linearly: one
  // pixel of slider moves sigma by 0.4
  const useLog = min > 0 && max / min > 60
  const toSlider = (n: number) => (useLog ? logNorm(n, min, max) : n)
  const fromSlider = (n: number) => (useLog ? logDenorm(n, min, max) : n)

  return (
    <div className="py-1">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] text-muted-foreground">
          {def.label}
          {def.unit && <span className="ml-0.5 opacity-70">{def.unit}</span>}
        </span>
        <input
          type="number"
          aria-label={def.label}
          data-draft-key={draftKey}
          value={Number(v.toFixed(4))}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange(n)
          }}
          className="h-6 w-[74px] shrink-0 rounded border border-input bg-background px-1.5 text-right font-mono text-[11px] disabled:opacity-50"
        />
      </div>
      <Slider
        value={[toSlider(v)]}
        min={useLog ? 0 : min}
        max={useLog ? 1 : max}
        step={useLog ? 0.001 : step}
        disabled={disabled}
        onValueChange={([n]) => onChange(fromSlider(n))}
        aria-label={def.label}
      />
    </div>
  )
}

/** Map [min,max] → [0,1] logarithmically (min must be > 0). */
function logNorm(n: number, min: number, max: number): number {
  const lo = Math.log(Math.max(min, 1e-6))
  const hi = Math.log(max)
  const t = (Math.log(Math.min(Math.max(n, min), max)) - lo) / (hi - lo)
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0
}

function logDenorm(t: number, min: number, max: number): number {
  const lo = Math.log(Math.max(min, 1e-6))
  const hi = Math.log(max)
  return Math.exp(lo + (hi - lo) * t)
}