/**
 * inspector/DistributeTab.tsx — how primitives are scattered: the distribution
 * shape plus its numeric fields.
 */

import { createRng, hash32 } from "@/lib/rng"
import { randomDist } from "@/lib/randomize"
import { DIST_OPTIONS, type DistSpec, type Layer } from "@/lib/schema"
import { getState, updateLayer } from "@/lib/state/store"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Info, Shuffle } from "lucide-react"
import { DIST_FIELDS, SHAPE_FIELDS } from "./schema"
import { DistNumField, MaskPicker } from "./fields"

export function DistributeTab({ layer }: { layer: Layer }) {
  const rng = createRng(hash32(getState().project.seed, layer.id, layer.seedOffset, 'dist'))

  const setDist = (patch: Partial<DistSpec>, coalesce?: string) =>
    updateLayer(layer.id, (l) => ({ ...l, dist: { ...l.dist, ...patch } }), {
      coalesce: coalesce ? `${layer.id}:${coalesce}` : undefined,
    })

  const reset = () => setDist({ ...defaultShape() })

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1 block">Distribution</Label>
        <div className="flex gap-1">
          <Select value={layer.dist.type} onValueChange={(v) => setDist({ type: v as DistSpec['type'] })}>
            <SelectTrigger className="flex-1" aria-label="Distribution type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIST_OPTIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon-sm" variant="outline" onClick={() => setDist(randomDist(layer.gen, rng))} title="Random distribution">
            <Shuffle />
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Shared across every generator — change it here for any layer.
        </p>
      </div>

      <Separator />

      {DIST_FIELDS.filter((f) => !f.when || f.when.includes(layer.dist.type)).map((f) => (
        <DistNumField
          key={String(f.key)}
          field={f}
          value={layer.dist[f.key]}
          disabled={layer.locked}
          onChange={(v) => setDist({ [f.key]: v } as Partial<DistSpec>, String(f.key))}
        />
      ))}

      <Separator />
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Info className="h-3 w-3" /> Shared shaping
      </p>
      {SHAPE_FIELDS.map((f) => (
        <DistNumField
          key={String(f.key)}
          field={f}
          value={layer.dist[f.key]}
          disabled={layer.locked}
          onChange={(v) => setDist({ [f.key]: v } as Partial<DistSpec>, String(f.key))}
        />
      ))}

      {layer.dist.type === 'imageMask' && (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">Image mask</p>
          <p className="mb-2">
            Paint a soft mask and every generator on this layer will sample it as a density map.
          </p>
          <MaskPicker
            value={layer.dist.mask}
            onChange={(mask) => setDist({ mask, type: 'imageMask' })}
          />
        </div>
      )}

      <Button size="sm" variant="ghost" className="w-full" onClick={reset}>
        Reset distribution
      </Button>
    </div>
  )
}


function defaultShape(): Partial<DistSpec> {
  return {
    sizePower: 1,
    sizeMin: 0.4,
    sizeMax: 1,
    opacityFalloff: 0.2,
    edgeFalloff: 0,
    depth: 0.4,
  }
}

