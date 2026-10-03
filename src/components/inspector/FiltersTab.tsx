/**
 * inspector/FiltersTab.tsx — Per-layer filter stack.
 *
 * An ordered list of filter instances (eye / move / duplicate / delete) with
 * schema-generated controls, a grouped add menu and one-click presets. All
 * mutations go through `updateLayer` + the pure helpers in `filters/stack.ts`,
 * so a no-op edit (dragging a slider across its current value) commits nothing.
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp, Copy, Eye, Plus, Power, Trash2, Wand2 } from 'lucide-react'

import {
  addFilter,
  defaultFilterParams,
  duplicateFilter,
  ensureFilters,
  moveFilter,
  patchFilter,
  removeFilter,
  setFilterParam,
  setFilters,
  stackSpread,
} from '@/lib/filters/stack'
import { newFilterId } from '@/lib/filters/kit'
import { FILTER_STACK_PRESETS } from '@/lib/filters/presets'
import { getFilter } from '@/lib/filters'
import { isHeavyStack, stackCostWeight } from '@/lib/filters/cost'
import type { FilterInstance } from '@/lib/filters/types'
import type { Layer, ParamValue } from '@/lib/schema'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { MiniToggle } from './fields'
import { FilterField } from './FilterField'
import { FilterPicker } from './FilterPicker'
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'

export function FiltersTab({ layer }: { layer: Layer }) {
  const open = useUiStore((s) => s.filterPickerOpen)
  const setOpen = (v: boolean) => useUiStore.getState().setFilterPickerOpen(v)
  const query = useUiStore((s) => s.filterQuery)
  const setQuery = (q: string) => useUiStore.getState().setFilterQuery(q)
  const [showPresets, setShowPresets] = useState(false)

  const edit = (fn: (l: Layer) => Layer) =>
    useProjectStore.getState().updateLayer(layer.id, fn)

  const filters = layer.filters ?? []
  const weight = stackCostWeight(filters, (t) => getFilter(t)?.cost ?? 0)
  const heavy = isHeavyStack(weight)
  const canvas = useProjectStore((s) => s.project.canvas)
  const spreadCtx = { width: canvas.w, height: canvas.h }

  const add = (type: string) => {
    edit((l) => addFilter(l, type))
    setOpen(false)
  }

  const applyPreset = (presetId: string) => {
    const preset = FILTER_STACK_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    edit((l) => {
      // presets *append* rather than replace — a preset should never silently
      // destroy a hand-built stack
      const added = preset.stack.map<FilterInstance>((s) => ({
        id: newFilterId(),
        type: s.type,
        enabled: true,
        params: s.params ?? defaultFilterParams(s.type),
      }))
      return setFilters(l, [...ensureFilters(l), ...added])
    })
    setShowPresets(false)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-lg border p-2.5">
        <div className="min-w-0">
          <Label className="text-xs">Filters</Label>
          <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">
            {filters.length === 0
              ? 'None — the layer draws unfiltered.'
              : `${filters.length} active · ${stackSpread(filters, spreadCtx).toFixed(0)}u spread`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {heavy && (
            <Badge variant="muted" title="This stack is expensive to render">
              heavy
            </Badge>
          )}
          <MiniToggle
            active={layer.filtersBypassed === true}
            onClick={() => edit((l) => ({ ...l, filtersBypassed: !l.filtersBypassed }))}
            label="Bypass all filters on this layer"
          >
            <Power />
          </MiniToggle>
        </div>
      </div>

      {layer.filtersBypassed && (
        <p className="rounded-lg border border-dashed p-2 text-center text-[10px] text-muted-foreground">
          Filters are bypassed — the preview shows the raw layer.
        </p>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-1">
          <div className="flex gap-1">
            <Button size="sm" variant="secondary" onClick={() => setOpen(!open)}>
              <Plus /> Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowPresets(!showPresets)}>
              <Wand2 /> Presets
            </Button>
          </div>
        </div>

        {open && <FilterPicker query={query} onQuery={setQuery} onPick={add} />}

        {showPresets && (
          <div className="mb-2 space-y-0.5 rounded-lg border bg-muted/40 p-1.5">
            {FILTER_STACK_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                title={p.description}
                className="flex w-full flex-col rounded px-1.5 py-1 text-left hover:bg-background"
              >
                <span className="text-[11px]">{p.label}</span>
                <span className="text-[9px] leading-tight text-muted-foreground">
                  {p.description}
                </span>
              </button>
            ))}
          </div>
        )}

        {filters.length === 0 && !open && !showPresets && (
          <p className="rounded-lg border border-dashed p-3 text-center text-[11px] text-muted-foreground">
            No filters. Add a blur, a glow, a colour grade… they stack in order.
          </p>
        )}

        <div className="space-y-2">
          {filters.map((f, i) => {
            const def = getFilter(f.type)
            if (!def) return null
            const off = !f.enabled || layer.filtersBypassed === true || layer.locked
            return (
              <div
                key={f.id}
                className={`rounded-lg border p-2 ${f.enabled ? '' : 'opacity-60'}`}
              >
                <div className="mb-1 flex items-center justify-between gap-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[11px] font-semibold">{def.label}</span>
                    <Badge variant="muted">#{i + 1}</Badge>
                    {def.rasterOnly && <Badge variant="muted">raster</Badge>}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <MiniToggle
                      active={f.enabled}
                      onClick={() => edit((l) => patchFilter(l, f.id, { enabled: !f.enabled }))}
                      label="Enable filter"
                    >
                      <Eye />
                    </MiniToggle>
                    <MiniToggle
                      onClick={() => edit((l) => moveFilter(l, i, i - 1))}
                      label="Move up"
                      disabled={i === 0}
                    >
                      <ChevronUp />
                    </MiniToggle>
                    <MiniToggle
                      onClick={() => edit((l) => moveFilter(l, i, i + 1))}
                      label="Move down"
                      disabled={i === filters.length - 1}
                    >
                      <ChevronDown />
                    </MiniToggle>
                    <MiniToggle
                      onClick={() => edit((l) => duplicateFilter(l, f.id))}
                      label="Duplicate filter"
                    >
                      <Copy />
                    </MiniToggle>
                    <MiniToggle
                      onClick={() => edit((l) => removeFilter(l, f.id))}
                      label="Remove filter"
                    >
                      <Trash2 />
                    </MiniToggle>
                  </div>
                </div>
                <p className="mb-1 text-[10px] leading-tight text-muted-foreground">
                  {def.description}
                </p>
                <div className="space-y-0.5">
                  {def.params.map((p) => (
                    <FilterField
                      key={p.key}
                      def={p}
                      value={f.params[p.key] ?? p.default}
                      disabled={off}
                      draftKey={`${layer.id}:${f.id}:${p.key}`}
                      onChange={(v: ParamValue) =>
                        edit((l) => setFilterParam(l, f.id, p.key, v))
                      }
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}