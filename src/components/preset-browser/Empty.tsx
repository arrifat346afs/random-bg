/** Nothing matched the current filter. */
import { ImageOff } from 'lucide-react'
export function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-center">
      <ImageOff className="h-5 w-5 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  )
}
