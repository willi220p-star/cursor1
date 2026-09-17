import { cva } from 'class-variance-authority'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-[1584px] text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-pulse/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-violet-pulse text-white hover:bg-violet-pulse-hover',
        secondary:
          'border border-sand-border bg-paper-white text-navy-ink hover:bg-cool-mist',
        ghost: 'text-stone-gray hover:bg-cool-mist hover:text-navy-ink',
        danger: 'bg-navy-ink text-white hover:opacity-90',
      },
      size: {
        md: 'h-11 px-5',
        sm: 'h-9 px-4 text-sm',
        lg: 'h-12 px-6',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)
