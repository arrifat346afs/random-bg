/** One layer in the panel: swatches, name, generator and the row buttons. */
import { getGenerator } from '@/lib/generators'
import {
  Eye,
  EyeOff,
  GripVertical,
  Lock,
  LockOpen,
  Trash2,
} from 'lucide-react'
import { RowBtn } from './RowBtn'
import type { LayerSummary } from './model'

export function LayerRow({
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
  layer: LayerSummary
  selected: boolean
  multi: boolean
  first: boolean
  last: boolean
  showHandle?: { attributes: unknown; listeners: unknown } | undefined
    handleStyle?: React.CSSProperties
  onClick: (id: string, e: React.MouseEvent) => void
  onToggle: (id: string, key: 'visible' | 'solo' | 'locked') => void
  onMove: (id: string, dir: -1 | 1) => void
  onRemove: (id: string) => void
}) {
  const gen = getGenerator(layer.gen)
  const swatch = layer.swatches[0] ?? '#888888'

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
