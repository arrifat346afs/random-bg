import { useState } from 'react'
import type { ParamDef, ParamValue } from '@/lib/schema'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Dices, Lock, LockOpen } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ParamFieldProps {
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
            onChange={(v) => onChange([v, hi])}
          />
          <span className="text-[10px] text-muted-foreground">→</span>
          <NumInput
            value={hi}
            min={def.min}
            max={def.max}
            step={step}
            disabled={locked}
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
            onChange={(v) => onChange(v)}
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

function NumInput({
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  id,
}: {
  value: number
  min?: number
  max?: number
  step: number
  onChange: (v: number) => void
  disabled?: boolean
  id?: string
}) {
  const [draft, setDraft] = useState<string>(String(round(value, step)))
  // Adjust the local draft while rendering when the value changes upstream
  // (undo/redo, randomise) — cheaper and safer than syncing in an effect.
  const [prev, setPrev] = useState({ value, step })
  if (prev.value !== value || prev.step !== step) {
    setPrev({ value, step })
    setDraft(String(round(value, step)))
  }

  const commit = (text: string) => {
    const n = Number(text)
    if (!Number.isFinite(n)) {
      setDraft(String(round(value, step)))
      return
    }
    let v = n
    if (min !== undefined) v = Math.max(min, v)
    if (max !== undefined) v = Math.min(max, v)
    onChange(v)
    setDraft(String(round(v, step)))
  }

  return (
    <Input
      id={id}
      type="number"
      value={draft}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const dir = e.key === 'ArrowUp' ? 1 : -1
          const next = value + dir * step * (e.shiftKey ? 10 : 1)
          const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, next))
          onChange(clamped)
          setDraft(String(round(clamped, step)))
          e.preventDefault()
        }
      }}
      className="h-7 w-[74px] shrink-0 px-1.5 text-right text-xs tabular-nums"
    />
  )
}

function LockButton({ locked, onToggle, label }: { locked: boolean; onToggle: () => void; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={locked ? `Unlock ${label}` : `Lock ${label}`}
          aria-pressed={locked}
          onClick={onToggle}
          className={cn('h-6 w-6 text-muted-foreground', locked && 'text-primary')}
        >
          {locked ? <Lock /> : <LockOpen />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{locked ? 'Locked — randomise skips this' : 'Lock this parameter'}</TooltipContent>
    </Tooltip>
  )
}

function RandomButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Randomise ${label}`}
          onClick={onClick}
          className="h-6 w-6 text-muted-foreground hover:text-primary"
        >
          <Dices />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Randomise this parameter</TooltipContent>
    </Tooltip>
  )
}

function round(v: number, step: number): number {
  const decimals = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)) || 2)
  return Number(v.toFixed(decimals))
}

/** Log-ish slider mapping so wide ranges stay usable. */
function logToNorm(v: number, min: number, max: number): number {
  const a = Math.log(Math.max(1e-6, min || 1e-6))
  const b = Math.log(max)
  return (Math.log(Math.max(1e-6, v)) - a) / (b - a || 1)
}
function normToLog(t: number, min: number, max: number): number {
  const a = Math.log(Math.max(1e-6, min || 1e-6))
  const b = Math.log(max)
  return Math.exp(a + t * (b - a))
}
