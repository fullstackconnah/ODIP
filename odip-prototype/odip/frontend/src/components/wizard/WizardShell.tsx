/**
 * CORE-01 WizardShell — pure presentational layout primitive that pairs a step-rail
 * sidebar with the wizard's form content. The step rail is rendered EXACTLY ONCE in the DOM
 * (orientation is driven by Tailwind `lg:` viewport variants, not by rendering two copies).
 *
 * Accessibility: the rail region is wrapped in an `<aside>` landmark (with an aria-label
 * defaulting to "Wizard steps"); the content column is a `<section>` (not a `<main>`, since
 * AppLayout already provides a single `<main id="main">` for the authenticated shell — a
 * nested `<main>` would be a landmark regression).
 *
 * No JS, no data fetching, no hooks: just layout. Wizard pages wrap the rail + form in this
 * shell and drop the `max-w-5xl mx-auto` cap on the wizard body so the form actually uses
 * the remaining width; the inner form fields stay readable via their own max-w-* wrapper.
 */
import type { ReactNode } from 'react'

export type WizardShellProps = {
  /** The step rail element (typically <WizardStepRail ... />). Rendered exactly once. */
  rail: ReactNode
  /** The form/step content (heading + step body + nav footer). */
  children: ReactNode
  /** Accessible name for the rail sidebar. Defaults to "Wizard steps". */
  railLabel?: string
  /** Optional className merged onto the outer wrapper. */
  className?: string
  /** Optional className merged onto the rail aside. */
  railClassName?: string
  /** Optional className merged onto the content section. */
  contentClassName?: string
}

const RAIL_WIDTH_CLASS = 'lg:w-52'

export function WizardShell({
  rail,
  children,
  railLabel = 'Wizard steps',
  className,
  railClassName,
  contentClassName,
}: WizardShellProps) {
  return (
    <div
      className={[
        'flex flex-col gap-6 lg:flex-row lg:gap-4',
        // Every flex child gets min-w-0 so a long field content can't force horizontal page
        // overflow — same guard the wizard body already uses.
        className,
      ].filter(Boolean).join(' ')}
    >
      <aside
        aria-label={railLabel}
        // shrink-0 only kicks in at lg+ so the rail keeps its declared width on desktop; the
        // min-w-0 on the parent + flex-1 on the content is what actually prevents overflow.
        className={[
          'min-w-0',
          RAIL_WIDTH_CLASS,
          'lg:shrink-0',
          railClassName,
        ].filter(Boolean).join(' ')}
      >
        {rail}
      </aside>
      <section
        aria-label="Wizard content"
        className={['min-w-0 flex-1', contentClassName].filter(Boolean).join(' ')}
      >
        {children}
      </section>
    </div>
  )
}
