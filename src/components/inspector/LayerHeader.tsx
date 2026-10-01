/**
 * inspector/LayerHeader.tsx — the selected layer's name, visibility and
 * per-layer blend, above the tab strip.
 */

import { useState } from "react"
import { getGenerator } from "@/lib/generators"
import { BLEND_MODES, type BlendMode } from "@/lib/ir"
import type { Layer } from "@/lib/schema"
import { updateLayer } from "@/lib/state/store"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Eye, EyeOff, Lock, LockOpen } from "lucide-react"
import { MiniToggle } from "./fields"

/* ---- header --------------------------------------------------------------- */

export function LayerHeader({ layer }: { layer: Layer }) {
  const gen = getGenerator(layer.gen)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(layer.name)

  const toggle = (key: 'visible' | 'locked' | 'solo') =>
    updateLayer(layer.id, (l) => ({ ...l, [key]: !l[key] }))

  return (
    <div className="border-b p-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                updateLayer(layer.id, (l) => ({ ...l, name: draft.trim() || l.name }))
                setRenaming(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  setDraft(layer.name)
                  setRenaming(false)
                }
              }}
              className="h-7"
            />
          ) : (
            <button
              className="block w-full truncate text-left text-sm font-semibold hover:text-primary"
              onDoubleClick={() => {
                setDraft(layer.name)
                setRenaming(true)
              }}
              title="Double-click to rename"
            >
              {layer.name}
            </button>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <Badge variant="muted">{gen?.family ?? 'unknown'}</Badge>
            <span className="truncate text-[10px] text-muted-foreground">
              {gen?.description ?? 'Unknown generator'}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <MiniToggle active={layer.visible} onClick={() => toggle('visible')} label="Visibility">
            {layer.visible ? <Eye /> : <EyeOff />}
          </MiniToggle>
          <MiniToggle active={layer.solo} onClick={() => toggle('solo')} label="Solo">
            <span className="text-[10px] font-bold">S</span>
          </MiniToggle>
          <MiniToggle active={layer.locked} onClick={() => toggle('locked')} label="Lock layer">
            {layer.locked ? <Lock /> : <LockOpen />}
          </MiniToggle>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-[1fr_100px] items-center gap-2">
        <div>
          <div className="mb-0.5 flex items-center justify-between">
            <Label className="text-[10px] text-muted-foreground">Opacity</Label>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {Math.round(layer.opacity * 100)}%
            </span>
          </div>
          <Slider
            value={[layer.opacity]}
            min={0}
            max={1}
            step={0.01}
            disabled={layer.locked}
            onValueChange={([v]) =>
              updateLayer(layer.id, (l) => ({ ...l, opacity: v }), {
                coalesce: `${layer.id}:opacity`,
              })
            }
          />
        </div>
        <div>
          <Label className="mb-0.5 block text-[10px] text-muted-foreground">Blend</Label>
          <Select
            value={layer.blend}
            disabled={layer.locked}
            onValueChange={(v) =>
              updateLayer(layer.id, (l) => ({ ...l, blend: v as BlendMode }))
            }
          >
            <SelectTrigger className="h-7 text-[11px]" aria-label="Blend mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BLEND_MODES.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

