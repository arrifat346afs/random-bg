import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function SeedDialog({
  open,
  onClose,
  seed,
}: {
  open: boolean
  onClose: () => void
  seed: number
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Seed</DialogTitle>
          <DialogDescription>
            The seed fully determines the project. Share it to reproduce this exact render.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/50 p-3 text-center font-mono text-lg tabular-nums">
          {seed}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => void navigator.clipboard?.writeText(String(seed)).catch(() => {})}
          >
            Copy number
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
