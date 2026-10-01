/** Labelled row wrapper: a caption on the left, controls on the right. */
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

export function Row({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="cursor-pointer text-xs">
          {label}
        </Label>
        <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
}
