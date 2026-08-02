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
    <div className={`bg-[var(--color-card)] rounded-xl border border-[var(--color-border)] ${compact ? 'p-3' : 'p-5'} ${className ?? ''}`}>
      {(title || action) && (
        <div className={`flex items-center justify-between ${children ? 'mb-4' : ''}`}>
          {title && <h3 className="font-semibold">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}
