/**
 * Inspector — the right-hand property panel for the selected layer.
 *
 * A tab shell only. The tabs themselves live in `./inspector/` along with the
 * field tables that drive them; this file decides which one is showing and
 * what happens when nothing is selected.
 */

import { Sparkles } from 'lucide-react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ColourTab } from './inspector/ColourTab'
import { DistributeTab } from './inspector/DistributeTab'
import { EffectsTab } from './inspector/EffectsTab'
import { FiltersTab } from './inspector/FiltersTab'
import { ParamsTab } from './inspector/ParamsTab'
import { LayerHeader } from './inspector/LayerHeader'
import { useProjectStore } from '@/store/projectStore'
import { useUiStore } from '@/store/uiStore'

const EMPTY = (
  <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
    <Sparkles className="h-7 w-7 text-muted-foreground" />
    <p className="text-sm font-medium">Nothing selected</p>
    <p className="text-xs text-muted-foreground">
      Pick a layer on the left to edit its generator, distribution, colour and effects.
    </p>
  </div>
)

export function Inspector() {
  const layer = useProjectStore((s) => s.project.layers.find((l) => l.id === s.selectedLayerId) ?? null)
  const tab = useUiStore((s) => s.inspectorTab)

  if (!layer) return EMPTY

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LayerHeader layer={layer} />
      <Tabs
        value={tab}
        onValueChange={(v) => useUiStore.getState().setInspectorTab(v as typeof tab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="px-2 pt-2">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="params">Params</TabsTrigger>
            <TabsTrigger value="distribute">Distribute</TabsTrigger>
            <TabsTrigger value="colour">Colour</TabsTrigger>
            <TabsTrigger value="effects">Effects</TabsTrigger>
            <TabsTrigger value="filters">Filters</TabsTrigger>
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto thin-scroll px-3 pb-6 pt-3">
          <TabsContent value="params" className="mt-0">
            <ParamsTab layer={layer} />
          </TabsContent>
          <TabsContent value="distribute" className="mt-0">
            <DistributeTab layer={layer} />
          </TabsContent>
          <TabsContent value="colour" className="mt-0">
            <ColourTab layer={layer} />
          </TabsContent>
          <TabsContent value="effects" className="mt-0">
            <EffectsTab layer={layer} />
          </TabsContent>
          <TabsContent value="filters" className="mt-0">
            <FiltersTab layer={layer} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}