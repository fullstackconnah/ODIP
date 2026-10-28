import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

/**
 * VISUAL-1 V2: a Details group with nothing recorded was a block of "Not recorded" rows or a wall of dashes. It folds into one muted
 * line ("Not recorded: …") that opens to the same content, so whoever fills it in still reaches its Edit. The disclosure is the house
 * one (AgreementBudgetBreakdown): a native <details>, with a chevron that turns because a flex summary loses the browser's marker.
 * The chevron is top-aligned so it stays on the first line when the summary wraps on a phone.
 * `defaultOpen` is for where the fold is the whole content of its sub-tab (FixedListFrame): it opens on arrival and the editor can still collapse it.
 * `data-fold-static` marks it open on arrival, so the fold fade (which animates folds the user opens) skips it.
 */
export function NotRecordedFold({ summary, className, defaultOpen, children }: { summary: string; className?: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen || undefined} data-fold-static={defaultOpen || undefined} className={`group ${className ?? ''}`}>
      <summary className="flex min-h-[var(--control-h)] cursor-pointer select-none items-start gap-1 py-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]">
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
        Not recorded: {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  )
}
