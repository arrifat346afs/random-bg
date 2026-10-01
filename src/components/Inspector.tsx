import { useMemo, useState } from 'react'
import { getGenerator } from '@/lib/generators'
import {
  DIST_OPTIONS,
  type DistSpec,
  type Layer,
  type ParamDef,
  type ParamValue,
} from '@/lib/schema'
import { BLEND_MODES, type BlendMode } from '@/lib/ir'
import { MODIFIER_DEFS } from '@/lib/modifiers'
import { renderMaskDataURL } from '@/lib/mask'
import { createRng, hash32 } from '@/lib/rng'
import { randomParamValue, randomizeParams, randomDist, randomLayer } from '@/lib/randomize'
import { getState, patchProject, setState, updateLayer } from '@/lib/state/store'
import { withProjectPalette, pushPaletteToAll } from '@/lib/project'
import { effectivePalette, isPaletteLinked } from '@/lib/palette'
import type { Color } from '@/lib/ir'
import { useStore } from '@/lib/state/useStore'
import { ParamField } from '@/components/ParamField'
import { PaletteEditor } from '@/components/PaletteEditor'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  Dices,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Sparkles,
  Palette,
  Shuffle,
  Info,
  Link2,
  Unlink,
} from 'lucide-react'

const SECTION_LABELS: Record<string, string> = {
  shape: 'Shape',
  style: 'Style',
  depth: 'Depth & focus',
  motion: 'Motion',
}

/* ---- distribution field schema ------------------------------------------ */

interface DistField {
  key: keyof DistSpec
  label: string
  min?: number
  max?: number
  step?: number
  unit?: string
  hint?: string
  when?: DistSpec['type'][]
  options?: { value: string; label: string }[]
}

const DIST_FIELDS: DistField[] = [
  { key: 'clusters', label: 'Clusters / cells', min: 2, max: 64, step: 1, when: ['clustered', 'gridJitter'] },
  { key: 'curve', label: 'Curve', options: [
    { value: 'sine', label: 'Sine' },
    { value: 'arc', label: 'Arc' },
    { value: 'diagonal', label: 'Diagonal' },
    { value: 'spiral', label: 'Spiral' },
    { value: 'v', label: 'V shape' },
  ], when: ['curve'] },
  { key: 'curveAmount', label: 'Curve amount', min: 0, max: 1, step: 0.01, when: ['curve', 'sineBand', 'spiral'] },
  { key: 'band', label: 'Band thickness', min: 0.02, max: 0.6, step: 0.01, when: ['sineBand'] },
  { key: 'arms', label: 'Arms', min: 1, max: 10, step: 1, when: ['spiral', 'sineBand'] },
  { key: 'inner', label: 'Inner radius', min: 0, max: 0.9, step: 0.01, when: ['radial', 'spiral'] },
  { key: 'radialFalloff', label: 'Radial falloff', min: 0.2, max: 3, step: 0.05, when: ['radial'], hint: '>1 packs toward the rim, <1 toward the centre' },
  { key: 'radius', label: 'Min spacing', min: 0.01, max: 0.25, step: 0.005, when: ['poisson'], hint: 'As a fraction of the shorter edge' },
  { key: 'noiseScale', label: 'Noise scale', min: 0.3, max: 12, step: 0.1, when: ['noiseMask'] },
  { key: 'noiseThreshold', label: 'Noise threshold', min: 0, max: 1, step: 0.01, when: ['noiseMask'] },
  { key: 'noiseContrast', label: 'Noise contrast', min: 0.3, max: 3, step: 0.05, when: ['noiseMask'] },
]

