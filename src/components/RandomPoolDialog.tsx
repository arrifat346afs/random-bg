import { GENERATORS, generatorsByFamily } from '@/lib/generators'
import { useUiStore } from '@/store/uiStore'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

export function RandomPoolDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const pool = useUiStore((s) => s.randomPool)
  const patch = (p: Partial<typeof pool>) => useUiStore.getState().patchRandomPool(p)
  const toggleGen = (id: string) => useUiStore.getState().toggleRandomGen(id)
  const groups = generatorsByFamily()
  const onCount = GENERATORS.filter((g) => pool.gens[g.id] ?? true).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Randomise pool — {onCount}/{GENERATORS.length} effects</DialogTitle>
          <DialogDescription>
            Choose which effects and backgrounds Randomise may pick. Everything on = previous behaviour.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
          {groups.map(({ family, gens }) => (
            <div key={family}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{family}</span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => {
                      const next = { ...pool.gens }
                      for (const g of gens) delete next[g.id]
                      patch({ gens: next })
                    }}
                  >
                    All
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => {
                      const next = { ...pool.gens }
                      for (const g of gens) next[g.id] = false
                      patch({ gens: next })
                    }}
                  >
                    None
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {gens.map((g) => {
                  const on = pool.gens[g.id] ?? true
                  return (
                    <label key={g.id} className="flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs">
                      <span className={on ? undefined : 'text-muted-foreground'}>{g.name}</span>
                      <Switch checked={on} onCheckedChange={() => toggleGen(g.id)} />
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-2 rounded-lg border p-2.5">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Backgrounds</div>
          {(
            [
              ['bgSolid', 'Solid'],
              ['bgGradient', 'Gradient'],
              ['bgTransparent', 'Transparent'],
              ['bgNoise', 'Noise / grain'],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <span className="text-xs">{label}</span>
              <Switch checked={pool[key]} onCheckedChange={(v) => patch({ [key]: v } as Partial<typeof pool>)} />
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs">Allow light backgrounds</span>
            <Switch checked={pool.allowLightBg} onCheckedChange={(v) => patch({ allowLightBg: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-xs">Allow blur</span>
              <span className="block text-[10px] text-muted-foreground">Soft defocus + blur filters on new rolls</span>
            </div>
            <Switch
              checked={pool.allowBlur !== false}
              onCheckedChange={(v) => patch({ allowBlur: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs">Allow filters on random layers</span>
            <Switch checked={pool.allowFilters} onCheckedChange={(v) => patch({ allowFilters: v })} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs">Allow additive glows</span>
            <Switch checked={pool.allowAdditiveBlends} onCheckedChange={(v) => patch({ allowAdditiveBlends: v })} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
