import { type InputHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/lib/utils'

export type InputProps = InputHTMLAttributes<HTMLInputElement>

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-11 w-full rounded-[12px] border border-sand-border bg-paper-white px-4 text-sm text-navy-ink placeholder:text-ash-gray hover:bg-cool-mist/60 focus:bg-paper-white focus:outline-none focus:ring-2 focus:ring-violet-pulse/30',
        className,
      )}
      {...props}
    />
  )
})
