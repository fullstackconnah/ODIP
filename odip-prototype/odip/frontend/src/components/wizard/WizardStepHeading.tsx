import { useEffect, useRef } from 'react'

export type WizardStepHeadingProps = {
  /** Identifies the step whose heading this is — pass the wizard's real step key (never a bare
   * index; see useWizard.ts's own "internal state is a step KEY" note), including the reserved
   * `REVIEW_STEP_KEY`, so a reshuffled `steps` array is handled the same way a Back/Next-driven
   * change is. */
  stepKey: string
  /** The step's display label — reuses whatever `WizardStepRail`'s pill already shows for this
   * step so the visible heading and the announcement never drift from the rail. */
  label: string
}

/**
 * CORE-01 — the wizard shell's per-step heading (2026-09 UX audit finding: advancing/going back a
 * step moved no focus and announced nothing, and several step components under each wizard's own
 * steps directory render no heading at all for focus to land on). Shared by the
 * Caregiver/Intake/Profile wizards so the fix lives once instead of being re-derived three times.
 *
 * On a real step TRANSITION (`stepKey` changes after first mount) moves focus to this heading, so
 * a screen-reader user hears the new step's name announced and a keyboard user's tab order
 * restarts at the top of the new step's fields instead of being left wherever it was (e.g. a Next
 * button the DOM may since have removed). Deliberately does NOT focus on first mount — the effect
 * skips its first run — so loading this page for the first time doesn't steal focus from wherever
 * the router/page already put it.
 *
 * The live region mirrors RosterGateFields.tsx's convention exactly (commit 30aad79):
 * `aria-live="polite" aria-atomic="true"` on an `sr-only` div, deliberately no `role="status"`
 * (that role is reserved elsewhere in these forms for a single non-blocking notice, and existing
 * tests assert on there being exactly one/zero status-role elements) — reusing that shape here
 * rather than inventing a second live-region pattern.
 */
export function WizardStepHeading({ stepKey, label }: WizardStepHeadingProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const hasMounted = useRef(false)

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true
      return
    }
    headingRef.current?.focus()
  }, [stepKey])

  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {`Now on step: ${label}`}
      </div>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-lg font-semibold text-[var(--color-foreground)] mb-4 focus:outline-none"
      >
        {label}
      </h2>
    </>
  )
}
