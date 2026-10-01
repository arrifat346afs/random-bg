import { createProject } from '@/lib/project'
import { SIZE_PRESETS, type MotionSpec } from '@/lib/schema'
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
import { BackgroundEditor } from './settings/BackgroundEditor'
import { MotionField } from './settings/MotionField'
import { NumField } from './settings/NumField'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: Props) {
  // Narrow to the four things actually rendered here. Selecting the whole
  // project re-rendered this dialog on every param edit elsewhere.
  const canvas = useProjectStore((s) => s.project.canvas)
  const name = useProjectStore((s) => s.project.name)
  const seed = useProjectStore((s) => s.project.seed)
  const layerCount = useProjectStore((s) => s.project.layers.length)
  const groupCount = useProjectStore((s) => s.project.groups.length)
  const paletteSize = useProjectStore((s) => s.project.palette.colors.length)

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
                        canvas.w === s.w && canvas.h === s.h
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
                  value={canvas.w}
                  min={16}
                  max={8192}
                  onChange={(w) => useProjectStore.getState().patchProject((p) => ({ ...p, canvas: { ...p.canvas, w } }))}
                />
                <NumField
                  label="Height"
                  value={canvas.h}
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
                  value={name}
                  onChange={(e) =>
                    useProjectStore.getState().patchProject((p) => ({ ...p, name: e.target.value }), {
                      coalesce: 'name',
                    })
                  }
                />
              </div>

              <Separator />
              <div className="flex flex-wrap gap-1">
                <Badge variant="muted">seed {seed}</Badge>
                <Badge variant="muted">{layerCount} layers</Badge>
                <Badge variant="muted">{groupCount} groups</Badge>
                <Badge variant="muted">{paletteSize} colours</Badge>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = createProject({
                    seed: seed,
                    canvas: { w: canvas.w, h: canvas.h },
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

/* end of SettingsDialog */