const SHAPE_FIELDS: DistField[] = [
  { key: 'sizePower', label: 'Size curve', min: 0.1, max: 4, step: 0.05, hint: 'Power curve applied to the size ramp' },
  { key: 'sizeMin', label: 'Size min', min: 0, max: 1, step: 0.01 },
  { key: 'sizeMax', label: 'Size max', min: 0.01, max: 1, step: 0.01 },
  { key: 'opacityFalloff', label: 'Opacity falloff', min: 0, max: 1, step: 0.01, hint: 'Fade with depth and distance' },
  { key: 'edgeFalloff', label: 'Edge density falloff', min: 0, max: 1, step: 0.01, hint: 'Fewer primitives near the border' },
  { key: 'depth', label: 'Depth spread', min: 0, max: 1, step: 0.01, hint: 'Drives size & blur variation' },
]

export function Inspector() {
  const layer = useStore((s) => s.project.layers.find((l) => l.id === s.selectedLayerId) ?? null)
  const tab = useStore((s) => s.inspectorTab)

  if (!layer) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Sparkles className="h-7 w-7 text-muted-foreground" />
        <p className="text-sm font-medium">Nothing selected</p>
        <p className="text-xs text-muted-foreground">
          Pick a layer on the left to edit its generator, distribution, colour and effects.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LayerHeader layer={layer} />
      <Tabs
        value={tab}
        onValueChange={(v) => setState({ inspectorTab: v as typeof tab })}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="px-2 pt-2">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="params">Params</TabsTrigger>
            <TabsTrigger value="distribute">Distribute</TabsTrigger>
            <TabsTrigger value="colour">Colour</TabsTrigger>
            <TabsTrigger value="effects">Effects</TabsTrigger>
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
        </div>
      </Tabs>
    </div>
  )
}

/* ---- header --------------------------------------------------------------- */

