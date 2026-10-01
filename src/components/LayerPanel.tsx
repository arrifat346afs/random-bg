import { useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { getGenerator, generatorsByFamily } from '@/lib/generators'
import type { Layer, LayerGroup } from '@/lib/schema'
import { createLayer, createGroup, duplicateLayer, moveLayer } from '@/lib/project'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  Copy,
  Trash2,
  GripVertical,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  ChevronDown,
  ChevronRight,
  Layers,
  Ungroup,
  Group as GroupIcon,
} from 'lucide-react'
import { useProjectStore } from '@/lib/state/projectStore'

/* ---- block model ----------------------------------------------------------
 * A "block" is either a single ungrouped layer or a contiguous run of layers
 * sharing a group id. Drag-and-drop reorders blocks, which guarantees group
 * members always stay contiguous — no special cases in the drop handler.
 * ------------------------------------------------------------------------ */

interface Block {
  key: string
  groupId: string | null
  layers: Layer[]
  group?: LayerGroup
}

function toBlocks(layers: Layer[], groups: LayerGroup[]): Block[] {
  const out: Block[] = []
  for (const l of layers) {
    const last = out[out.length - 1]
    if (last && last.groupId === l.groupId) {
      last.layers.push(l)
    } else {
      out.push({
        key: l.id,
        groupId: l.groupId ?? null,
        layers: [l],
        group: l.groupId ? groups.find((g) => g.id === l.groupId) : undefined,
      })
    }
  }
  return out
}

