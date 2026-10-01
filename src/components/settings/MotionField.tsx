import { useProjectStore } from '@/store/projectStore'
import type { MotionSpec } from '@/lib/schema'
import { Label } from '@/components/ui/label'

export function MotionField({ k, label, hint }: { k: keyof MotionSpec; label: string; hint: string }) {
  const value = useProjectStore((s) => s.project.motion[k])
  return (
    <div className="py-1">
      <div className="mb-1 flex items-center justify-between">
        <div>
          <Label className="text-xs">{label}</Label>
          <p className="text-[10px] text-muted-foreground">{hint}</p>
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) =>
          useProjectStore.getState().patchProject(
            (p) => ({ ...p, motion: { ...p.motion, [k]: Number(e.target.value) } }),
            { coalesce: `motion:${k}` },
          )
        }
        className="w-full accent-[var(--primary)]"
        aria-label={label}
      />
    </div>
  )
}
