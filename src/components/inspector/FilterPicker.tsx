/**
 * inspector/FilterPicker.tsx — The "Add filter" menu.
 *
 * Grouped by catalog order with a search box on top. The list is driven
 * entirely by the registry, so a newly registered filter shows up here with no
 * UI change.
 */

import { Search } from 'lucide-react'
import { FILTERS, filtersByGroup, groupLabel, type FilterDef } from '@/lib/filters'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

/** Case-insensitive match over label, description and group. */
export function filterSearch(query: string, def: FilterDef): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return (
    def.label.toLowerCase().includes(q) ||
    def.type.toLowerCase().includes(q) ||
    def.description.toLowerCase().includes(q) ||
    groupLabel(def.group).toLowerCase().includes(q)
  )
}

/** Filtered catalog, still grouped, with empty groups dropped. */
export function searchFilters(query: string): { group: string; defs: FilterDef[] }[] {
  return filtersByGroup()
    .map(({ group, defs }) => ({ group, defs: defs.filter((d) => filterSearch(query, d)) }))
    .filter((g) => g.defs.length > 0)
}

export function FilterPicker({
  query,
  onQuery,
  onPick,
}: {
  query: string
  onQuery: (q: string) => void
  onPick: (type: string) => void
}) {
  const groups = searchFilters(query)

  return (
    <div className="mb-2 rounded-lg border bg-muted/40 p-1.5">
      <div className="relative mb-1.5">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search filters…"
          aria-label="Search filters"
          className="h-7 pl-7 text-xs"
        />
      </div>

      {groups.length === 0 && (
        <p className="px-1 py-2 text-center text-[11px] text-muted-foreground">
          No filter matches “{query}”.
        </p>
      )}

      <div className="thin-scroll max-h-56 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.group} className="mb-1 last:mb-0">
            <p className="px-1.5 pb-0.5 pt-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              {groupLabel(g.group as Parameters<typeof groupLabel>[0])}
            </p>
            <div className="space-y-0.5">
              {g.defs.map((def) => (
                <button
                  key={def.type}
                  onClick={() => onPick(def.type)}
                  title={def.description}
                  className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] hover:bg-background"
                >
                  <span className="min-w-0 flex-1 truncate">{def.label}</span>
                  {def.rasterOnly && <Badge variant="muted">raster</Badge>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-1 border-t px-1.5 pt-1 text-[9px] leading-tight text-muted-foreground">
        {FILTERS.length} filters · they run top to bottom, like Photoshop layers.
      </p>
    </div>
  )
}