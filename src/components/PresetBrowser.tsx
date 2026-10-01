import { useMemo, useState } from 'react'
import { PRESETS, ALL_PRESET_TAGS, buildPreset, type PresetDef } from '@/lib/presets'
import { getGenerator } from '@/lib/generators'
import { PRESET_PALETTES } from '@/lib/palette'
import { getState, applyProject, saveUserPreset, deleteUserPreset, setState } from '@/lib/state/store'
import { useStore } from '@/lib/state/useStore'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Search, Trash2, Save, Sparkles, ImageOff, FolderOpen } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** Searchable, tagged browser for the 38 built-in presets + user presets. */
export function PresetBrowser({ open, onOpenChange }: Props) {
  const userPresets = useStore((s) => s.userPresets)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return PRESETS.filter((p) => {
      if (tag && !p.tags.includes(tag)) return false
      if (!needle) return true
      return (
        p.name.toLowerCase().includes(needle) ||
        p.description.toLowerCase().includes(needle) ||
        p.tags.some((t) => t.includes(needle))
      )
    })
  }, [q, tag])

  const load = (p: PresetDef) => {
    const proj = buildPreset(p)
    applyProject(proj)
    onOpenChange(false)
  }

  const saveCurrent = () => {
    const name = getState().project.name || 'Untitled'
    saveUserPreset(name, getState().project.layers.map((l) => l.gen).slice(0, 4))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Preset library
          </DialogTitle>
          <DialogDescription>
            {PRESETS.length} hand-tuned starting points. Every one is fully editable — they are
            just layer stacks with a seed.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="built" className="flex min-h-0 flex-1 flex-col">
          <div className="space-y-2 border-b px-4 py-3">
            <TabsList>
              <TabsTrigger value="built">Built-in ({PRESETS.length})</TabsTrigger>
              <TabsTrigger value="mine">Saved ({userPresets.length})</TabsTrigger>
            </TabsList>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, look or tag…"
                className="h-8 pl-8"
                aria-label="Search presets"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <Badge
                variant={tag === null ? 'default' : 'muted'}
                className="cursor-pointer"
                onClick={() => setTag(null)}
              >
                all
              </Badge>
              {ALL_PRESET_TAGS.map((t) => (
                <Badge
                  key={t}
                  variant={tag === t ? 'default' : 'muted'}
                  className="cursor-pointer"
                  onClick={() => setTag(tag === t ? null : t)}
                >
                  {t}
                </Badge>
              ))}
            </div>
          </div>

          <TabsContent value="built" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full px-4 py-3">
              {filtered.length === 0 ? (
                <Empty text="No presets match that search." />
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {filtered.map((p) => (
                    <PresetCard key={p.id} preset={p} onLoad={() => load(p)} />
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="mine" className="mt-0 min-h-0 flex-1 overflow-hidden">
            <ScrollArea className="h-full px-4 py-3">
              <div className="mb-3 flex items-center gap-2">
                <Button size="sm" onClick={saveCurrent}>
                  <Save /> Save current project
                </Button>
                <ImportPresetsButton />
              </div>
              {userPresets.length === 0 ? (
                <Empty text="Nothing saved yet. Tweak a project you like, then hit “Save current project”." />
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {userPresets.map((p) => (
                    <div
                      key={p.id}
                      className="group flex items-start gap-2 rounded-lg border p-3 transition-colors hover:border-primary/50"
                    >
                      <button
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          applyProject(structuredClone(p.project))
                          onOpenChange(false)
                        }}
                      >
                        <span className="block truncate text-sm font-semibold">{p.name}</span>
                        <span className="mt-1 flex flex-wrap gap-1">
                          {p.tags.map((t) => (
                            <Badge key={t} variant="muted">
                              {t}
                            </Badge>
                          ))}
                        </span>
                      </button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Delete saved preset"
                        onClick={() => deleteUserPreset(p.id)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function PresetCard({ preset, onLoad }: { preset: PresetDef; onLoad: () => void }) {
  const gens = [...new Set(preset.layers.map((l) => l.gen))]
  const layer0 = preset.layers[0]
  const colors = Array.isArray(layer0?.palette)
    ? layer0.palette
    : PRESET_PALETTES[layer0?.palette ?? 'gold'] ?? PRESET_PALETTES.gold

  return (
    <button
      onClick={onLoad}
      className="group flex flex-col gap-2 rounded-lg border p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md"
    >
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

function ImportPresetsButton() {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json,.json'
        input.onchange = async () => {
          const file = input.files?.[0]
          if (!file) return
          try {
            const text = await file.text()
            const res = (await import('@/lib/state/store')).importUserPresets(text)
            setState({ error: res.ok ? null : res.error ?? 'Import failed' })
          } catch (err) {
            setState({ error: err instanceof Error ? err.message : 'Import failed' })
          }
        }
        input.click()
      }}
    >
      <FolderOpen /> Import JSON
    </Button>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-center">
      <ImageOff className="h-5 w-5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  )
}
