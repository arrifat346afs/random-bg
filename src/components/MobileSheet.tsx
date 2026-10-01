/**
 * MobileSheet — slide-over panel used below the `lg` breakpoint, where the
 * left/right columns are hidden in favour of a single overlay.
 */

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  side: 'left' | 'right'
  title: string
  children: ReactNode
  onClose: () => void
}

export function MobileSheet({ side, title, children, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      {/* click-away backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`absolute inset-y-0 flex w-[88vw] max-w-sm flex-col bg-background shadow-2xl ${
          side === 'left'
            ? 'left-0 border-r animate-slide-from-left'
            : 'right-0 border-l animate-slide-from-right'
        }`}
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close panel">
            <X />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}