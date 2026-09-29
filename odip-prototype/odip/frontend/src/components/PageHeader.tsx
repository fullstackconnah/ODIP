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
  // A string subtitle sits inline after the title on the same baseline row; a richer ReactNode
  // subtitle (e.g. a meta row of chips) keeps its own line below the title/action row.
  const inlineSubtitle = typeof subtitle === 'string'
  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-xl font-bold">{title}</h1>
          {inlineSubtitle && subtitle && (
            <span className="truncate text-[13px] text-[var(--color-muted-foreground)]">{subtitle}</span>
          )}
        </div>
        {action}
      </div>
      {subtitle && !inlineSubtitle && (
        <div className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">{subtitle}</div>
      )}
      {children && (
        <div className="flex flex-wrap items-center gap-2 mt-2">
          {children}
        </div>
      )}
    </>
  )
}
