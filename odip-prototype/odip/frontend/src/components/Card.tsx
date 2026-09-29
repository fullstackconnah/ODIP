import type { ReactNode } from 'react'

export type CardProps = {
  title?: string
  action?: ReactNode
  className?: string
  compact?: boolean
  children: ReactNode
}

export function Card({ title, action, className, compact, children }: CardProps) {
  return (
    <div className={`bg-[var(--color-card)] rounded-md border border-[var(--color-border)] ${compact ? 'p-2' : 'p-[var(--card-pad)]'} ${className ?? ''}`}>
      {(title || action) && (
        <div className={`flex items-center justify-between ${children ? 'mb-2' : ''}`}>
          {title && <h3 className="text-sm font-semibold">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
