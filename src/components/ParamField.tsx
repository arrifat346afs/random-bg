import type { ParamDef, ParamValue } from '@/lib/schema'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LockButton } from './param-field/LockButton'
import { NumInput } from './param-field/NumInput'
import { RandomButton } from './param-field/RandomButton'
import { logToNorm, normToLog } from './param-field/scale'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export interface ParamFieldProps {
  /** owning layer, so each field's uncommitted draft is its own */
  layerId: string
  def: ParamDef
  value: ParamValue
  locked: boolean
  onChange: (v: ParamValue) => void
  onToggleLock: () => void
  onRandomize: () => void
}

/** Slider + numeric input + lock + per-parameter randomise. */
export function ParamField({
  def,
  value,
  locked,
  onChange,
  onToggleLock,
  onRandomize,
  layerId,
}: ParamFieldProps) {
  const step = def.step ?? (def.type === 'int' ? 1 : 0.01)

  if (def.type === 'bool') {
    return (
      <div className="flex items-center justify-between gap-3 py-1.5">
        <div className="min-w-0">
          <Label htmlFor={`p-${def.key}`} className="cursor-pointer">
            {def.label}
          </Label>
          {def.hint && <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{def.hint}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <LockButton locked={locked} onToggle={onToggleLock} label={def.label} />
          <Switch
            id={`p-${def.key}`}
            checked={value === true}
            disabled={locked}
            onCheckedChange={(v) => onChange(v)}
          />
        </div>
      </div>
    )
  }

  if (def.type === 'enum') {
    return (
      <div className="grid grid-cols-[1fr_auto] items-center gap-2 py-1.5">
        <div className="min-w-0">
          <Label htmlFor={`p-${def.key}`}>{def.label}</Label>
          {def.hint && <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{def.hint}</p>}
        </div>
        <div className="flex items-center gap-1">
          <LockButton locked={locked} onToggle={onToggleLock} label={def.label} />
          <Select
            value={String(value)}
            disabled={locked}
            onValueChange={(v) => {
              const opt = def.options?.find((o) => String(o.value) === v)
              onChange(opt ? (opt.value as ParamValue) : (v as ParamValue))
            }}
          >
            <SelectTrigger className="w-[140px]" aria-label={def.label}>
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
      </div>
    )
  }

  if (def.type === 'color') {
    return (
      <div className="flex items-center justify-between gap-3 py-1.5">
        <Label htmlFor={`p-${def.key}`}>{def.label}</Label>
        <div className="flex items-center gap-1.5">
          <LockButton locked={locked} onToggle={onToggleLock} label={def.label} />
          <input
            id={`p-${def.key}`}
            type="color"
            disabled={locked}
            value={typeof value === 'string' && value.startsWith('#') ? value.slice(0, 7) : '#ffffff'}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 w-9 cursor-pointer rounded border border-input bg-background p-0.5"
          />
        </div>
      </div>
    )
  }

  if (def.type === 'text' || def.type === 'path') {
    return (
      <div className="py-1.5">
        <div className="mb-1 flex items-center justify-between gap-2">
          <Label htmlFor={`p-${def.key}`}>{def.label}</Label>
          <div className="flex items-center gap-1">
            <LockButton locked={locked} onToggle={onToggleLock} label={def.label} />
            <RandomButton onClick={onRandomize} label={def.label} />
          </div>
        </div>
        {def.type === 'path' ? (
          <textarea
            id={`p-${def.key}`}
            value={typeof value === 'string' ? value : ''}
            disabled={locked}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            placeholder="M0 0 L100 0 L100 100 Z"
            className="h-20 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          />
        ) : (
          <Input
            id={`p-${def.key}`}
            value={typeof value === 'string' ? value : ''}
            disabled={locked}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {def.hint && <p className="mt-1 text-[10px] text-muted-foreground">{def.hint}</p>}
      </div>
    )
  }

  if (def.type === 'range' && Array.isArray(value)) {
    const lo = value[0]
    const hi = value[1]
    return (
      <div className="py-1.5">
        <div className="mb-1 flex items-center justify-between">
          <Label>{def.label}</Label>
          <LockButton locked={locked} onToggle={onToggleLock} label={def.label} />
        </div>
        <div className="flex items-center gap-2">
          <NumInput
            value={lo}
            min={def.min}
            max={def.max}
            step={step}
            disabled={locked}
            draftKey={`${layerId}:${def.key}-lo`}
            onChange={(v) => onChange([v, hi])}
          />
          <span className="text-[10px] text-muted-foreground">→</span>
          <NumInput
            value={hi}
            min={def.min}
            max={def.max}
            step={step}
            disabled={locked}
            draftKey={`${layerId}:${def.key}-hi`}
            onChange={(v) => onChange([lo, v])}
          />
        </div>
      </div>
    )
  }

  /* numeric (float / int) */
  const numValue = typeof value === 'number' ? value : Number(def.default)
  const min = def.min ?? 0
  const max = def.max ?? 1
  const useLog = max / Math.max(min, 0.001) > 60 && min >= 0

  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Label htmlFor={`p-${def.key}`} className="flex min-w-0 items-center gap-1">
          <span className="truncate">{def.label}</span>
          {def.unit && <span className="text-[10px] font-normal text-muted-foreground">{def.unit}</span>}
        </Label>
        <div className="flex shrink-0 items-center gap-0.5">
          <LockButton locked={locked} onToggle={onToggleLock} label={def.label} />
          <RandomButton onClick={onRandomize} label={def.label} />
          <NumInput
            id={`p-${def.key}`}
            value={numValue}
            min={min}
            max={max}
            step={step}
            disabled={locked}
            draftKey={`${layerId}:${def.key}`}
            onChange={onChange}
          />
        </div>
      </div>
      <Slider
        value={[useLog ? logToNorm(numValue, min, max) : numValue]}
        min={useLog ? 0 : min}
        max={useLog ? 1 : max}
        step={useLog ? 0.001 : step}
        disabled={locked}
        onValueChange={([v]) => onChange(useLog ? normToLog(v, min, max) : v)}
        aria-label={def.label}
      />
      {def.hint && <p className="mt-1 text-[10px] leading-tight text-muted-foreground">{def.hint}</p>}
    </div>
  )
}

/* ---- helpers ------------------------------------------------------------- */

/** Log-ish slider mapping so wide ranges stay usable. */
