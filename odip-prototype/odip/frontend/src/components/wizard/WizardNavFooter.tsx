import { Button } from '@/components/Button'
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
 * CORE-01 — extracted verbatim (markup/classes unchanged) from `the retired single-step wizard`'s
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
    <div className="sticky bottom-0 md:col-span-2 mt-[var(--section-gap)] flex w-full min-w-0 flex-col gap-3 border-t border-[var(--color-border)] bg-[var(--color-background)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {showBack && (
          <Button type="button" variant="secondary" onClick={onBack}>Back</Button>
        )}
        {secondaryActions.map((action) => (
          <Button
            key={action.key}
            type="button"
            variant="secondary"
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </Button>
        ))}
      </div>
      <div className="flex min-w-0 flex-wrap justify-end gap-3">
        {!isReviewStep && (
          <Button type="button" onClick={onNext}>Next</Button>
        )}
        {isReviewStep && (
          <>
            <Button variant="secondary" to={cancelTo}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{submitLabel}</Button>
          </>
        )}
      </div>
    </div>
  )
}
