import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { LockOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Lock } from 'lucide-react'

export function LockButton({ locked, onToggle, label }: { locked: boolean; onToggle: () => void; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={locked ? `Unlock ${label}` : `Lock ${label}`}
          aria-pressed={locked}
          onClick={onToggle}
          className={cn('h-6 w-6 text-muted-foreground', locked && 'text-primary')}
        >
          {locked ? <Lock /> : <LockOpen />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{locked ? 'Locked — randomise skips this' : 'Lock this parameter'}</TooltipContent>
    </Tooltip>
  )
}
