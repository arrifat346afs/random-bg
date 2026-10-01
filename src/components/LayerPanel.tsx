import { useMemo } from 'react'
import { useUiStore } from '@/store/uiStore'
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
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { createLayer, createGroup, duplicateLayer, moveLayer } from '@/lib/project'
import { generatorsByFamily } from '@/lib/generators'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
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
  Copy,
  Plus,
  Group as GroupIcon,
  Layers,
  Trash2,
  Ungroup,
} from 'lucide-react'
import { useProjectStore } from '@/store/projectStore'
import { BlockView } from './layer-panel/BlockView'
import { EmptyLayers } from './layer-panel/EmptyLayers'
import { Tip } from './layer-panel/Tip'
import { useLayerGroups, useLayerSummaries } from './layer-panel/hooks'
import { toBlocks } from './layer-panel/model'

export function LayerPanel() {
  // Projected + shallow-compared (see layer-panel/model.ts): a param edit
  // replaces the layer object, so selecting `s.project.layers` re-rendered the
  // whole panel on every slider tick even though no displayed field changed.
  const layers = useLayerSummaries()
  const groups = useLayerGroups()
  const selectedId = useProjectStore((s) => s.selectedLayerId)
  /** shift/cmd-clicked layers awaiting a group action */
  const multi = useUiStore((s) => s.multiSelect)
  const setMulti = (ids: string[]) => useUiStore.getState().setMultiSelect(ids)

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
    // blocks hold summaries, so map the new order back onto the real layers
    const order = nextBlocks.flatMap((b) => b.layers.map((l) => l.id))
    const store = useProjectStore.getState()
    const byId = new Map(store.project.layers.map((l) => [l.id, l]))
    const flat = order.flatMap((id) => {
      const layer = byId.get(id)
      return layer ? [layer] : []
    })
    if (flat.length !== store.project.layers.length) return
    store.commit({ ...store.project, layers: flat })
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
      setMulti(multi.includes(id) ? multi.filter((x) => x !== id) : [...multi, id])
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

/* end of LayerPanel */
