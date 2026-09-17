import { cn } from '@/lib/utils'

export function Mark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-full bg-navy-ink',
        className,
      )}
      aria-hidden="true"
    >
      <span className="h-3 w-3 rounded-full bg-teal-mark" />
    </span>
  )
}
