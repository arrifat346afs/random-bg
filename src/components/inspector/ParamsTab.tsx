/**
 * inspector/ParamsTab.tsx — generator parameters, grouped by section with
 * per-section randomise.
 */

import { useMemo } from "react"
import { getGenerator } from "@/lib/generators"
import { createRng, hash32 } from "@/lib/rng"
import { randomParamValue, randomizeParams } from "@/lib/randomize"
import type { Layer, ParamDef, ParamValue } from "@/lib/schema"
import { getState, updateLayer } from "@/lib/state/store"
import { ParamField } from "@/components/ParamField"
import { Button } from "@/components/ui/button"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Dices } from "lucide-react"
import { SECTION_LABELS } from "./schema"

export function ParamsTab({ layer }: { layer: Layer }) {
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

