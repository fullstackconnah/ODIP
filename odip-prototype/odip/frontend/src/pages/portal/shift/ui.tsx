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
  const base = `bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-5 ${className}`
  if (collapse) {
    return (
      <details id={id} data-collapsed-section className={base}>
        <summary className="cursor-pointer min-h-[44px] flex flex-col justify-center gap-1 list-none [&::-webkit-details-marker]:hidden">
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
