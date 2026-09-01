import { Link } from 'react-router-dom'
import type { WizardSecondaryAction } from './types'

export type WizardNavFooterProps = {
  showBack: boolean
  onBack: () => void
  onNext: () => void
  isReviewStep: boolean
  /** Rendered where "Save as draft" sits today — at most one entry for every consumer today
   * ("Save as draft" and PF-1's "Save changes" are exact complements), but the shell doesn't
   * enforce that; it just maps over whatever it's given. */
  secondaryActions: WizardSecondaryAction[]
  /** Destination for the Review step's "Cancel" link. */
  cancelTo: string
  submitLabel: string
  isSubmitting: boolean
}

/**
 * CORE-01 — extracted verbatim (markup/classes unchanged) from `ParticipantCreatePage.tsx`'s
 * pre-shell inline nav footer (Back / secondary actions / Next / Cancel+Submit).
 */
export function WizardNavFooter({
  showBack,
  onBack,
  onNext,
  isReviewStep,
  secondaryActions,
  cancelTo,
  submitLabel,
  isSubmitting,
}: WizardNavFooterProps) {
  return (
    <div className="md:col-span-2 flex flex-wrap justify-between items-center gap-3 mt-6">
      <div className="flex items-center gap-3">
        {showBack && (
          <button
            type="button"
            onClick={onBack}
            className="px-6 py-2.5 min-h-[44px] rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            Back
          </button>
        )}
        {secondaryActions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            disabled={action.disabled}
            className="px-6 py-2.5 min-h-[44px] rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            {action.label}
          </button>
        ))}
      </div>
      <div className="flex justify-end gap-3">
        {!isReviewStep && (
          <button
            type="button"
            onClick={onNext}
            className="px-6 py-2.5 min-h-[44px] rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 transition-all shadow-md shadow-[var(--color-primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
          >
            Next
          </button>
        )}
        {isReviewStep && (
          <>
            <Link to={cancelTo} className="px-6 py-2.5 min-h-[44px] flex items-center rounded-lg border border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 min-h-[44px] rounded-lg bg-[var(--color-primary)] text-white font-medium hover:bg-[var(--color-primary)]/90 disabled:opacity-50 transition-all shadow-md shadow-[var(--color-primary)]/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              {submitLabel}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
