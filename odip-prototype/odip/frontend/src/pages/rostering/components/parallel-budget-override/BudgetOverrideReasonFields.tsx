import { useEffect, useId, useRef } from 'react'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/Button'
import { FormField } from '@/components/FormField'
import {
  MAX_EMERGENCY_LENGTH,
  MIN_REASON_LENGTH,
  charactersStillNeeded,
  emergencyOffered,
  reasonError,
  type BudgetFindingView,
  type BudgetOverrideChoice,
} from './budgetOverrideTypes'

export type BudgetOverrideReasonFieldsProps = {
  /**
   * The findings the SERVER returned for the shift being saved, exactly as `POST rostering/shifts/check` produced them. This component derives nothing from them but one fact: whether the
   * server REFUSED the shift on the budget (a blocking BUDGET_FORECAST_OVER). It prints no finding and no money of its own: the findings list above it shows the server's sentence, and the
   * figures readout is a separate component. With no refusal there is nothing to get through and this renders nothing at all: the description is not a note on an ordinary shift.
   */
  findings: readonly BudgetFindingView[]
  /** The chosen path: `none` (the refusal stands) or `emergency`. */
  choice: BudgetOverrideChoice
  /** What made it an emergency or safety need. Kept exactly as typed, so a failed save loses nothing. */
  reason: string
  /**
   * True once the user has tried to go ahead (or the server has refused the description). Validation is only shown after an attempt, never while someone is still typing their first word.
   */
  submitted: boolean
  /** A save is in flight: the fields are held so a second submit cannot double-write. */
  pending?: boolean
  /** The caller may read but not write. The controls go `disabled`, never hidden: a read-only form that vanished would leave no sign the shift was refused. */
  disabled?: boolean
  /** The last save's failure, in the server's words. Shown above the controls and never in place of them: the typed description and the chosen path stay on screen so the retry is one press. */
  error?: string | null
  onChoiceChange: (choice: BudgetOverrideChoice) => void
  onReasonChange: (reason: string) => void
  className?: string
}

/**
 * "Emergency or safety": the one way through a one-off shift a hard limit has refused, for any Coordinator, in every mode and for good. (An Admin's way through is the existing reason field: the server
 * answers an Admin with the same finding as a warning that needs a reason.) Nothing is blocked until a person says it is an emergency: a secondary action opens the description, focus moves to it, and the
 * panel's primary Save stays disabled until the description is a real one of at least {@link MIN_REASON_LENGTH} characters. The shift then saves at once and an Admin reviews it afterwards.
 *
 * It decides nothing: it does not decide whether the shift is over budget (the server's refusal opens it), whether the description is long enough for the server (the server re-checks every save), or
 * who may take the path. There is no prop, setting or control that could switch the path off, because the owner decided it cannot be switched off.
 */
export function BudgetOverrideReasonFields({
  findings,
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
  const descriptionId = useId()
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const choiceRef = useRef<HTMLDivElement>(null)
  const wasEmergency = useRef(choice === 'emergency')
  const isEmergency = choice === 'emergency'
  const readOnly = disabled || pending
  const message = reasonError(choice, reason, submitted)
  const stillNeeded = charactersStillNeeded(reason)

  // Choosing the path moves focus to the description, so a keyboard or screen-reader user lands on the one thing left to do. Only on the change: a re-render (or an initial render already in the path) never steals it.
  // Stepping back removes the button that was just pressed, which would drop focus to the page: it goes to the "Emergency or safety" button that takes its place (nothing to focus when the whole card has gone).
  useEffect(() => {
    if (isEmergency && !wasEmergency.current) reasonRef.current?.focus()
    else if (!isEmergency && wasEmergency.current) choiceRef.current?.querySelector('button')?.focus()
    wasEmergency.current = isEmergency
  }, [isEmergency])

  if (!emergencyOffered(findings)) return null

  return (
    <section
      aria-label="Emergency or safety"
      data-emergency-panel=""
      className={`flex flex-col gap-3 rounded-[var(--radius-sm)] border p-3 ${
        isEmergency ? 'border-[var(--color-warning)] bg-[var(--color-warning-container)]' : 'border-[var(--color-border)] bg-[var(--color-surface-container)]'
      } ${className ?? ''}`}
    >
      {error && (
        <div role="alert" className="rounded-[var(--radius-sm)] bg-[var(--color-error-container)] px-3 py-2 text-sm text-[var(--color-destructive)]">
          {error}
        </div>
      )}

      {isEmergency ? (
        <>
          <p className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-on-warning-container)]">
            <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            Emergency or safety
          </p>
          <p className="text-[13px] text-[var(--color-on-warning-container)]">It saves at once. An Admin reviews it afterwards.</p>
          <FormField
            label="What made this an emergency or safety need"
            required
            // The error is the field's own: FormField puts it under the control with role="alert" and folds its id into aria-describedby, so a keyboard user focused on the textarea hears it.
            error={message ?? undefined}
            hint={`At least ${MIN_REASON_LENGTH} characters${stillNeeded > 0 ? `, ${stillNeeded} more needed` : ''}. Kept with the shift.`}
          >
            <textarea
              ref={reasonRef}
              id={descriptionId}
              rows={3}
              maxLength={MAX_EMERGENCY_LENGTH}
              value={reason}
              disabled={readOnly}
              onChange={e => onReasonChange(e.target.value)}
              placeholder="e.g. Participant was unsafe at the time of the shift and needed support now"
            />
          </FormField>
          <div>
            <Button variant="ghost" size="sm" disabled={readOnly} onClick={() => onChoiceChange('none')}>
              Back
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[13px] text-[var(--color-foreground)]">
            You can change the shift so it costs less, ask an Admin to save it with a reason, or, if it is an emergency or a safety need, book it now. An Admin reviews it afterwards.
          </p>
          <div ref={choiceRef}>
            <Button variant="secondary" disabled={readOnly} onClick={() => onChoiceChange('emergency')}>
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              Emergency or safety
            </Button>
          </div>
        </>
      )}

      {/* Deliberately NOT role="status". ShiftSlideOver already keeps a polite region for its own notice and its tests assert there is exactly one (or zero) live status in that panel; a second one here
          would double-announce every save. The visual cue is enough while the controls are held disabled. */}
      {pending && (
        <p className="flex items-center gap-1.5 text-xs text-[var(--color-muted-foreground)]">
          <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
          Saving — the description above is kept so you can try again if it does not save.
        </p>
      )}
    </section>
  )
}