export function LayerPanel() {
  const layers = useProjectStore((s) => s.project.layers)
  const groups = useProjectStore((s) => s.project.groups)
  const selectedId = useProjectStore((s) => s.selectedLayerId)
  /** shift/cmd-clicked layers awaiting a group action */
  const [multi, setMulti] = useState<string[]>([])

  const blocks = useMemo(() => toBlocks(layers, groups), [layers, groups])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = blocks.findIndex((b) => b.key === active.id)
    const to = blocks.findIndex((b) => b.key === over.id)
    if (from < 0 || to < 0) return
    const nextBlocks = arrayMove(blocks, from, to)
    const flat = nextBlocks.flatMap((b) => b.layers)
    useProjectStore.getState().commit({ ...useProjectStore.getState().project, layers: flat })
  }

  /* ---- layer actions ---------------------------------------------------- */

  const addLayer = (genId: string) => {
    const { project } = useProjectStore.getState()
    const layer = createLayer(genId, project.seed + project.layers.length * 977)
    // New layers join the unified palette so future edits stay in sync.
    layer.color = {
      ...layer.color,
      linked: true,
      palette: { ...project.palette, colors: project.palette.colors.slice() },
    }
    // Layers stack bottom→top: a new layer is appended (drawn last).
    useProjectStore.getState().commit({ ...project, layers: [...project.layers, layer] }, { select: layer.id })
  }

  const removeLayer = (id: string) => {
    const { project, selectedLayerId } = useProjectStore.getState()
    const idx = project.layers.findIndex((l) => l.id === id)
    const layersNext = project.layers.filter((l) => l.id !== id)
    const nextSel =
      selectedLayerId === id
        ? (layersNext[Math.min(idx, layersNext.length - 1)]?.id ?? null)
        : selectedLayerId
    useProjectStore.getState().commit({ ...project, layers: layersNext }, { select: nextSel })
  }

  const duplicate = (id: string) => {
    const { project } = useProjectStore.getState()
    const idx = project.layers.findIndex((l) => l.id === id)
    if (idx < 0) return
    const copy = duplicateLayer(project.layers[idx])
    const next = project.layers.slice()
    next.splice(idx + 1, 0, copy)
    useProjectStore.getState().commit({ ...project, layers: next }, { select: copy.id })
  }

  const toggle = (id: string, key: 'visible' | 'solo' | 'locked') =>
    useProjectStore.getState().updateLayer(id, (l) => ({ ...l, [key]: !l[key] }))

  const move = (id: string, dir: -1 | 1) => {
    const { project } = useProjectStore.getState()
    const layer = project.layers.find((l) => l.id === id)
    if (!layer) return
    const idx = project.layers.findIndex((l) => l.id === id)

    if (layer.groupId) {
      // Inside a group: shuffle only within that group's contiguous run.
      let target = idx + dir
      while (
        target >= 0 &&
        target < project.layers.length &&
        project.layers[target].groupId !== layer.groupId
      ) {
        target += dir
      }
      if (target < 0 || target >= project.layers.length) return
      useProjectStore.getState().commit({ ...project, layers: moveLayer(project.layers, idx, target) })
      return
    }

    // Ungrouped: jump over whole group runs so groups stay contiguous.
    let target = idx + dir
    while (target >= 0 && target < project.layers.length && project.layers[target].groupId != null) {
      target += dir
    }
    if (target < 0 || target >= project.layers.length) return
    useProjectStore.getState().commit({ ...project, layers: moveLayer(project.layers, idx, target) })
  }

  const groupSelection = () => {
    const { project } = useProjectStore.getState()
    const ids = multi.length ? multi : selectedId ? [selectedId] : []
    if (ids.length < 2) return
    const set = new Set(ids)
    const firstIdx = project.layers.findIndex((l) => set.has(l.id))
    if (firstIdx < 0) return

    // Pull the selected layers out, place them contiguously, tag as a group.
    const group = createGroup('Group')
    const picked = project.layers.filter((l) => set.has(l.id))
    const rest = project.layers.filter((l) => !set.has(l.id))
    const insertAt = Math.min(firstIdx, rest.length)
    const tagged = picked.map((l) => ({ ...l, groupId: group.id }))
    const next = [...rest.slice(0, insertAt), ...tagged, ...rest.slice(insertAt)]
    useProjectStore.getState().commit({ ...project, layers: next, groups: [...project.groups, group] })
    setMulti([])
  }

  const ungroupSelection = () => {
    const { project } = useProjectStore.getState()
    const ids = new Set(multi.length ? multi : selectedId ? [selectedId] : [])
    const touched = new Set<string>()
    const next = project.layers.map((l) => {
      if (ids.has(l.id) && l.groupId) {
        touched.add(l.groupId)
        return { ...l, groupId: null }
      }
      return l
    })
    useProjectStore.getState().commit({
      ...project,
      layers: next,
      groups: project.groups.filter((g) => !touched.has(g.id)),
    })
    setMulti([])
  }

  const clickRow = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      setMulti((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    } else {
      setMulti([])
      useProjectStore.getState().selectLayer(id)
    }
  }

  /* ---- render ------------------------------------------------------------- */

  const flatIds = blocks.map((b) => b.key)
  const hasSelection = multi.length > 1 || !!selectedId

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Layers
          </span>
          <Badge variant="muted">{layers.length}</Badge>
        </div>
        <div className="flex gap-0.5">
          <Tip label="Group selected layers">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={multi.length < 2}
              onClick={groupSelection}
              aria-label="Group selected layers"
            >
              <GroupIcon />
            </Button>
          </Tip>
          <Tip label="Ungroup">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={!selectedId && !multi.length}
              onClick={ungroupSelection}
              aria-label="Ungroup"
            >
              <Ungroup />
            </Button>
          </Tip>
          <Tip label="Duplicate layer (Ctrl+D)">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={!selectedId}
              onClick={() => selectedId && duplicate(selectedId)}
              aria-label="Duplicate layer"
            >
              <Copy />
            </Button>
          </Tip>
          <Tip label="Delete layer">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={!selectedId}
              onClick={() => selectedId && removeLayer(selectedId)}
              aria-label="Delete layer"
            >
              <Trash2 />
            </Button>
          </Tip>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-1.5">
          {blocks.length === 0 && <EmptyLayers onAdd={addLayer} />}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={flatIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {blocks.map((block) => (
                  <BlockView
                    key={block.key}
                    block={block}
                    selectedId={selectedId}
                    multi={multi}
                    onToggle={toggle}
                    onClick={clickRow}
                    onMove={move}
                    onRemove={removeLayer}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </ScrollArea>

      <footer className="border-t p-2">
        <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="flex-1" size="sm">
                <Plus /> Add layer
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[60vh] w-64 overflow-y-auto thin-scroll">
              {generatorsByFamily().map(({ family, gens }) => (
                <div key={family}>
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {family}
                  </DropdownMenuLabel>
                  <DropdownMenuGroup>
                    {gens.map((g) => (
                      <DropdownMenuItem key={g.id} onClick={() => addLayer(g.id)}>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-xs font-medium">{g.name}</span>
                          <span className="truncate text-[10px] text-muted-foreground">
                            {g.description}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                </div>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="mt-1.5 text-[10px] leading-tight text-muted-foreground">
          {hasSelection
            ? 'Drag the handle to reorder · shift-click to multi-select for grouping.'
            : 'Click a layer to edit it. Layers stack bottom → top.'}
        </p>
      </footer>
    </div>
  )
}

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function EmptyLayers({ onAdd }: { onAdd: (gen: string) => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-4 text-center">
      <Layers className="h-6 w-6 text-muted-foreground" />
      <p className="text-xs font-medium">No layers</p>
      <p className="text-[10px] text-muted-foreground">
        Start with a generator, then stack more on top.
      </p>
      <div className="flex flex-wrap justify-center gap-1">
        {['particles', 'bokeh', 'smoke'].map((g) => (
          <Button key={g} size="sm" variant="outline" onClick={() => onAdd(g)}>
            {g}
          </Button>
        ))}
      </div>
    </div>
  )
}

function BlockView({
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
              sortable={isGroup ? { attributes, listeners } : undefined}
              handleStyle={style}
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

function LayerRow({
  layer,
  selected,
  multi,
  first,
  last,
  showHandle,
  onClick,
  onToggle,
  onMove,
  onRemove,
}: {
  layer: Layer
  selected: boolean
  multi: boolean
  first: boolean
  last: boolean
  showHandle?: { attributes: unknown; listeners: unknown } | undefined
  sortable?: { attributes: unknown; listeners: unknown } | undefined
  handleStyle?: React.CSSProperties
  onClick: (id: string, e: React.MouseEvent) => void
  onToggle: (id: string, key: 'visible' | 'solo' | 'locked') => void
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
}) {
  const gen = getGenerator(layer.gen)
  const swatch = layer.color.palette.colors[0] ?? '#888888'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={(e) => onClick(layer.id, e)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(layer.id, e as unknown as React.MouseEvent)
        }
      }}
      className={`group flex cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected
          ? 'border-primary bg-primary/10'
          : multi
            ? 'border-primary/50 bg-primary/5'
            : 'border-transparent hover:bg-accent'
      } ${layer.visible ? '' : 'opacity-50'}`}
    >
      {showHandle ? (
        <span
          className="cursor-grab text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
          {...(showHandle.attributes as Record<string, unknown>)}
          {...(showHandle.listeners as Record<string, unknown>)}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      ) : (
        <span className="w-3.5 shrink-0" />
      )}

      <span
        className="h-6 w-4 shrink-0 rounded-sm border"
        style={{ backgroundColor: swatch }}
        aria-hidden
      />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium leading-tight">{layer.name}</span>
        <span className="block truncate text-[9px] leading-tight text-muted-foreground">
          {gen?.family ?? 'unknown'} · {Math.round(layer.opacity * 100)}% · {layer.blend}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-px opacity-70 group-hover:opacity-100">
        <RowBtn label="Move up" onClick={() => onMove(layer.id, -1)} disabled={first && !layer.groupId}>
          <span className="text-[10px] leading-none">▲</span>
        </RowBtn>
        <RowBtn label="Move down" onClick={() => onMove(layer.id, 1)} disabled={last && !layer.groupId}>
          <span className="text-[10px] leading-none">▼</span>
        </RowBtn>
        <RowBtn
          label={layer.solo ? 'Unsolo' : 'Solo'}
          active={layer.solo}
          onClick={() => onToggle(layer.id, 'solo')}
        >
          <span className="text-[10px] font-bold leading-none">S</span>
        </RowBtn>
        <RowBtn
          label={layer.visible ? 'Hide' : 'Show'}
          onClick={() => onToggle(layer.id, 'visible')}
        >
          {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        </RowBtn>
        <RowBtn
          label={layer.locked ? 'Unlock' : 'Lock'}
          active={layer.locked}
          onClick={() => onToggle(layer.id, 'locked')}
        >
          {layer.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
        </RowBtn>
        <RowBtn label="Delete" onClick={() => onRemove(layer.id)} danger>
          <Trash2 className="h-3 w-3" />
        </RowBtn>
      </span>
    </div>
  )
}

function RowBtn({
  label,
  onClick,
  active,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            onClick()
          }}
          className={`flex h-5 w-5 items-center justify-center rounded transition-colors disabled:opacity-30 ${
            active
              ? 'text-primary'
              : danger
                ? 'text-muted-foreground hover:bg-destructive/15 hover:text-destructive'
                : 'text-muted-foreground hover:bg-background hover:text-foreground'
          }`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )
}

/* end of LayerPanel */
