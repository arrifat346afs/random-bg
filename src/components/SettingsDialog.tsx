import { defaultBackground, createProject } from '@/lib/project'
import {
  SIZE_PRESETS,
  type BackgroundSpec,
  type MotionSpec,
} from '@/lib/schema'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useProjectStore } from '@/store/projectStore'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: Props) {
  const project = useProjectStore((s) => s.project)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>
            Canvas size, background and the motion that drives the animated export.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="canvas" className="flex min-h-0 flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="canvas">Canvas</TabsTrigger>
            <TabsTrigger value="bg">Background</TabsTrigger>
            <TabsTrigger value="motion">Motion</TabsTrigger>
          </TabsList>

          <div className="mt-3 max-h-[52vh] overflow-y-auto thin-scroll pr-1">
            <TabsContent value="canvas" className="mt-0 space-y-3">
              <div>
                <Label className="mb-1 block text-xs">Size presets</Label>
                <div className="grid grid-cols-3 gap-1">
                  {SIZE_PRESETS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() =>
                        useProjectStore.getState().patchProject((p) => ({ ...p, canvas: { ...p.canvas, w: s.w, h: s.h } }))
                      }
                      className={`rounded-md border px-1.5 py-1.5 text-[10px] leading-tight transition-colors ${
                        project.canvas.w === s.w && project.canvas.h === s.h
                          ? 'border-primary bg-primary/10'
                          : 'hover:bg-accent'
                      }`}
                    >
                      <span className="block font-medium">{s.label}</span>
                      <span className="block text-muted-foreground">
                        {s.w}×{s.h}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <NumField
                  label="Width"
                  value={project.canvas.w}
                  min={16}
                  max={8192}
                  onChange={(w) => useProjectStore.getState().patchProject((p) => ({ ...p, canvas: { ...p.canvas, w } }))}
                />
                <NumField
                  label="Height"
                  value={project.canvas.h}
                  min={16}
                  max={8192}
                  onChange={(h) => useProjectStore.getState().patchProject((p) => ({ ...p, canvas: { ...p.canvas, h } }))}
                />
              </div>

              <div>
                <Label htmlFor="pname" className="mb-1 block text-xs">
                  Project name
                </Label>
                <Input
                  id="pname"
                  value={project.name}
                  onChange={(e) =>
                    useProjectStore.getState().patchProject((p) => ({ ...p, name: e.target.value }), {
                      coalesce: 'name',
                    })
                  }
                />
              </div>

              <Separator />
              <div className="flex flex-wrap gap-1">
                <Badge variant="muted">seed {project.seed}</Badge>
                <Badge variant="muted">{project.layers.length} layers</Badge>
                <Badge variant="muted">{project.groups.length} groups</Badge>
                <Badge variant="muted">{project.palette.colors.length} colours</Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = createProject({
                    seed: project.seed,
                    canvas: { w: project.canvas.w, h: project.canvas.h },
                    layers: [],
                    name: 'Untitled effect',
                  })
                  useProjectStore.getState().applyProject(next)
                }}
              >
                New empty project
              </Button>
            </TabsContent>

            <TabsContent value="bg" className="mt-0 space-y-3">
              <BackgroundEditor />
            </TabsContent>

            <TabsContent value="motion" className="mt-0 space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Motion adds drift, twinkle, pulse and flow on top of the still render. It is used
                by the WebM export and the live preview shimmer.
              </p>
              {(
                [
                  ['drift', 'Drift', 'Slow positional wander'],
                  ['twinkle', 'Twinkle', 'Opacity shimmer'],
                  ['pulse', 'Pulse', 'Breathing scale'],
                  ['flow', 'Flow', 'Noise-field movement'],
                  ['speed', 'Speed', 'Overall rate'],
                ] as [keyof MotionSpec, string, string][]
              ).map(([key, label, hint]) => (
                <MotionField key={key} k={key} label={label} hint={hint} />
              ))}
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function NumField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div>
      <Label className="mb-1 block text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, Math.round(v))))
        }}
        className="text-right tabular-nums"
      />
    </div>
  )
}

function BackgroundEditor() {
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

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase text-muted-foreground">{value}</span>
        <label
          className="block h-7 w-10 cursor-pointer rounded-md border shadow-sm"
          style={{ backgroundColor: value }}
        >
          <input
            type="color"
            value={value}
            aria-label={label}
            onChange={(e) => onChange(e.target.value)}
            className="h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  )
}

function MotionField({ k, label, hint }: { k: keyof MotionSpec; label: string; hint: string }) {
  const value = useProjectStore((s) => s.project.motion[k])
  return (
    <div className="py-1">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <Label className="text-xs">{label}</Label>
          <p className="text-[10px] text-muted-foreground">{hint}</p>
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) =>
          useProjectStore.getState().patchProject(
            (p) => ({ ...p, motion: { ...p.motion, [k]: Number(e.target.value) } }),
            { coalesce: `motion:${k}` },
          )
        }
        className="w-full accent-[var(--primary)]"
        aria-label={label}
      />
    </div>
  )
}

/* end of SettingsDialog */
