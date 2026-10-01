import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Dices } from 'lucide-react'

export function RandomButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Randomise ${label}`}
          onClick={onClick}
          className="h-6 w-6 text-muted-foreground hover:text-primary"
        >
          <Dices />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Randomise this parameter</TooltipContent>
    </Tooltip>
  )
}
