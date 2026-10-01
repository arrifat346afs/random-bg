import { useMemo } from 'react'
import { PRESETS, ALL_PRESET_TAGS, buildPreset, type PresetDef } from '@/lib/presets'
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
import { useLibraryStore } from '@/store/libraryStore'
import { Save, Search, Sparkles, Trash2 } from 'lucide-react'
import { Empty } from './preset-browser/Empty'
import { ImportPresetsButton } from './preset-browser/ImportPresetsButton'
import { PresetCard } from './preset-browser/PresetCard'
import { useUiStore } from '@/store/uiStore'
import { useProjectStore } from '@/store/projectStore'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

/** Searchable, tagged browser for the 38 built-in presets + user presets. */
export function PresetBrowser({ open, onOpenChange }: Props) {
  const userPresets = useLibraryStore((s) => s.userPresets)
  const q = useUiStore((s) => s.presetQuery)
  const tag = useUiStore((s) => s.presetTag)
  const setQ = (v: string) => useUiStore.getState().setPresetQuery(v)
  const setTag = (v: string | null) => useUiStore.getState().setPresetTag(v)

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
    useProjectStore.getState().applyProject(proj)
    onOpenChange(false)
  }

  const saveCurrent = () => {
    const name = useProjectStore.getState().project.name || 'Untitled'
    useLibraryStore.getState().saveUserPreset(name, useProjectStore.getState().project.layers.map((l) => l.gen).slice(0, 4))
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
                          useProjectStore.getState().applyProject(structuredClone(p.project))
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
                        onClick={() => useLibraryStore.getState().deleteUserPreset(p.id)}
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

