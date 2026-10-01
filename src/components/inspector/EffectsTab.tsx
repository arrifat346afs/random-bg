/**
 * inspector/EffectsTab.tsx — the modifier stack (strokes, warps, colour shifts)
 * applied after a layer generates.
 */

import { MODIFIER_DEFS } from "@/lib/modifiers"
import { effectivePalette } from "@/lib/palette"
import { createRng } from "@/lib/rng"
import { randomLayer } from "@/lib/randomize"
import type { Layer } from "@/lib/schema"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  ChevronDown,
  ChevronUp,
  Dices,
  Eye,
  Palette,
  Plus,
  Trash2,
} from "lucide-react"
import { MiniToggle, ModSlider } from "./fields"
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'

export function EffectsTab({ layer }: { layer: Layer }) {
  const addOpen = useUiStore((s) => s.modifierPickerOpen)
  const setAddOpen = (v: boolean) => useUiStore.getState().setModifierPickerOpen(v)

  const setMod = (index: number, patch: Partial<Layer['mods'][number]>) =>
    useProjectStore.getState().updateLayer(layer.id, (l) => {
      const mods = l.mods.slice()
      mods[index] = { ...mods[index], ...patch }
      return { ...l, mods }
    })

  const move = (index: number, dir: -1 | 1) =>
    useProjectStore.getState().updateLayer(layer.id, (l) => {
      const mods = l.mods.slice()
      const to = index + dir
      if (to < 0 || to >= mods.length) return l
      const [m] = mods.splice(index, 1)
      mods.splice(to, 0, m)
      return { ...l, mods }
    })

  const add = (type: Layer['mods'][number]['type']) => {
    useProjectStore.getState().updateLayer(layer.id, (l) => {
      if (l.mods.some((m) => m.type === type)) return l
      const def = MODIFIER_DEFS[type]
      return {
        ...l,
        mods: [
          ...l.mods,
          {
            type,
            enabled: true,
            amount: def.amount.default,
            secondary: def.secondary?.default ?? 0,
            tertiary: def.tertiary?.default ?? 0,
          },
        ],
      }
    })
    setAddOpen(false)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-2.5">
        <div className="mb-1 flex items-center justify-between">
          <Label className="text-xs">Layer seed offset</Label>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                useProjectStore.getState().updateLayer(layer.id, (l) => ({ ...l, seedOffset: l.seedOffset + 1 }))
              }
            >
              +1
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                useProjectStore.getState().updateLayer(layer.id, (l) => ({ ...l, seedOffset: l.seedOffset - 1 }))
              }
            >
              −1
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              title="New random seed"
              onClick={() =>
                useProjectStore.getState().updateLayer(layer.id, (l) => ({
                  ...l,
                  seedOffset: Math.floor(Math.random() * 100000),
                }))
              }
            >
              <Dices />
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Current: <code className="font-mono">{layer.seedOffset}</code> — changing it reshuffles this
          layer without touching others.
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Modifiers</Label>
          <Button size="sm" variant="secondary" onClick={() => setAddOpen(!addOpen)}>
            <Plus /> Add
          </Button>
        </div>

        {addOpen && (
          <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1.5">
            {Object.values(MODIFIER_DEFS).map((def) => (
              <button
                key={def.type}
                onClick={() => add(def.type)}
                disabled={layer.mods.some((m) => m.type === def.type)}
                title={def.hint}
                className="rounded px-1.5 py-1 text-left text-[11px] hover:bg-background disabled:opacity-40"
              >
                {def.label}
              </button>
            ))}
          </div>
        )}

        {layer.mods.length === 0 && !addOpen && (
          <p className="rounded-lg border border-dashed p-3 text-center text-[11px] text-muted-foreground">
            No modifiers. Add noise, twist, kaleidoscope, array, fades… they stack in order.
          </p>
        )}

        <div className="space-y-2">
          {layer.mods.map((mod, i) => {
            const def = MODIFIER_DEFS[mod.type]
            if (!def) return null
            return (
              <div key={`${mod.type}-${i}`} className="rounded-lg border p-2">
                <div className="mb-1 flex items-center justify-between gap-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[11px] font-semibold">{def.label}</span>
                    <Badge variant="muted">#{i + 1}</Badge>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <MiniToggle
                      active={mod.enabled}
                      onClick={() => setMod(i, { enabled: !mod.enabled })}
                      label="Enable modifier"
                    >
                      <Eye />
                    </MiniToggle>
                    <MiniToggle onClick={() => move(i, -1)} label="Move up">
                      <ChevronUp />
                    </MiniToggle>
                    <MiniToggle onClick={() => move(i, 1)} label="Move down">
                      <ChevronDown />
                    </MiniToggle>
                    <MiniToggle
                      onClick={() =>
                        useProjectStore.getState().updateLayer(layer.id, (l) => ({
                          ...l,
                          mods: l.mods.filter((_, k) => k !== i),
                        }))
                      }
                      label="Remove modifier"
                    >
                      <Trash2 />
                    </MiniToggle>
                  </div>
                </div>
                <p className="mb-1 text-[10px] text-muted-foreground">{def.hint}</p>
                <ModSlider
                  label={def.amount.label}
                  value={mod.amount}
                  min={def.amount.min}
                  max={def.amount.max}
                  step={def.amount.step}
                  disabled={!mod.enabled || layer.locked}
                  onChange={(v) => setMod(i, { amount: v })}
                />
                {def.secondary && (
                  <ModSlider
                    label={def.secondary.label}
                    value={mod.secondary}
                    min={def.secondary.min}
                    max={def.secondary.max}
                    step={def.secondary.step}
                    disabled={!mod.enabled || layer.locked}
                    onChange={(v) => setMod(i, { secondary: v })}
                  />
                )}
                {def.tertiary && (
                  <ModSlider
                    label={def.tertiary.label}
                    value={mod.tertiary}
                    min={def.tertiary.min}
                    max={def.tertiary.max}
                    step={def.tertiary.step}
                    disabled={!mod.enabled || layer.locked}
                    onChange={(v) => setMod(i, { tertiary: v })}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const next = randomLayer({
              genId: layer.gen,
              palette: effectivePalette(useProjectStore.getState().project.palette, layer.color),
              rng: createRng(Math.floor(Math.random() * 1e9)),
            })
            useProjectStore.getState().updateLayer(layer.id, () => ({ ...layer, ...next, id: layer.id, name: layer.name }))
          }}
        >
          <Dices /> Re-roll layer
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            useProjectStore.getState().updateLayer(layer.id, (l) => ({ ...l, locks: {}, seedOffset: l.seedOffset + 7 }))
          }}
        >
          <Palette /> Reseed + unlock
        </Button>
      </div>
    </div>
  )
}

