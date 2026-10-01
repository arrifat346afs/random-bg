import type { BackgroundSpec } from '@/lib/schema'
import { useProjectStore } from '@/store/projectStore'
import { Button } from '@/components/ui/button'
import { defaultBackground } from '@/lib/project'
import { ColorRow } from './ColorRow'
import { Label } from '@/components/ui/label'

export function BackgroundEditor() {
  const bg = useProjectStore((s) => s.project.canvas.bg)

  const set = (next: BackgroundSpec) =>
    useProjectStore.getState().patchProject((p) => ({ ...p, canvas: { ...p.canvas, bg: next } }))

  const kinds: { value: BackgroundSpec['kind']; label: string }[] = [
    { value: 'transparent', label: 'Transparent' },
    { value: 'solid', label: 'Solid' },
    { value: 'gradient', label: 'Gradient' },
    { value: 'noise', label: 'Noise' },
  ]

  return (
    <>
      <div className="grid grid-cols-4 gap-1">
        {kinds.map((k) => (
          <button
            key={k.value}
            onClick={() => {
              if (k.value === 'transparent') set({ kind: 'transparent' })
              else if (k.value === 'solid') set({ kind: 'solid', color: '#0b0d14' })
              else if (k.value === 'gradient')
                set({ kind: 'gradient', from: '#0b0d14', to: '#1b2340', angle: 135 })
              else set({ kind: 'noise', color: '#0b0d14', amount: 0.35 })
            }}
            className={`rounded-md border px-1.5 py-1.5 text-[11px] transition-colors ${
              bg.kind === k.value ? 'border-primary bg-primary/10' : 'hover:bg-accent'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground">
        Transparent keeps the alpha channel clean — exports get a checkerboard in the file dialog
        so you can verify there is no dark fringe.
      </p>

      {bg.kind === 'solid' && (
        <ColorRow label="Colour" value={bg.color} onChange={(color) => set({ kind: 'solid', color })} />
      )}

      {bg.kind === 'gradient' && (
        <>
          <ColorRow
            label="From"
            value={bg.from}
            onChange={(from) => set({ ...bg, from })}
          />
          <ColorRow label="To" value={bg.to} onChange={(to) => set({ ...bg, to })} />
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-xs">Angle</Label>
              <span className="text-[10px] tabular-nums text-muted-foreground">{bg.angle}°</span>
            </div>
            <input
              type="range"
              min={0}
              max={360}
              value={bg.angle}
              onChange={(e) => set({ ...bg, angle: Number(e.target.value) })}
              className="w-full accent-[var(--primary)]"
              aria-label="Gradient angle"
            />
          </div>
        </>
      )}

      {bg.kind === 'noise' && (
        <>
          <ColorRow label="Colour" value={bg.color} onChange={(color) => set({ ...bg, color })} />
          <div>
            <div className="mb-1 flex items-center justify-between">
              <Label className="text-xs">Amount</Label>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {bg.amount.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={bg.amount}
              onChange={(e) => set({ ...bg, amount: Number(e.target.value) })}
              className="w-full accent-[var(--primary)]"
              aria-label="Noise amount"
            />
          </div>
        </>
      )}

      <Button size="sm" variant="ghost" onClick={() => set(defaultBackground())}>
        Reset to transparent
      </Button>
    </>
  )
}
