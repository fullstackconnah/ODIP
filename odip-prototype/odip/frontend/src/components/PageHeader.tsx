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
      {/* From md up this is the single row it always was: title + inline subtitle on the left,
          actions on the right. Below md the row stacks — title block first, the actions on their own
          row underneath — so a phone never has to share 326px between an H1 and a button cluster
          (the old side-by-side squeezed names to "C…" and pushed the last button off-screen). */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
        {/* Below md only: the title may shrink to the row and break a long word (max-md:min-w-0 +
            break-words), and an inline subtitle that doesn't fit beside it drops to its own line (flex-wrap)
            instead of shrinking it. From md up none of that applies: the h1 keeps its min-content width, so
            a tight row truncates the subtitle rather than breaking the title mid-word, exactly as before. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 md:flex-nowrap">
          <h1 className="text-xl font-bold max-md:min-w-0 max-md:break-words">{title}</h1>
          {inlineSubtitle && subtitle && (
            <span className="text-[13px] text-[var(--color-muted-foreground)] md:truncate">{subtitle}</span>
          )}
        </div>
        {action && (
          // `md:contents` dissolves this wrapper from md up, so the caller's action node is a direct
          // flex item of the row exactly as before the wrapper existed. Below md it is a wrapping row
          // of its own; the two descendant rules are a safety net for callers that hand in a single
          // `div.flex.shrink-0` cluster: the cluster is clamped to the row width and (if it is a
          // block-level div) is made to wrap, so no action set can force horizontal overflow.
          <div className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden md:contents max-md:[&>*]:max-w-full max-md:[&>div]:flex-wrap">
            {action}
          </div>
        )}
      </div>
      {subtitle && !inlineSubtitle && (
        <div className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">{subtitle}</div>
      )}
      {children && (
        // Filter row. `pointer-coarse:gap-y-3`: a 24px pill (Dropdown) that wraps onto a row of its own carries a 44px
        // hit area, 10px past its box; 12px between wrapped rows keeps that pad off the control on the row above.
        <div className="flex flex-wrap items-center gap-2 pointer-coarse:gap-y-3 mt-2">
          {children}
        </div>
      )}
    </>
  )
}
