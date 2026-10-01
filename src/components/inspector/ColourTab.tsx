/**
 * inspector/ColourTab.tsx — palette assignment and per-layer colour mapping.
 */

import type { Color } from "@/lib/ir"
import { effectivePalette, isPaletteLinked } from "@/lib/palette"
import { pushPaletteToAll, withProjectPalette } from "@/lib/project"
import type { Layer } from "@/lib/schema"
import { PaletteEditor } from "@/components/PaletteEditor"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Link2, Unlink } from "lucide-react"
import { useProjectStore } from '@/store/projectStore'

export function ColourTab({ layer }: { layer: Layer }) {
  const projectPalette = useProjectStore((s) => s.project.palette)
  const linkedCount = useProjectStore((s) => s.project.layers.filter((l) => isPaletteLinked(l.color)).length)
  const layerCount = useProjectStore((s) => s.project.layers.length)
  const linked = isPaletteLinked(layer.color)
  const shownPalette = linked
    ? projectPalette
    : layer.color.palette

  const setColor = (patch: Partial<Layer['color']>, coalesce?: string) =>
    useProjectStore.getState().updateLayer(layer.id, (l) => ({ ...l, color: { ...l.color, ...patch } }), {
      coalesce: coalesce ? `${layer.id}:c:${coalesce}` : undefined,
    })

  const setPaletteColors = (colors: Color[], name?: string) => {
    if (linked) {
      useProjectStore.getState().patchProject((p) => withProjectPalette(p, colors, name ?? p.palette.name), {
        coalesce: `palette:global`,
      })
    } else {
      setColor({ palette: { ...layer.color.palette, colors: colors.slice(), ...(name ? { name } : {}) } })
    }
  }

  const unlink = () =>
    useProjectStore.getState().updateLayer(layer.id, (l) => ({
      ...l,
      color: {
        ...l.color,
        linked: false,
        palette: { ...effectivePalette(projectPalette, l.color), colors: effectivePalette(projectPalette, l.color).colors.slice() },
      },
    }))

  const relink = () =>
    useProjectStore.getState().updateLayer(layer.id, (l) => ({
      ...l,
      color: { ...l.color, linked: true, palette: { ...projectPalette, colors: projectPalette.colors.slice() } },
    }))

  const pushAll = () => useProjectStore.getState().patchProject((p) => pushPaletteToAll(p, layer.id))

  const modes: { value: Layer['color']['mode']; label: string; hint: string }[] = [
    { value: 'palette', label: 'Palette', hint: 'Sample colours straight from the ramp.' },
    { value: 'position', label: 'By position', hint: 'Project colour across the canvas on an axis.' },
    { value: 'size', label: 'By size', hint: 'Big primitives get one end of the ramp, small the other.' },
    { value: 'random', label: 'Random', hint: 'Every primitive picks its own colour.' },
  ]

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1 block">Colour mapping</Label>
        <div className="grid grid-cols-2 gap-1">
          {modes.map((m) => (
            <button
              key={m.value}
              onClick={() => setColor({ mode: m.value })}
              title={m.hint}
              className={`rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors ${
                layer.color.mode === m.value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border hover:bg-accent'
              }`}
            >
              <span className="block font-medium">{m.label}</span>
              <span className="block text-[9px] leading-tight text-muted-foreground">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_74px] items-center gap-2 py-1">
        <Label className="text-xs">Ramp shape</Label>
        <Select
          value={layer.color.ramp}
          onValueChange={(v) => setColor({ ramp: v as Layer['color']['ramp'] }, 'ramp')}
        >
          <SelectTrigger className="h-7 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="linear">Smooth</SelectItem>
            <SelectItem value="ease">Ease</SelectItem>
            <SelectItem value="bilinear">Banded</SelectItem>
            <SelectItem value="mirror">Mirror</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(layer.color.mode === 'position' || layer.color.mode === 'rampAngle') && (
        <div className="py-1">
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs">Axis angle</Label>
            <span className="text-[10px] tabular-nums text-muted-foreground">{layer.color.axis}°</span>
          </div>
          <Slider
            value={[layer.color.axis]}
            min={0}
            max={360}
            step={1}
            onValueChange={([v]) => setColor({ axis: v }, 'axis')}
            aria-label="Axis angle"
          />
        </div>
      )}

      <div className="flex items-center justify-between py-1">
        <div>
          <Label htmlFor="inv">Invert ramp</Label>
          <p className="text-[10px] text-muted-foreground">Flip the mapping direction.</p>
        </div>
        <Switch
          id="inv"
          checked={layer.color.invert}
          onCheckedChange={(v) => setColor({ invert: v })}
        />
      </div>

      <Separator />

      <div
        className={`flex items-center justify-between gap-2 rounded-lg border p-2 ${
          linked ? 'border-primary/40 bg-primary/5' : 'border-dashed'
        }`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {linked ? <Link2 className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Unlink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium">
              {linked ? `Linked · ${linkedCount}/${layerCount} layers` : 'Custom colours'}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {linked
                ? 'Edits here update every linked layer.'
                : 'This layer ignores the project palette.'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {!linked && (
            <>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={pushAll}>
                Push to all
              </Button>
              <Button size="sm" variant="secondary" className="h-6 px-2 text-[10px]" onClick={relink}>
                Relink
              </Button>
            </>
          )}
          {linked && layerCount > 1 && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={unlink}>
              Unlink
            </Button>
          )}
        </div>
      </div>

      <PaletteEditor
        palette={shownPalette}
        onChange={(palette) => setPaletteColors(palette.colors, palette.name)}
      />
    </div>
  )
}

/* ---- effects tab ------------------------------------------------------------ */

