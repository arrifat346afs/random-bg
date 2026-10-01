/** Numeric input with the store-backed per-field draft. */
import { useUiStore } from '@/store/uiStore'
import { Input } from '@/components/ui/input'
import { round } from './scale'

export function NumInput({
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  id,
  draftKey,
}: {
  value: number
  min?: number
  max?: number
  step: number
  onChange: (v: number) => void
  disabled?: boolean
  id?: string
  /** layer + param identity, so each field's draft is its own */
  draftKey: string
}) {
  const ui = () => useUiStore.getState()
  const stored = useUiStore((s) => s.paramDrafts[draftKey])
  const draft = stored ?? String(round(value, step))
  const setDraft = (t: string) => ui().setParamDraft(draftKey, t)

  // Adopt the upstream value when it changes (undo/redo, randomise) — unless
  // the user is mid-edit in this exact field. Adjusting while rendering is
  // cheaper and safer than syncing in an effect, and `paramDriftsAt` is the
  // store-side memory for "the value this draft was seeded from".
  const driftKey = ui().paramDrifts[draftKey]
  if (driftKey !== value) {
    ui().markParamDrift(draftKey, value)
    ui().clearParamDraft(draftKey)
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
