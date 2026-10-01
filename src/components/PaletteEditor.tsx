import { useState } from 'react'
import {
  HARMONIES,
  PRESET_PALETTES,
  generatePalette,
  hexToHsl,
  hslToHex,
  type Harmony,
  type Palette,
} from '@/lib/palette'
import { createRng } from '@/lib/rng'
import type { Color } from '@/lib/ir'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Plus, Shuffle, Trash2, Wand2, Copy, Check } from 'lucide-react'

const MIN_COLORS = 2
const MAX_COLORS = 8

interface Props {
  palette: Palette
  onChange: (palette: Palette) => void
}

/**
 * PaletteEditor — the colour source for a layer.
 *
 * Every generator reads colours from here, so a single editor drives the
 * colour of all 10 generators. Layers are 2–8 stops; the ramp shape and the
 * colour-mapping mode live in the Colour tab next to this component.
 *
 * When the layer is linked (default), `palette` is the project palette and
 * edits propagate to every linked layer.
 */
export function PaletteEditor({ palette, onChange }: Props) {
  const [harmony, setHarmony] = useState<Harmony>('analogous')
  const [copied, setCopied] = useState<number | null>(null)
  const colors = palette.colors

  const setColors = (next: Color[]) =>
    onChange({ ...palette, colors: next.slice(0, MAX_COLORS) })

  const updateColor = (i: number, hex: string) => {
    const next = colors.slice()
    next[i] = hex
    setColors(next)
  }

  const addColor = () => {
    if (colors.length >= MAX_COLORS) return
    // Add a new stop that is a gentle nudge of the last one so ramps stay
    // harmonious rather than jumping to an unrelated hue.
    const [h, s, l] = hexToHsl(colors[colors.length - 1] ?? '#ffffff')
    setColors([...colors, hslToHex((h + 42) % 360, Math.min(100, s + 6), l)])
  }

  const removeColor = (i: number) => {
    if (colors.length <= MIN_COLORS) return
    setColors(colors.filter((_, k) => k !== i))
  }

  const randomise = () => {
    const rng = createRng((Math.random() * 0xffffffff) >>> 0)
    const p = generatePalette(rng, harmony, 2 + Math.floor(rng.next() * 5))
    onChange({ ...palette, colors: p.colors })
  }

  const shiftHue = (delta: number) => {
    setColors(
      colors.map((c) => {
        const [h, s, l] = hexToHsl(c)
        return hslToHex((h + delta + 360) % 360, s, l)
      }),
    )
  }

  const copyHex = async (hex: string, i: number) => {
    try {
      await navigator.clipboard.writeText(hex)
      setCopied(i)
      window.setTimeout(() => setCopied(null), 900)
    } catch {
      /* clipboard blocked — silently ignore, the value is in the input */
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
          Palette
        </Label>
        <div className="flex items-center gap-1">
          <Badge variant="muted">{colors.length} stops</Badge>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Add colour"
            disabled={colors.length >= MAX_COLORS}
            onClick={addColor}
          >
            <Plus />
          </Button>
        </div>
      </div>

      {/* Swatches — click to open a native colour picker */}
      <div className="grid grid-cols-4 gap-1.5">
        {colors.map((hex, i) => (
          <div key={i} className="group relative">
            <label
              className="block h-9 w-full cursor-pointer rounded-md border shadow-sm ring-offset-background transition-shadow focus-within:ring-2 focus-within:ring-ring"
              style={{ backgroundColor: hex }}
              title={`${hex} — click to edit`}
            >
              <input
                type="color"
                value={hex}
                aria-label={`Colour ${i + 1}`}
                onChange={(e) => updateColor(i, e.target.value)}
                className="h-full w-full cursor-pointer opacity-0"
              />
            </label>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-1">
              <span className="pointer-events-none font-mono text-[8px] uppercase text-black/60 mix-blend-difference">
                {hex.replace('#', '')}
              </span>
            </div>
            {colors.length > MIN_COLORS && (
              <button
                aria-label={`Remove colour ${i + 1}`}
                onClick={() => removeColor(i)}
                className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm hover:text-destructive group-hover:flex"
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            )}
            <button
              aria-label={`Copy ${hex}`}
              onClick={() => copyHex(hex, i)}
              className="absolute right-0.5 top-0.5 hidden h-3.5 w-3.5 items-center justify-center rounded bg-background/80 text-muted-foreground hover:text-foreground group-hover:flex"
            >
              {copied === i ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
            </button>
          </div>
        ))}
      </div>

      {/* Harmony generator */}
      <div className="rounded-lg border bg-muted/40 p-2">
        <div className="mb-1.5 flex items-center justify-between">
          <Label className="text-[10px] text-muted-foreground">Generate</Label>
          <span className="text-[10px] text-muted-foreground">{colors.length} stops</span>
        </div>
        <div className="flex gap-1">
          <Select value={harmony} onValueChange={(v) => setHarmony(v as Harmony)}>
            <SelectTrigger className="h-7 flex-1 text-[11px]" aria-label="Colour harmony">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HARMONIES.map((h) => (
                <SelectItem key={h} value={h}>
                  {h}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="secondary" onClick={randomise} title="New palette">
            <Wand2 /> Make
          </Button>
        </div>
        <div className="mt-1.5 flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 flex-1 text-[10px]"
            onClick={() => shiftHue(30)}
          >
            Hue +30°
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 flex-1 text-[10px]"
            onClick={() => shiftHue(-30)}
          >
            Hue −30°
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 flex-1 text-[10px]"
            onClick={() => setColors(colors.slice().reverse())}
          >
            <Shuffle className="h-3 w-3" /> Flip
          </Button>
        </div>
      </div>

      {/* Named preset palettes */}
      <div>
        <Label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
          Named palettes
        </Label>
        <div className="space-y-0.5">
          {Object.entries(PRESET_PALETTES).map(([name, cols]) => (
            <button
              key={name}
              onClick={() => setColors(cols.slice())}
              className="flex w-full items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:border-border hover:bg-accent"
            >
              <span className="flex h-4 shrink-0 overflow-hidden rounded">
                {cols.map((c, i) => (
                  <span key={i} className="w-4" style={{ backgroundColor: c }} />
                ))}
              </span>
              <span className="truncate text-[11px]">{name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Raw hex editing for precision work */}
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" className="w-full text-[11px]">
            Edit as hex list
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
          <Label className="mb-1 block text-xs">Comma-separated hex</Label>
          <Input
            defaultValue={colors.join(', ')}
            key={colors.join(',')}
            onBlur={(e) => {
              const parsed = e.target.value
                .split(/[\s,]+/)
                .map((s) => s.trim())
                .filter((s) => /^#?[0-9a-fA-F]{3,8}$/.test(s))
                .map((s) => (s.startsWith('#') ? s : `#${s}`))
              if (parsed.length >= MIN_COLORS) setColors(parsed)
            }}
            className="h-7 font-mono text-[11px]"
            placeholder="#ff6b9d, #ffd166"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Between {MIN_COLORS} and {MAX_COLORS} colours. Invalid entries are ignored.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  )
}
