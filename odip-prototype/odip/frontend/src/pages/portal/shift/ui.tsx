import type { ReactNode } from 'react'
import { TONE, type Tone } from '@/lib/tone'

/**
 * A card with a heading. Every Shift Checklist block is one. With `collapse`, the card is a disclosure that starts closed: its heading and
 * `collapse.summary` stay visible, the rest opens on tap (mid-shift on a phone, so the checklist is not buried under the Before blocks).
 */
export function Section({ title, icon, children, id, className = '', collapse }: {
  title: string; icon?: ReactNode; children: ReactNode; id?: string; className?: string; collapse?: { summary: ReactNode } | null
}) {
  const heading = <h2 id={id ? `${id}-title` : undefined} className="font-semibold flex items-center gap-2">{icon}{title}</h2>
  // 16px on a phone, 20px from lg: the shift page's cards stay compact where every line counts (finish review fix 1).
  const base = `bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-4 lg:p-5 ${className}`
  if (collapse) {
    // Folded, the row is the 44px target itself, so the card needs less vertical padding.
    return (
      <details id={id} data-collapsed-section className={`${base} py-2 lg:py-2`}>
        {/* Folded, the heading and its summary share one line. */}
        <summary className="cursor-pointer min-h-[44px] flex flex-wrap items-center gap-x-3 gap-y-1 list-none [&::-webkit-details-marker]:hidden">
          {heading}
          <div className="text-sm text-[var(--color-muted-foreground)] flex flex-wrap items-center gap-2">{collapse.summary}<span className="underline">Show</span></div>
        </summary>
        <div className="space-y-3 pt-3">{children}</div>
      </details>
    )
  }
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className={`${base} space-y-3`}>
      {heading}
      {children}
    </section>
  )
}

/** A small pill. Tone follows lib/tone: warning is for overdue doses only, danger for anaphylaxis and critical alerts only. */
export function Chip({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${TONE[tone].solid}`}>{children}</span>
}

/** A labelled value; a missing one reads "Not recorded", never a blank. */
export function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  const has = !!value && value.trim().length > 0
  return (
    <div>
      <dt className="text-xs text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className={`text-sm whitespace-pre-wrap ${has ? '' : 'text-[var(--color-muted-foreground)] italic'}`}>{has ? value : 'Not recorded'}</dd>
    </div>
  )
}

/** The page's one sticky action bar (SHAPE §3): above the phone's bottom nav, at the foot from lg. Its buttons change with the state; it never stacks with a second bar. */
/** `className` adds layout only, such as keeping the page's bar off the About column at lg. */
export function ActionBar({ children, notice, className = '' }: { children: ReactNode; notice?: ReactNode; className?: string }) {
  return (
    <div
      role="toolbar"
      aria-label="Shift actions"
      className={`sticky bottom-[var(--mobile-nav-h)] lg:bottom-0 z-20 -mx-4 flex flex-wrap gap-2 border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3 lg:mx-0 lg:justify-end lg:rounded-lg lg:border ${className}`}
    >
      {/* A refusal sits in the bar, above its buttons, so it is on screen however long the step is. */}
      {notice && <div className="basis-full">{notice}</div>}
      {children}
    </div>
  )
}

/** A group folded to one line with Show, Section's collapse idea inside a card: done work and the as-needed list, out of the way (SHAPE §3). */
export function Fold({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details>
      <summary className="cursor-pointer min-h-[44px] flex items-center gap-2 text-sm list-none [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">{summary}</span>
        <span className="underline text-[var(--color-muted-foreground)]">Show</span>
      </summary>
      <div className="space-y-2 pt-2">{children}</div>
    </details>
  )
}
