import { Layers } from 'lucide-react'

import { activeFilters } from '@/lib/filters/stack'
import { getFilter } from '@/lib/filters'
import { getGenerator } from '@/lib/generators'
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tip } from './Tip'

/**
 * top-bar/ActiveFiltersButton.tsx — "What filters are on right now?"
 *
 * The Inspector only shows one layer's stack at a time; this dropdown
 * summarises every layer's *active* filters (enabled, not bypassed) in one
 * place. Read-only except for jump-to-layer: clicking a layer selects it and
 * opens its Filters tab. Subscribes narrowly so slider ticks elsewhere don't
 * re-render the whole TopBar.
 */
export function ActiveFiltersButton() {
  const layers = useProjectStore((s) => s.project.layers)

  const rows = layers.map((l) => ({
    layer: l,
    genName: getGenerator(l.gen)?.name ?? l.gen,
    bypassed: l.filtersBypassed === true,
    total: (l.filters ?? []).length,
    active: activeFilters(l),
  }))
  const activeCount = rows.reduce((s, r) => s + r.active.length, 0)

  const jumpTo = (layerId: string) => {
    useProjectStore.getState().selectLayer(layerId)
    useUiStore.getState().setInspectorTab('filters')
  }

  return (
    <DropdownMenu>
      <Tip label={activeCount === 0 ? 'No filters active — show per-layer stacks' : `${activeCount} active filter${activeCount === 1 ? '' : 's'} across ${layers.length} layer${layers.length === 1 ? '' : 's'}`}>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1 px-1.5 tabular-nums"
            aria-label="Show active filters"
          >
            <Layers className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="hidden text-[11px] md:inline">Filters</span>
            {activeCount > 0 && (
              <Badge variant="muted" className="px-1 text-[10px] tabular-nums">
                {activeCount}
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="max-h-[60vh] w-72 overflow-y-auto">
        <DropdownMenuLabel>
          Active filters{activeCount > 0 ? ` — ${activeCount}` : ''}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {rows.length === 0 && (
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
            No layers yet.
          </p>
        )}
        {rows.map(({ layer, genName, bypassed, total, active }) => (
          <div key={layer.id} className="px-1 py-1">
            <button
              onClick={() => jumpTo(layer.id)}
              title="Select this layer and open its Filters tab"
              className="flex w-full items-center justify-between gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-accent"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">{layer.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{genName}</span>
              </span>
              {bypassed ? (
                <Badge variant="warning">bypassed</Badge>
              ) : total === 0 ? (
                <span className="text-[10px] text-muted-foreground">none</span>
              ) : (
                <Badge variant="muted" className="tabular-nums">
                  {active.length}/{total}
                </Badge>
              )}
            </button>
            {!bypassed &&
              active.map((f, i) => {
                const def = getFilter(f.type)
                if (!def) return null
                return (
                  <div
                    key={f.id}
                    className="flex items-center gap-1.5 py-0.5 pl-4 pr-1.5 text-[11px]"
                  >
                    <span className="text-muted-foreground tabular-nums">#{i + 1}</span>
                    <span className="truncate">{def.label}</span>
                    {def.rasterOnly && <Badge variant="muted">raster</Badge>}
                  </div>
                )
              })}
          </div>
        ))}
        <DropdownMenuSeparator />
        <p className="px-2 py-1 text-[10px] leading-tight text-muted-foreground">
          Only enabled, non-bypassed filters are listed — that is exactly what the
          preview is rendering. Click a layer to edit its stack.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
