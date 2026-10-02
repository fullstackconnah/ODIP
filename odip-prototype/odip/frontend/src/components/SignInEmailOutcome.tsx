import { Button } from '@/components/Button'
import { Callout } from '@/components/Callout'
import { describeEmailOutcome, type EmailOutcome } from '@/lib/signInEmail'

type SignInEmailOutcomeProps = {
  outcome: EmailOutcome
  /** Where to try again, as the phrase that follows "Send set-password email" ("on their row"). Used by the failures with no better advice. */
  retryAt: string
  /** When given, a failure carries a "Send again" button right beside it, so the retry is where the person is looking. */
  onRetry?: () => void
  /** The retry is under way: the button is switched off so it cannot send a second email. */
  retrying?: boolean
  className?: string
}

/**
 * What became of the set-password email, as a Callout (lib/signInEmail.ts words it): good news is a polite status, a failure is a warning
 * that interrupts, names the address and says no link was sent. Shown where the person made the request (a create form's done state), so the
 * answer is not taken away by a navigation or a timer.
 */
export function SignInEmailOutcome({ outcome, retryAt, onRetry, retrying = false, className }: SignInEmailOutcomeProps) {
  const { tone, message } = describeEmailOutcome(outcome, retryAt)
  return (
    <Callout
      tone={tone === 'success' ? 'success' : 'warning'}
      className={className}
      actions={
        !outcome.ok && onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry} disabled={retrying}>
            {retrying ? 'Sending...' : 'Send again'}
          </Button>
        ) : undefined
      }
    >
      <span className="break-words">{message}</span>
    </Callout>
  )
}
