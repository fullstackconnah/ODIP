import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { describeEmailOutcome, type EmailOutcome } from '@/lib/signInEmail'

type SignInEmailOutcomeProps = {
  outcome: EmailOutcome
  /** What the person does to try again, as an imperative ("use Send again"): it ends the advice in a failure. */
  retry: string
  /** When given, a failure carries a "Send again" button right beside it, so the retry is where the person is looking. */
  onRetry?: () => void
  /** The retry is under way: the button says so and does nothing, so it cannot send a second email. */
  retrying?: boolean
  /**
   * Whether the Callout announces itself (a polite status for good news, an alert for a failure). True by default. A view that writes the same
   * sentence into a live region of its own that was there first (`AnnouncementRegion`) passes false, so nothing is said twice.
   */
  announce?: boolean
  className?: string
}

/**
 * What became of the set-password email, as a Callout (lib/signInEmail.ts words it): good news is a polite status, a failure is a warning
 * that interrupts, names the address and says no link was sent. Shown where the person made the request (a create form's done state), so the
 * answer is not taken away by a navigation or a timer.
 *
 * Send again is `aria-disabled` while it retries, never `disabled`: disabling the button that was just activated can drop keyboard focus in some
 * browsers. aria-disabled does not stop the click, so the handler is guarded here.
 */
export function SignInEmailOutcome({ outcome, retry, onRetry, retrying = false, announce = true, className }: SignInEmailOutcomeProps) {
  const { tone, message } = describeEmailOutcome(outcome, retry)
  return (
    <Callout
      tone={tone === 'success' ? 'success' : 'warning'}
      className={className}
      announce={announce}
      actions={
        !outcome.ok && onRetry ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (!retrying) onRetry()
            }}
            aria-disabled={retrying || undefined}
            className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
          >
            {retrying ? 'Sending...' : 'Send again'}
          </Button>
        ) : undefined
      }
    >
      <span className="break-words">{message}</span>
    </Callout>
  )
}
