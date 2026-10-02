import type { ReactNode } from 'react'
import { TONE, type Tone } from '@/lib/tone'

/** A card with a heading. Every Shift Checklist block is one. */
export function Section({ title, icon, children, id, className = '' }: { title: string; icon?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={`bg-[var(--color-card)] rounded-[var(--radius-md)] border border-[var(--color-border)] p-5 space-y-3 ${className}`}
    >
      <h2 id={id ? `${id}-title` : undefined} className="font-semibold flex items-center gap-2">{icon}{title}</h2>
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
