/**
 * FormatPicker — the output format tiles.
 *
 * Uses the shared `Button` variants for the selected state, like every other
 * selected control in the app (the scale picker, the size presets, the sheet
 * toggles). It previously hand-rolled `border-primary bg-primary/10` on a bare
 * `<button>`, which rendered one shade off from the rest of the UI.
 */

import { FileCode2, FileJson, Film, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { ExportFormat } from '@/store/uiStore'
import { supportsWebM } from '@/lib/export'

interface FormatDef {
  value: ExportFormat
  label: string
  icon: React.ReactNode
  hint: string
}

export const FORMATS: FormatDef[] = [
  { value: 'png', label: 'PNG', icon: <ImageIcon className="h-3.5 w-3.5" />, hint: 'lossless, keeps alpha' },
  { value: 'jpg', label: 'JPG', icon: <ImageIcon className="h-3.5 w-3.5" />, hint: 'smaller, no alpha' },
  { value: 'webp', label: 'WebP', icon: <ImageIcon className="h-3.5 w-3.5" />, hint: 'modern, alpha' },
  { value: 'svg', label: 'SVG', icon: <FileCode2 className="h-3.5 w-3.5" />, hint: 'true vector' },
  { value: 'json', label: 'JSON', icon: <FileJson className="h-3.5 w-3.5" />, hint: 'project file' },
  { value: 'webm', label: 'WebM', icon: <Film className="h-3.5 w-3.5" />, hint: '4s looping motion' },
]

interface Props {
  value: ExportFormat
  onChange: (f: ExportFormat) => void
}

export function FormatPicker({ value, onChange }: Props) {
  const webmOk = supportsWebM()
  return (
    <div>
      <Label className="mb-1 block">Format</Label>
      <div className="grid grid-cols-3 gap-1.5">
        {FORMATS.map((f) => {
          const selected = value === f.value
          return (
            <Button
              key={f.value}
              variant={selected ? 'secondary' : 'outline'}
              aria-pressed={selected}
              disabled={f.value === 'webm' && !webmOk}
              onClick={() => onChange(f.value)}
              className="h-auto flex-col items-start gap-0.5 px-2 py-2 text-left"
            >
              <span className="flex items-center gap-1 text-xs font-semibold">
                {f.icon} {f.label}
              </span>
              <span className="text-[9px] leading-tight text-muted-foreground">{f.hint}</span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}