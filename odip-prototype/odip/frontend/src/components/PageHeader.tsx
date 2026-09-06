import type { ReactNode } from 'react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

export type PageHeaderProps = {
  title: string
  subtitle?: string | ReactNode
  action?: ReactNode
  children?: ReactNode
}

export function PageHeader({ title, subtitle, action, children }: PageHeaderProps) {
  useDocumentTitle(title)
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && (
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              {typeof subtitle === 'string' ? subtitle : subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-3">
          {children}
        </div>
      )}
    </>
  )
}
