/** One block in the panel: a group, or a run of layers sharing a group id. */
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '@/components/ui/badge'
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import { useProjectStore } from '@/store/projectStore'
import { LayerRow } from './LayerRow'
import type { Block } from './model'

export function BlockView({
  block,
  selectedId,
  multi,
  onToggle,
  onClick,
  onMove,
  onRemove,
}: {
  block: Block
  selectedId: string | null
  multi: string[]
  onToggle: (id: string, key: 'visible' | 'solo' | 'locked') => void
  onClick: (id: string, e: React.MouseEvent) => void
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.key,
  })
  const collapsed = !!block.group?.collapsed
  const isGroup = block.groupId != null

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {isGroup && (
        <div className="mb-0.5 flex items-center gap-1 rounded-md border bg-muted/60 px-1 py-0.5">
          <button
            aria-label={collapsed ? 'Expand group' : 'Collapse group'}
            onClick={() =>
              block.group &&
              useProjectStore.getState().patchProject((p) => ({
                ...p,
                groups: p.groups.map((g) =>
                  g.id === block.group!.id ? { ...g, collapsed: !g.collapsed } : g,
                ),
              }))
            }
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {block.group?.name ?? 'Group'}
          </button>
          <Badge variant="muted" className="ml-auto mr-1 h-4 px-1 text-[9px]">
            {block.layers.length}
          </Badge>
        </div>
      )}

      {!collapsed && (
        <div className="space-y-1">
          {block.layers.map((layer, i) => (
            <LayerRow
              key={layer.id}
              layer={layer}
              selected={selectedId === layer.id}
              multi={multi.includes(layer.id)}
              first={i === 0}
              last={i === block.layers.length - 1}
              onClick={onClick}
              onToggle={onToggle}
              onMove={onMove}
              onRemove={onRemove}
              showHandle={i === 0 ? { attributes, listeners } : undefined}
            />
          ))}
        </div>
      )}

      {/* drag handle for the whole block, floating at the right of the header/first row */}
      {isGroup && collapsed && (
        <button
          aria-label="Drag to reorder"
          className="absolute right-1 top-1 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
