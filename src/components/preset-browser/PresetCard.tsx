import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { PRESET_PALETTES } from '@/lib/palette'
import { getGenerator } from '@/lib/generators'
import { buildPreset, type PresetDef } from '@/lib/presets'
import { PresetThumbnail } from './PresetThumbnail'

export function PresetCard({ preset, onLoad }: { preset: PresetDef; onLoad: () => void }) {
  const gens = [...new Set(preset.layers.map((l) => l.gen))]
  const layer0 = preset.layers[0]
  const colors = Array.isArray(layer0?.palette)
    ? layer0.palette
    : PRESET_PALETTES[layer0?.palette ?? 'gold'] ?? PRESET_PALETTES.gold
  const project = useMemo(() => buildPreset(preset), [preset])

  return (
    <button
      onClick={onLoad}
      className="group flex flex-col gap-2 rounded-lg border p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md"
    >
      <PresetThumbnail project={project} label={preset.name} />
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold group-hover:text-primary">{preset.name}</span>
        <span className="flex h-4 shrink-0 overflow-hidden rounded">
          {colors.slice(0, 5).map((c, i) => (
            <span key={i} className="w-4" style={{ backgroundColor: c }} />
          ))}
        </span>
      </span>
      <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
        {preset.description}
      </span>
      <span className="flex flex-wrap gap-1">
        {gens.slice(0, 3).map((g) => (
          <Badge key={g} variant="secondary" className="text-[9px]">
            {getGenerator(g)?.name ?? g}
          </Badge>
        ))}
        {preset.tags.slice(0, 3).map((t) => (
          <Badge key={t} variant="muted" className="text-[9px]">
            {t}
          </Badge>
        ))}
      </span>
    </button>
  )
}