function LayerHeader({ layer }: { layer: Layer }) {
  const gen = getGenerator(layer.gen)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(layer.name)

  const toggle = (key: 'visible' | 'locked' | 'solo') =>
    updateLayer(layer.id, (l) => ({ ...l, [key]: !l[key] }))

  return (
    <div className="border-b p-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                updateLayer(layer.id, (l) => ({ ...l, name: draft.trim() || l.name }))
                setRenaming(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') {
                  setDraft(layer.name)
                  setRenaming(false)
                }
              }}
              className="h-7"
            />
          ) : (
            <button
              className="block w-full truncate text-left text-sm font-semibold hover:text-primary"
              onDoubleClick={() => {
                setDraft(layer.name)
                setRenaming(true)
              }}
              title="Double-click to rename"
            >
              {layer.name}
            </button>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <Badge variant="muted">{gen?.family ?? 'unknown'}</Badge>
            <span className="truncate text-[10px] text-muted-foreground">
              {gen?.description ?? 'Unknown generator'}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <MiniToggle active={layer.visible} onClick={() => toggle('visible')} label="Visibility">
            {layer.visible ? <Eye /> : <EyeOff />}
          </MiniToggle>
          <MiniToggle active={layer.solo} onClick={() => toggle('solo')} label="Solo">
            <span className="text-[10px] font-bold">S</span>
          </MiniToggle>
          <MiniToggle active={layer.locked} onClick={() => toggle('locked')} label="Lock layer">
            {layer.locked ? <Lock /> : <LockOpen />}
          </MiniToggle>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-[1fr_100px] items-center gap-2">
        <div>
          <div className="mb-0.5 flex items-center justify-between">
            <Label className="text-[10px] text-muted-foreground">Opacity</Label>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {Math.round(layer.opacity * 100)}%
            </span>
          </div>
          <Slider
            value={[layer.opacity]}
            min={0}
            max={1}
            step={0.01}
            disabled={layer.locked}
            onValueChange={([v]) =>
              updateLayer(layer.id, (l) => ({ ...l, opacity: v }), {
                coalesce: `${layer.id}:opacity`,
              })
            }
          />
        </div>
        <div>
          <Label className="mb-0.5 block text-[10px] text-muted-foreground">Blend</Label>
          <Select
            value={layer.blend}
            disabled={layer.locked}
            onValueChange={(v) =>
              updateLayer(layer.id, (l) => ({ ...l, blend: v as BlendMode }))
            }
          >
            <SelectTrigger className="h-7 text-[11px]" aria-label="Blend mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BLEND_MODES.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

function MiniToggle({
  active,
  onClick,
  label,
  children,
}: {
  active?: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={label}
          aria-pressed={!!active}
          onClick={onClick}
          className={`h-6 w-6 ${active ? 'text-primary' : 'text-muted-foreground'}`}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/* ---- params tab ----------------------------------------------------------- */

function ParamsTab({ layer }: { layer: Layer }) {
  const gen = getGenerator(layer.gen)

  // Hooks must run unconditionally, so group defensively before the early return.
  const grouped = useMemo(() => {
    const map = new Map<string, ParamDef[]>()
    for (const def of gen?.params ?? []) {
      const section = def.section ?? 'shape'
      const arr = map.get(section) ?? []
      arr.push(def)
      map.set(section, arr)
    }
    return [...map.entries()]
  }, [gen])

  if (!gen) return <p className="text-xs text-muted-foreground">Unknown generator.</p>

  const visible = (def: ParamDef) => {
    if (!def.when) return true
    return layer.params[def.when.key] === def.when.equals
  }

  const rng = createRng(hash32(getState().project.seed, layer.id, layer.seedOffset, 'param'))

  const setValue = (key: string, v: ParamValue) =>
    updateLayer(
      layer.id,
      (l) => ({ ...l, params: { ...l.params, [key]: v } }),
      { coalesce: `${layer.id}:${key}` },
    )

  const setLock = (key: string) =>
    updateLayer(layer.id, (l) => {
      const locks = { ...l.locks }
      if (locks[key]) delete locks[key]
      else locks[key] = true
      return { ...l, locks }
    })

  const randomizeOne = (def: ParamDef) => {
    if (layer.locks[def.key]) return
    const v = randomParamValue(def, rng, 0)
    setValue(def.key, v)
  }

  const randomizeAll = () => {
    const { params, locks } = randomizeParams(
      gen.params,
      rng,
      layer.params,
      layer.locks,
    )
    updateLayer(layer.id, (l) => ({ ...l, params, locks }))
  }

  return (
    <div className="space-y-1">
      <div className="mb-2 flex items-center justify-between gap-1 rounded-lg bg-muted/60 p-1.5">
        <span className="pl-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {gen.params.length} parameters
        </span>
        <div className="flex gap-1">
          <Button size="sm" variant="secondary" onClick={randomizeAll}>
            <Dices /> Randomise all
          </Button>
        </div>
      </div>

      <Accordion type="multiple" defaultValue={grouped.map(([s]) => s)} className="w-full">
        {grouped.map(([section, defs]) => {
          const shown = defs.filter(visible)
          if (!shown.length) return null
          return (
            <AccordionItem key={section} value={section}>
              <AccordionTrigger>{SECTION_LABELS[section] ?? section}</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-0.5">
                  {shown.map((def) => (
                    <ParamField
                      key={def.key}
                      def={def}
                      value={layer.params[def.key] ?? def.default}
                      locked={layer.locked || !!layer.locks[def.key]}
                      onChange={(v) => setValue(def.key, v)}
                      onToggleLock={() => setLock(def.key)}
                      onRandomize={() => randomizeOne(def)}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    </div>
  )
}

/* ---- distribution tab ------------------------------------------------------ */

function DistributeTab({ layer }: { layer: Layer }) {
  const rng = createRng(hash32(getState().project.seed, layer.id, layer.seedOffset, 'dist'))

  const setDist = (patch: Partial<DistSpec>, coalesce?: string) =>
    updateLayer(layer.id, (l) => ({ ...l, dist: { ...l.dist, ...patch } }), {
      coalesce: coalesce ? `${layer.id}:${coalesce}` : undefined,
    })

  const reset = () => setDist({ ...defaultShape() })

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1 block">Distribution</Label>
        <div className="flex gap-1">
          <Select value={layer.dist.type} onValueChange={(v) => setDist({ type: v as DistSpec['type'] })}>
            <SelectTrigger className="flex-1" aria-label="Distribution type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIST_OPTIONS.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="icon-sm" variant="outline" onClick={() => setDist(randomDist(layer.gen, rng))} title="Random distribution">
            <Shuffle />
          </Button>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Shared across every generator — change it here for any layer.
        </p>
      </div>

      <Separator />

      {DIST_FIELDS.filter((f) => !f.when || f.when.includes(layer.dist.type)).map((f) => (
        <DistNumField
          key={String(f.key)}
          field={f}
          value={layer.dist[f.key]}
          disabled={layer.locked}
          onChange={(v) => setDist({ [f.key]: v } as Partial<DistSpec>, String(f.key))}
        />
      ))}

      <Separator />
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Info className="h-3 w-3" /> Shared shaping
      </p>
      {SHAPE_FIELDS.map((f) => (
        <DistNumField
          key={String(f.key)}
          field={f}
          value={layer.dist[f.key]}
          disabled={layer.locked}
          onChange={(v) => setDist({ [f.key]: v } as Partial<DistSpec>, String(f.key))}
        />
      ))}

      {layer.dist.type === 'imageMask' && (
        <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          <p className="mb-2 font-medium text-foreground">Image mask</p>
          <p className="mb-2">
            Paint a soft mask and every generator on this layer will sample it as a density map.
          </p>
          <MaskPicker
            value={layer.dist.mask}
            onChange={(mask) => setDist({ mask, type: 'imageMask' })}
          />
        </div>
      )}

      <Button size="sm" variant="ghost" className="w-full" onClick={reset}>
        Reset distribution
      </Button>
    </div>
  )
}

function defaultShape(): Partial<DistSpec> {
  return {
    sizePower: 1,
    sizeMin: 0.4,
    sizeMax: 1,
    opacityFalloff: 0.2,
    edgeFalloff: 0,
    depth: 0.4,
  }
}

function DistNumField({
  field,
  value,
  onChange,
  disabled,
}: {
  field: DistField
  value: unknown
  onChange: (v: number | string) => void
  disabled?: boolean
}) {
  if (field.options) {
    return (
      <div className="grid grid-cols-[1fr_130px] items-center gap-2 py-1">
        <Label className="text-xs">{field.label}</Label>
        <Select
          value={String(value)}
          disabled={disabled}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger className="h-7 text-[11px]" aria-label={field.label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }
  const num = typeof value === 'number' ? value : Number(value)
  const step = field.step ?? 0.01
  return (
    <div className="py-1">
      <div className="mb-1 flex items-center justify-between gap-2">
        <Label className="text-xs">
          {field.label}
          {field.unit && <span className="ml-1 font-normal text-muted-foreground">{field.unit}</span>}
        </Label>
        <Input
          type="number"
          value={Number.isFinite(num) ? Number(num.toFixed(4)) : 0}
          min={field.min}
          max={field.max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-6 w-[70px] shrink-0 px-1 text-right text-[11px] tabular-nums"
        />
      </div>
      <Slider
        value={[num]}
        min={field.min ?? 0}
        max={field.max ?? 1}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
        aria-label={field.label}
      />
      {field.hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{field.hint}</p>}
    </div>
  )
}

function MaskPicker({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  const [kind, setKind] = useState<'radial' | 'linear'>('radial')
  const [angle, setAngle] = useState(90)
  const [busy, setBusy] = useState(false)

  const paint = () => {
    setBusy(true)
    try {
      onChange(renderMaskDataURL(kind, angle))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select value={kind} onValueChange={(v) => setKind(v as 'radial' | 'linear')}>
        <SelectTrigger className="w-[110px] h-7 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="radial">Radial</SelectItem>
          <SelectItem value="linear">Linear</SelectItem>
        </SelectContent>
      </Select>
      {kind === 'linear' && (
        <Input
          type="number"
          value={angle}
          min={0}
          max={360}
          onChange={(e) => setAngle(Number(e.target.value))}
          className="h-7 w-[68px] text-right text-[11px]"
        />
      )}
      <Button size="sm" variant="outline" onClick={paint} disabled={busy}>
        {busy ? 'Painting…' : value ? 'Repaint mask' : 'Paint mask'}
      </Button>
      {value && (
        <img src={value} alt="Mask preview" className="h-8 w-8 rounded border object-cover" />
      )}
    </div>
  )
}

/* ---- colour tab ------------------------------------------------------------ */

function ColourTab({ layer }: { layer: Layer }) {
  const projectPalette = useStore((s) => s.project.palette)
  const linkedCount = useStore((s) => s.project.layers.filter((l) => isPaletteLinked(l.color)).length)
  const layerCount = useStore((s) => s.project.layers.length)
  const linked = isPaletteLinked(layer.color)
  const shownPalette = linked
    ? projectPalette
    : layer.color.palette

  const setColor = (patch: Partial<Layer['color']>, coalesce?: string) =>
    updateLayer(layer.id, (l) => ({ ...l, color: { ...l.color, ...patch } }), {
      coalesce: coalesce ? `${layer.id}:c:${coalesce}` : undefined,
    })

  const setPaletteColors = (colors: Color[], name?: string) => {
    if (linked) {
      patchProject((p) => withProjectPalette(p, colors, name ?? p.palette.name), {
        coalesce: `palette:global`,
      })
    } else {
      setColor({ palette: { ...layer.color.palette, colors: colors.slice(), ...(name ? { name } : {}) } })
    }
  }

  const unlink = () =>
    updateLayer(layer.id, (l) => ({
      ...l,
      color: {
        ...l.color,
        linked: false,
        palette: { ...effectivePalette(projectPalette, l.color), colors: effectivePalette(projectPalette, l.color).colors.slice() },
      },
    }))

  const relink = () =>
    updateLayer(layer.id, (l) => ({
      ...l,
      color: { ...l.color, linked: true, palette: { ...projectPalette, colors: projectPalette.colors.slice() } },
    }))

  const pushAll = () => patchProject((p) => pushPaletteToAll(p, layer.id))

  const modes: { value: Layer['color']['mode']; label: string; hint: string }[] = [
    { value: 'palette', label: 'Palette', hint: 'Sample colours straight from the ramp.' },
    { value: 'position', label: 'By position', hint: 'Project colour across the canvas on an axis.' },
    { value: 'size', label: 'By size', hint: 'Big primitives get one end of the ramp, small the other.' },
    { value: 'random', label: 'Random', hint: 'Every primitive picks its own colour.' },
  ]

  return (
    <div className="space-y-3">
      <div>
        <Label className="mb-1 block">Colour mapping</Label>
        <div className="grid grid-cols-2 gap-1">
          {modes.map((m) => (
            <button
              key={m.value}
              onClick={() => setColor({ mode: m.value })}
              title={m.hint}
              className={`rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors ${
                layer.color.mode === m.value
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border hover:bg-accent'
              }`}
            >
              <span className="block font-medium">{m.label}</span>
              <span className="block text-[9px] leading-tight text-muted-foreground">{m.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-[1fr_74px] items-center gap-2 py-1">
        <Label className="text-xs">Ramp shape</Label>
        <Select
          value={layer.color.ramp}
          onValueChange={(v) => setColor({ ramp: v as Layer['color']['ramp'] }, 'ramp')}
        >
          <SelectTrigger className="h-7 text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="linear">Smooth</SelectItem>
            <SelectItem value="ease">Ease</SelectItem>
            <SelectItem value="bilinear">Banded</SelectItem>
            <SelectItem value="mirror">Mirror</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(layer.color.mode === 'position' || layer.color.mode === 'rampAngle') && (
        <div className="py-1">
          <div className="mb-1 flex items-center justify-between">
            <Label className="text-xs">Axis angle</Label>
            <span className="text-[10px] tabular-nums text-muted-foreground">{layer.color.axis}°</span>
          </div>
          <Slider
            value={[layer.color.axis]}
            min={0}
            max={360}
            step={1}
            onValueChange={([v]) => setColor({ axis: v }, 'axis')}
            aria-label="Axis angle"
          />
        </div>
      )}

      <div className="flex items-center justify-between py-1">
        <div>
          <Label htmlFor="inv">Invert ramp</Label>
          <p className="text-[10px] text-muted-foreground">Flip the mapping direction.</p>
        </div>
        <Switch
          id="inv"
          checked={layer.color.invert}
          onCheckedChange={(v) => setColor({ invert: v })}
        />
      </div>

      <Separator />

      <div
        className={`flex items-center justify-between gap-2 rounded-lg border p-2 ${
          linked ? 'border-primary/40 bg-primary/5' : 'border-dashed'
        }`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {linked ? <Link2 className="h-3.5 w-3.5 shrink-0 text-primary" /> : <Unlink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <div className="min-w-0">
            <p className="truncate text-[11px] font-medium">
              {linked ? `Linked · ${linkedCount}/${layerCount} layers` : 'Custom colours'}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              {linked
                ? 'Edits here update every linked layer.'
                : 'This layer ignores the project palette.'}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {!linked && (
            <>
              <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={pushAll}>
                Push to all
              </Button>
              <Button size="sm" variant="secondary" className="h-6 px-2 text-[10px]" onClick={relink}>
                Relink
              </Button>
            </>
          )}
          {linked && layerCount > 1 && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={unlink}>
              Unlink
            </Button>
          )}
        </div>
      </div>

      <PaletteEditor
        palette={shownPalette}
        onChange={(palette) => setPaletteColors(palette.colors, palette.name)}
      />
    </div>
  )
}

/* ---- effects tab ------------------------------------------------------------ */

function EffectsTab({ layer }: { layer: Layer }) {
  const [addOpen, setAddOpen] = useState(false)

  const setMod = (index: number, patch: Partial<Layer['mods'][number]>) =>
    updateLayer(layer.id, (l) => {
      const mods = l.mods.slice()
      mods[index] = { ...mods[index], ...patch }
      return { ...l, mods }
    })

  const move = (index: number, dir: -1 | 1) =>
    updateLayer(layer.id, (l) => {
      const mods = l.mods.slice()
      const to = index + dir
      if (to < 0 || to >= mods.length) return l
      const [m] = mods.splice(index, 1)
      mods.splice(to, 0, m)
      return { ...l, mods }
    })

  const add = (type: Layer['mods'][number]['type']) => {
    updateLayer(layer.id, (l) => {
      if (l.mods.some((m) => m.type === type)) return l
      const def = MODIFIER_DEFS[type]
      return {
        ...l,
        mods: [
          ...l.mods,
          {
            type,
            enabled: true,
            amount: def.amount.default,
            secondary: def.secondary?.default ?? 0,
            tertiary: def.tertiary?.default ?? 0,
          },
        ],
      }
    })
    setAddOpen(false)
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-2.5">
        <div className="mb-1 flex items-center justify-between">
          <Label className="text-xs">Layer seed offset</Label>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                updateLayer(layer.id, (l) => ({ ...l, seedOffset: l.seedOffset + 1 }))
              }
            >
              +1
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                updateLayer(layer.id, (l) => ({ ...l, seedOffset: l.seedOffset - 1 }))
              }
            >
              −1
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              title="New random seed"
              onClick={() =>
                updateLayer(layer.id, (l) => ({
                  ...l,
                  seedOffset: Math.floor(Math.random() * 100000),
                }))
              }
            >
              <Dices />
            </Button>
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Current: <code className="font-mono">{layer.seedOffset}</code> — changing it reshuffles this
          layer without touching others.
        </p>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Modifiers</Label>
          <Button size="sm" variant="secondary" onClick={() => setAddOpen((v) => !v)}>
            <Plus /> Add
          </Button>
        </div>

        {addOpen && (
          <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-1.5">
            {Object.values(MODIFIER_DEFS).map((def) => (
              <button
                key={def.type}
                onClick={() => add(def.type)}
                disabled={layer.mods.some((m) => m.type === def.type)}
                title={def.hint}
                className="rounded px-1.5 py-1 text-left text-[11px] hover:bg-background disabled:opacity-40"
              >
                {def.label}
              </button>
            ))}
          </div>
        )}

        {layer.mods.length === 0 && !addOpen && (
          <p className="rounded-lg border border-dashed p-3 text-center text-[11px] text-muted-foreground">
            No modifiers. Add noise, twist, kaleidoscope, array, fades… they stack in order.
          </p>
        )}

        <div className="space-y-2">
          {layer.mods.map((mod, i) => {
            const def = MODIFIER_DEFS[mod.type]
            if (!def) return null
            return (
              <div key={`${mod.type}-${i}`} className="rounded-lg border p-2">
                <div className="mb-1 flex items-center justify-between gap-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[11px] font-semibold">{def.label}</span>
                    <Badge variant="muted">#{i + 1}</Badge>
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <MiniToggle
                      active={mod.enabled}
                      onClick={() => setMod(i, { enabled: !mod.enabled })}
                      label="Enable modifier"
                    >
                      <Eye />
                    </MiniToggle>
                    <MiniToggle onClick={() => move(i, -1)} label="Move up">
                      <ChevronUp />
                    </MiniToggle>
                    <MiniToggle onClick={() => move(i, 1)} label="Move down">
                      <ChevronDown />
                    </MiniToggle>
                    <MiniToggle
                      onClick={() =>
                        updateLayer(layer.id, (l) => ({
                          ...l,
                          mods: l.mods.filter((_, k) => k !== i),
                        }))
                      }
                      label="Remove modifier"
                    >
                      <Trash2 />
                    </MiniToggle>
                  </div>
                </div>
                <p className="mb-1 text-[10px] text-muted-foreground">{def.hint}</p>
                <ModSlider
                  label={def.amount.label}
                  value={mod.amount}
                  min={def.amount.min}
                  max={def.amount.max}
                  step={def.amount.step}
                  disabled={!mod.enabled || layer.locked}
                  onChange={(v) => setMod(i, { amount: v })}
                />
                {def.secondary && (
                  <ModSlider
                    label={def.secondary.label}
                    value={mod.secondary}
                    min={def.secondary.min}
                    max={def.secondary.max}
                    step={def.secondary.step}
                    disabled={!mod.enabled || layer.locked}
                    onChange={(v) => setMod(i, { secondary: v })}
                  />
                )}
                {def.tertiary && (
                  <ModSlider
                    label={def.tertiary.label}
                    value={mod.tertiary}
                    min={def.tertiary.min}
                    max={def.tertiary.max}
                    step={def.tertiary.step}
                    disabled={!mod.enabled || layer.locked}
                    onChange={(v) => setMod(i, { tertiary: v })}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const next = randomLayer({
              genId: layer.gen,
              palette: effectivePalette(getState().project.palette, layer.color),
              rng: createRng(Math.floor(Math.random() * 1e9)),
            })
            updateLayer(layer.id, () => ({ ...layer, ...next, id: layer.id, name: layer.name }))
          }}
        >
          <Dices /> Re-roll layer
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            updateLayer(layer.id, (l) => ({ ...l, locks: {}, seedOffset: l.seedOffset + 7 }))
          }}
        >
          <Palette /> Reseed + unlock
        </Button>
      </div>
    </div>
  )
}

function ModSlider({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  onChange: (v: number) => void
}) {
  return (
    <div className="py-0.5">
      <div className="mb-0.5 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <span className="text-[10px] tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={([v]) => onChange(v)}
        aria-label={label}
      />
    </div>
  )
}

/* end of Inspector */
