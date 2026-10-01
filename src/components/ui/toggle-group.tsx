import * as React from 'react'
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group'
import { type VariantProps, cva } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const toggleGroupVariants = cva(
  'inline-flex items-center justify-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: '',
        outline: 'bg-background gap-1',
      },
      size: {
        default: 'h-8',
        sm: 'h-7',
        lg: 'h-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleGroupVariants> & { size?: 'default' | 'sm' | 'lg' }
>({ variant: 'default', size: 'default' })

const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root> &
    VariantProps<typeof toggleGroupVariants>
>(({ className, variant, size, children, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn(toggleGroupVariants({ variant, size: size ?? undefined, className }))}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size: size ?? undefined }}>{children}</ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
))
ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item> &
    VariantProps<typeof toggleGroupVariants>
>(({ className, children, variant, ...props }, ref) => {
  const context = React.useContext(ToggleGroupContext)
  return (
    <ToggleGroupPrimitive.Item
      ref={ref}
      className={cn(
        'inline-flex h-full items-center justify-center gap-1 rounded-sm px-2 text-xs font-medium transition-colors hover:bg-background/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm',
        variant ?? (context.variant === 'outline' ? 'border border-input' : ''),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  )
})
ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName

export { ToggleGroup, ToggleGroupItem, toggleGroupVariants }
