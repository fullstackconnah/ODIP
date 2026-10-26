import type { ReactNode } from 'react'
import { Button } from '@/components/Button'
import { useBackTarget } from '@/hooks/useBackNavigation'
import type { WizardSecondaryAction } from './types'

// A busy button stays natively enabled so a keyboard or screen-reader user keeps focus; aria-disabled plus the click guards below make it inert.
const BUSY_LOOK = 'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed'

export type WizardNavFooterProps = {
  showBack: boolean
  onBack: () => void
  onNext: () => void
  isReviewStep: boolean
  /** Rendered where "Save as draft" sits today — at most one entry for every consumer today
   * ("Save as draft" and PF-1's "Save changes" are exact complements), but the shell doesn't
   * enforce that; it just maps over whatever it's given. */
  secondaryActions: WizardSecondaryAction[]
  /** Where "Cancel" goes (the Review step's, and the first step's, where Back would be) when there is no in-app history. */
  cancelTo: string
  /**
   * Default `true`, like `BackButton`: Cancel returns to the previous in-app screen, the same place as the page's header Back, and
   * `cancelTo` is the fallback. `false` pins Cancel to `cancelTo`, for a wizard whose header Back is pinned.
   */
  history?: boolean
  submitLabel: string
  isSubmitting: boolean
  /** Shown between the actions (above them on a phone): the agreement wizard's running total. */
  summary?: ReactNode
  /** Review step only: Back stays left; the secondary actions (Save as draft), Cancel and the submit group on the right, submit last. */
  reviewActionsRight?: boolean
}

/**
 * CORE-01 — extracted verbatim (markup/classes unchanged) from `the retired single-step wizard`'s
 * pre-shell inline nav footer (Back / secondary actions / Next / Cancel+Submit).
 *
 * Sticky, so a long step keeps Back / Next on screen. Below `lg` the app shell's fixed bottom nav
 * (AppLayout, z-50, `--mobile-nav-h` tall) occupies the bottom edge of the viewport, so the footer
 * sticks just ABOVE it (`bottom-[var(--mobile-nav-h)]`); pinned at `bottom-0` it sat underneath the
 * nav and Next could be neither seen nor tapped until the very end of the page. From `lg` there is
 * no bottom nav and it sticks to the viewport edge.
 */
export function WizardNavFooter({
  showBack,
  onBack,
  onNext,
  isReviewStep,
  secondaryActions,
  cancelTo,
  history = true,
  submitLabel,
  isSubmitting,
  summary,
  reviewActionsRight = false,
}: WizardNavFooterProps) {
  const back = useBackTarget(cancelTo)
  // A router link either way, so the unsaved-changes blocker still asks before leaving.
  const cancelHref = history ? back.to : cancelTo
  const groupRight = isReviewStep && reviewActionsRight
  // Below sm, on a non-review step, the secondary drops to its own full-width row so Back and Next stay together on row 1.
  const stackSecondary = !isReviewStep && secondaryActions.length > 0
  const secondary = secondaryActions.map((action) => (
    <Button
      key={action.key}
      type="button"
      variant="secondary"
      onClick={() => { if (!action.disabled) void action.onClick() }}
      aria-disabled={action.disabled || undefined}
      className={`${BUSY_LOOK}${stackSecondary ? " max-sm:order-3 max-sm:basis-full" : ""}`}
    >
      {action.label}
    </Button>
  ))
  // z-[4]: above a DataTable's pinned columns (z-[2], z-[3]) scrolling under it, below every menu and dialog (z-50 and up).
  return (
    <div className={`sticky bottom-[var(--mobile-nav-h)] lg:bottom-0 z-[4] md:col-span-2 mt-[var(--section-gap)] flex w-full min-w-0 flex-row flex-wrap items-center ${groupRight ? 'justify-end' : 'justify-between'} gap-3 border-t border-[var(--color-border)] bg-[var(--color-background)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]`}>
      <div className={`flex min-w-0 flex-wrap items-center gap-3${groupRight ? ' mr-auto' : ''}${stackSecondary ? ' max-sm:contents' : ''}`}>
        {/* The first step has no Back, so the way out takes its place (the review step has its own Cancel). */}
        {showBack ? (
          <Button type="button" variant="secondary" onClick={onBack}>Back</Button>
        ) : !isReviewStep && (
          <Button variant="secondary" to={cancelHref}>Cancel</Button>
        )}
        {!groupRight && secondary}
      </div>
      {summary && <div className="order-first basis-full min-w-0 sm:order-none sm:basis-auto sm:flex-1 sm:px-3">{summary}</div>}
      {/* Review step: below sm the right group dissolves into the outer wrap row, so Back, Save as draft and Cancel share row 1 and Submit sits alone, right, on row 2. */}
      <div className={`flex min-w-0 flex-wrap justify-end gap-3${groupRight ? ' max-sm:contents' : ''}`}>
        {!isReviewStep && (
          <Button type="button" onClick={onNext}>Next</Button>
        )}
        {isReviewStep && (
          <>
            {groupRight && secondary}
            <Button variant="secondary" to={cancelHref}>Cancel</Button>
            <Button type="submit" aria-disabled={isSubmitting || undefined} onClick={(e) => { if (isSubmitting) e.preventDefault() }} className={`${BUSY_LOOK}${groupRight ? " max-sm:ml-auto" : ""}`}>{submitLabel}</Button>
          </>
        )}
      </div>
    </div>
  )
}
