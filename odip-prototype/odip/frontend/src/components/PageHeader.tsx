import { Children, type ReactNode } from 'react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

export type PageHeaderVariant = 'default' | 'detail'

export type PageHeaderProps = {
  title: string
  /**
   * A second phrase of the title inside the same `h1`, in the muted ink at the same size: the dashboard's date after its greeting
   * ("Good morning, Sarah  Friday 2 October"). The two parts wrap as units, so a narrow screen breaks between them and never inside the date.
   */
  titleNote?: ReactNode
  /**
   * What the tab and the history call this page when the `h1` says something else: the dashboard's `h1` is a greeting that changes with the
   * hour, while the tab stays "Management Dashboard". Defaults to `title`.
   */
  documentTitle?: string
  subtitle?: string | ReactNode
  action?: ReactNode
  children?: ReactNode
  /**
   * `default` (the default) is the 20px page title every screen uses today.
   * `detail` is the detail-page header (DESIGN.md "Detail header pattern"): the title at the display step
   * (28px, Plus Jakarta Sans 800), grouped tightly with its subtitle, which sits beneath it as a meta row (pair it
   * with `PageHeaderMeta`) instead of floating a section-gap below. It is still the page's one `h1`, and the actions
   * wrap under the title below md exactly as they do in the default variant.
   */
  variant?: PageHeaderVariant
}

const H1_CLASS: Record<PageHeaderVariant, string> = {
  default: 'text-xl font-bold max-md:min-w-0 max-md:break-words',
  detail: 'text-display text-balance max-md:min-w-0 max-md:break-words',
}

export function PageHeader({ title, titleNote, documentTitle, subtitle, action, children, variant = 'default' }: PageHeaderProps) {
  useDocumentTitle(documentTitle ?? title)
  const detail = variant === 'detail'
  // A string subtitle sits inline after the title on the same baseline row; a richer ReactNode
  // subtitle (e.g. a meta row of chips) keeps its own line below the title/action row. The detail variant always
  // puts its subtitle below: an inline subtitle beside a 28px title would read as part of the title.
  const inlineSubtitle = !detail && typeof subtitle === 'string'

  // From md up this is the single row it always was: title + inline subtitle on the left,
  // actions on the right. Below md the row stacks — title block first, the actions on their own
  // row underneath — so a phone never has to share 326px between an H1 and a button cluster
  // (the old side-by-side squeezed names to "C…" and pushed the last button off-screen).
  const titleRow = (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
      {/* Below md only: the title may shrink to the row and break a long word (max-md:min-w-0 +
          break-words), and an inline subtitle that doesn't fit beside it drops to its own line (flex-wrap)
          instead of shrinking it. From md up none of that applies: the h1 keeps its min-content width, so
          a tight row truncates the subtitle rather than breaking the title mid-word, exactly as before. */}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 md:flex-nowrap">
        <h1 className={H1_CLASS[variant]}>
          {titleNote ? (
            <>
              <span className="mr-2 inline-block">{title}</span>{' '}
              <span className="inline-block text-[var(--color-muted-foreground)]">{titleNote}</span>
            </>
          ) : (
            title
          )}
        </h1>
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
  )

  const filterRow = children && (
    // Filter row. `pointer-coarse:gap-y-3`: a 24px pill (Dropdown) that wraps onto a row of its own carries a 44px
    // hit area, 10px past its box; 12px between wrapped rows keeps that pad off the control on the row above.
    <div className="flex flex-wrap items-center gap-2 pointer-coarse:gap-y-3 mt-2">{children}</div>
  )

  if (detail) {
    // One block, so the page's `--section-gap` opens BELOW the whole header (title + meta) rather than between the
    // title and its own meta row, which is what a Fragment does to a ReactNode subtitle.
    return (
      <div className="flex flex-col gap-2">
        {titleRow}
        {subtitle && <div className="text-[13px] text-[var(--color-muted-foreground)]">{subtitle}</div>}
        {filterRow}
      </div>
    )
  }

  return (
    <>
      {titleRow}
      {subtitle && !inlineSubtitle && (
        <div className="mt-1 text-[13px] text-[var(--color-muted-foreground)]">{subtitle}</div>
      )}
      {filterRow}
    </>
  )
}

/**
 * The meta row of a `variant="detail"` header: a status and a few quiet facts, joined by middots.
 *
 *   <PageHeaderMeta>
 *     <StatusBadge status="Confirmed" size="md" />
 *     Caloundra QLD
 *     <span className="font-mono">SCB-2608</span>
 *     14–17 Aug 2026
 *   </PageHeaderMeta>
 *
 * A child that is `null`, `undefined`, `false` or an empty string is skipped BEFORE the separators are placed, so a
 * missing fact never leaves a dangling dot. Each separator belongs to the item before it, so a wrapped line can end
 * with a dot but never begins with one. The dots are `aria-hidden`; the row's own typography (13px, muted) comes from
 * `PageHeader`.
 */
export function PageHeaderMeta({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(item => item !== '')
  return (
    <div className="flex flex-wrap items-center gap-y-1">
      {items.map((item, i) => (
        <span key={i} className="inline-flex min-w-0 items-center">
          {item}
          {i < items.length - 1 && (
            <span aria-hidden="true" className="px-2">
              ·
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
