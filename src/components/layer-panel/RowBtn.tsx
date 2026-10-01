/** One icon button in a layer row: visibility, solo, lock, reorder, remove. */
import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function RowBtn({
  label,
  onClick,
  active,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  danger?: boolean
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            onClick()
          }}
          className={`flex h-5 w-5 items-center justify-center rounded transition-colors disabled:opacity-30 ${
            active
              ? 'text-primary'
              : danger
                ? 'text-muted-foreground hover:bg-destructive/15 hover:text-destructive'
                : 'text-muted-foreground hover:bg-background hover:text-foreground'
          }`}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )
}
