import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type PageHeaderProps = {
  eyebrow?: string
  title: string
  description: string
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="max-w-[720px]">
        {eyebrow ? (
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-teal-mark">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="heading-display text-[32px] font-semibold text-navy-ink sm:text-[40px]">
          {title}
        </h1>
        <p className="mt-3 max-w-[65ch] text-base text-stone-gray">{description}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
    </div>
  )
}
