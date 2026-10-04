import { Loader2, ShieldAlert } from 'lucide-react'
import { FormField } from '@/components/FormField'
import { FindingsList } from '@/pages/rostering/components/FindingsList'
import {
  MIN_REASON_LENGTH,
  availableChoices,
  isMeaningfulReason,
  reasonError,
  type BudgetFindingView,
  type BudgetOverrideCapabilities,
  type BudgetOverrideChoice,
} from './budgetOverrideTypes'

export type BudgetOverrideReasonFieldsProps = {
  /**
   * The budget findings the SERVER returned for the shift being saved, exactly as
   * `POST rostering/shifts/check` produced them. This component shows them and never derives one:
   * a message invented here would be a client-side budget rule wearing the server's clothes.
   * Pass the budget findings only (filter upstream by the `BUDGET_*` codes) so this does not
   * re-list a staff-leave finding that `RosterGateFields` already shows.
   *
   * With no finding there is nothing to answer and this renders nothing at all — the reason field
   * is not a free-text note on an ordinary shift.
   */
  findings: BudgetFindingView[]
  /** What this caller may do, decided by the integration owner from the real session. */
  capabilities: BudgetOverrideCapabilities
  /** The chosen path: `none`, `adminOverride` or `emergency`. */
  choice: BudgetOverrideChoice
  /** Why the shift should go ahead. Kept exactly as typed so a failed save loses nothing. */
  reason: string
  /**
   * True once the user has tried to go ahead. Validation is only shown after an attempt (or the
   * server has refused), never while someone is still typing their first word.
   */
  submitted: boolean
  /** A save is in flight: the fields are held so a second submit cannot double-write. */
  pending?: boolean
  /**
   * The caller may read but not write (no write permission on the roster). The fields go
   * `disabled`, never `hidden` — a read-only form that vanished would leave no sign the shift was
   * ever over budget.
   */
  disabled?: boolean
  /**
   * The last save's failure, in the server's words. Shown above the fields and never in place of
   * them: the typed reason and the chosen path stay on screen so the retry is one press.
   */
  error?: string | null
  onChoiceChange: (choice: BudgetOverrideChoice) => void
  onReasonChange: (reason: string) => void
  className?: string
}

/**
 * The two ways through an over-budget ad-hoc shift, and the written reason each of them needs.
 *
 * **This component shows no money of its own.** The server's finding text goes through verbatim —
 * that is the server's sentence, and whether a restricted viewer is sent one at all is the
 * server's decision, not this component's. The authoritative figures belong to
 * `<BudgetFindingDetails>`, which the caller places separately and which honours `restricted`.
 * A component that both answered a finding and re-printed the figures would be a second place for
 * a number to leak from, and a second place for the same sentence to drift.
 *
 * It decides nothing. Specifically it does not decide whether the shift is over budget, whether a
 * reason is long enough for the server, or whether this user may take a path at all — the caller
 * authorises the capabilities, the server enforces them, and the only judgement here is the
 * visible, testable one: a reason that is nothing but whitespace is not a reason.
 *
 * What this deliberately does NOT render, because a client is not the security boundary:
 *  - a "disable emergency bookings" control. The owner decided the emergency path "cannot be
 *    switched off", so there is no prop for it and no way to turn it off from here;
 *  - a claim that hiding a choice makes the server refuse it. The copy says the server decides.
 *
 * The emergency path is styled as its own thing, not a second entry in the same list: a person
 * choosing to record a safety reason is making a different kind of act from an Admin accepting an
 * overrun, and the audit record will read differently later.
 */
