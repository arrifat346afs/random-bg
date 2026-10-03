/**
 * inspector/fields.tsx — small numeric/select field primitives shared by the
 * inspector tabs.
 *
 * Split out because each is a generic control, not tab-specific logic: they know
 * nothing about generators, and are reused across Params, Distribute and
 * Effects.
 */

import { renderMaskDataURL } from '@/lib/mask'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { DistField } from './schema'
import { useUiStore } from '@/store/uiStore'

export function MiniToggle({
  active,
  onClick,
  label,
  disabled,
  children,
}: {
  active?: boolean
  onClick: () => void
  label: string
  /** greyed out and inert — for move-up on the first entry, etc. */
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          aria-pressed={!!active}
          disabled={disabled}
          onClick={onClick}
          className={`h-6 w-6 ${active ? 'text-primary' : 'text-muted-foreground'}`}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/* ---- params tab ----------------------------------------------------------- */

export function DistNumField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: DistField
  value: unknown
  onChange: (v: number | string) => void
  disabled?: boolean
}) {
  if (field.options) {
    return (
      <div className="grid grid-cols-[1fr_130px] items-center gap-2 py-1">
        <Label className="text-xs">{field.label}</Label>
        <Select
          value={String(value)}
          disabled={disabled}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger className="h-7 text-[11px]" aria-label={field.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }
  const num = typeof value === 'number' ? value : Number(value)
  const step = field.step ?? 0.01
  return (
    <div className="py-1">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Label className="text-xs">
          {field.label}
          {field.unit && <span className="ml-1 font-normal text-muted-foreground">{field.unit}</span>}
        </Label>
        <Input
          type="number"
          value={Number.isFinite(num) ? Number(num.toFixed(4)) : 0}
          min={field.min}
          max={field.max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-6 w-[70px] shrink-0 px-1 text-right text-[11px] tabular-nums"
        />
      </div>
      <Slider
        value={[num]}
        min={field.min ?? 0}
        max={field.max ?? 1}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
        aria-label={field.label}
      />
      {field.hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{field.hint}</p>}
    </div>
  )
}

export function MaskPicker({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const kind = useUiStore((s) => s.maskKind)
  const angle = useUiStore((s) => s.maskAngle)
  const busy = useUiStore((s) => s.maskBusy)
  const ui = () => useUiStore.getState()
  const setKind = (v: 'radial' | 'linear') => ui().patchMask({ kind: v })
  const setAngle = (v: number) => ui().patchMask({ angle: v })
  const setBusy = (v: boolean) => ui().patchMask({ busy: v })

  const paint = () => {
    setBusy(true)
    try {
      onChange(renderMaskDataURL(kind, angle))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={kind} onValueChange={(v) => setKind(v as 'radial' | 'linear')}>
        <SelectTrigger className="w-[110px] h-7 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="radial">Radial</SelectItem>
          <SelectItem value="linear">Linear</SelectItem>
        </SelectContent>
      </Select>
      {kind === 'linear' && (
        <Input
          type="number"
          value={angle}
          min={0}
          max={360}
          onChange={(e) => setAngle(Number(e.target.value))}
          className="h-7 w-[68px] text-right text-[11px]"
        />
      )}
      <Button size="sm" variant="outline" onClick={paint} disabled={busy}>
        {busy ? 'Painting…' : value ? 'Repaint mask' : 'Paint mask'}
      </Button>
      {value && (
        <img src={value} alt="Mask preview" className="h-8 w-8 rounded border object-cover" />
      )}
    </div>
  )
}

/* ---- colour tab ------------------------------------------------------------ */

export function ModSlider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className="py-0.5">
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
        aria-label={label}
      />
    </div>
  )
}

/* end of Inspector */
