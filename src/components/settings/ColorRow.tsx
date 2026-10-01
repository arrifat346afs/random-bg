import { Label } from '@/components/ui/label'

export function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase text-muted-foreground">{value}</span>
        <label
          className="block h-7 w-10 cursor-pointer rounded-md border shadow-sm"
          style={{ backgroundColor: value }}
        >
          <input
            type="color"
            value={value}
            aria-label={label}
            onChange={(e) => onChange(e.target.value)}
            className="h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  )
}