export function BudgetOverrideReasonFields({
  findings,
  capabilities,
  choice,
  reason,
  submitted,
  pending = false,
  disabled = false,
  error = null,
  onChoiceChange,
  onReasonChange,
  className,
}: BudgetOverrideReasonFieldsProps) {
  const choices = availableChoices(capabilities)
  const isEmergency = choice === 'emergency'
  const showReason = choice !== 'none'
  const message = reasonError(choice, reason, submitted)
  const readOnly = disabled || pending

  // Nothing to answer: no budget finding, so no path and no reason. A voluntary note on an ordinary
  // shift is RosterGateFields' job, not this one's.
  if (findings.length === 0) return null

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`}>
      <FindingsList findings={findings} />

      {error && (
        <div role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-error-container)] px-3 py-2 text-sm text-[var(--color-destructive)]">
          {error}
        </div>
      )}

      {choices.length > 0 && (
        <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-0.5 text-[13px] font-medium text-[var(--color-muted-foreground)]">
            This shift goes past the recorded budget. How?
          </legend>

          {capabilities.canOverrideAsAdmin && (
            <label htmlFor="budget-override-choice-admin" className="flex min-h-[var(--control-h)] cursor-pointer items-start gap-3 py-1">
              <input
                type="radio"
                id="budget-override-choice-admin"
                name="budget-override-choice"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={choice === 'adminOverride'}
                onChange={() => onChoiceChange('adminOverride')}
              />
              <span className="text-sm">
                <span className="font-medium text-[var(--color-foreground)]">Override as an Admin</span>
                <span className="block text-[13px] text-[var(--color-muted-foreground)]">
                  You are accepting the overrun. Your reason is recorded in the audit log.
                </span>
              </span>
            </label>
          )}

          {/* The emergency path is its own panel with its own fill, so it never reads as a variant
              of the Admin override above. It is not switchable and nothing here offers to make
              it so. */}
          {capabilities.canRecordEmergency && (
            <div
              data-emergency-panel=""
              className={`rounded-[var(--radius-sm)] border p-3 ${
                isEmergency
                  ? 'border-[var(--color-warning)] bg-[var(--color-warning-container)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-container)]'
              }`}
            >
              <label htmlFor="budget-override-choice-emergency" className="flex min-h-[var(--control-h)] cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  id="budget-override-choice-emergency"
                  name="budget-override-choice"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={isEmergency}
                  onChange={() => onChoiceChange('emergency')}
                />
                <span className="text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-[var(--color-on-warning-container)]">
                    <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Emergency or safety
                  </span>
                  <span className="block text-[13px] text-[var(--color-on-warning-container)]">
                    The shift saves at once and an Admin reviews it afterwards. This option is always
                    available and cannot be switched off.
                  </span>
                </span>
              </label>
            </div>
          )}

          {showReason && (
            <FormField
              // Two different labels, not one with a swapped word: the emergency field is read by
              // an Admin reviewing the shift afterwards, and it has to say so where they will see
              // it. "Reason for the override" on a safety reason would file it in the same place
              // an ordinary overrun note lives.
              label={isEmergency ? 'What made this an emergency or safety need' : 'Reason for the override'}
              required
              // The error is the field's own: FormField puts it under the control with
              // role="alert" and folds its id into aria-describedby, so a keyboard user focused on
              // the textarea hears it without hunting.
              error={message ?? undefined}
              hint={
                isEmergency
                  ? `At least ${MIN_REASON_LENGTH} characters. This is stored with the shift, and an Admin reviews it afterwards.`
                  : 'What makes this overrun acceptable? Recorded in the audit log against your name.'
              }
            >
              <textarea
                rows={3}
                value={reason}
                disabled={readOnly}
                onChange={e => onReasonChange(e.target.value)}
                placeholder={isEmergency ? 'e.g. Participant was unsafe at the time of the shift and needed support now' : 'Why this shift should proceed past the funding'}
              />
            </FormField>
          )}

          {/* A reason that is only whitespace is the one thing this component refuses on its own.
              The words are here, next to the field, because a silent no-op reads as a broken form. */}
          {submitted && showReason && !isMeaningfulReason(reason) && (
            <p className="text-xs text-[var(--color-muted-foreground)]">
              A reason of spaces or empty lines is not a reason.
            </p>
          )}
        </fieldset>
      )}

      {/* Deliberately NOT role="status". ShiftSlideOver already keeps a polite region for its own
          notice and its tests assert there is exactly one (or zero) live status in that panel; a
          second one here would double-announce every save. The visual cue is enough while the
          fields are held disabled. */}
      {pending && (
        <p className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
          Saving — the reason above is kept so you can try again if it does not save.
        </p>
      )}

      <p className="text-xs text-[var(--color-muted-foreground)]">
        The server checks the budget on every save. What this form shows is what the server last
        told us, not a decision made in the browser.
      </p>
    </div>
  )
}
