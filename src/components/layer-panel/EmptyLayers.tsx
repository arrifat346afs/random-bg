/** Empty state: no layers yet, with one-click generator starters. */
import { Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
export function EmptyLayers({ onAdd }: { onAdd: (gen: string) => void }) {
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
