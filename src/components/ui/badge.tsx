import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[1584px] border border-sand-border bg-warm-cream px-3 py-1 text-xs font-medium text-stone-gray',
        className,
      )}
      {...props}
    />
  )
}
