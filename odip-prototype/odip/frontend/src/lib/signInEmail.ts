// Sending a person the link to set their password, told honestly. Pure of JSX; the one call into Firebase is lib/setPasswordEmail.ts.
//
// The email goes from Firebase (the app has no SMTP), and Firebase can only reset a password for an account that exists. Not everyone has
// one: staff added through the staff form, and users created before Firebase sync, have a user row and nothing else. So the flow is two
// steps, and the words follow what actually happened in them:
//   1. the server makes sure the account exists (creating a verified, passwordless one when there is none) and says which it did, and
//   2. Firebase is asked to send the link.
// Neither step throws to the caller: a failure comes back as an outcome that describeEmailOutcome turns into a sentence naming the address.
import type { SignInAccountDto } from '@/api/types'
import { sendSetPasswordEmail } from '@/lib/setPasswordEmail'
import { extractErrorMessage } from '@/lib/utils'

export type AccountState = SignInAccountDto['firebaseAccount']

/** Why no link went: our server could not set the account up, or Firebase refused or could not be reached. */
export type EmailFailure = 'account' | 'too-many-requests' | 'invalid-email' | 'network' | 'other'

export type EmailOutcome =
  | { ok: true; email: string; account: AccountState }
  | { ok: false; email: string; reason: EmailFailure; /** The server's own sentence, for a failure of the account step. */ detail?: string }

// Firebase's error codes that call for different advice. Anything else is "other": what to do about it does not depend on which it was.
const FIREBASE_FAILURES: Record<string, EmailFailure> = {
  'auth/too-many-requests': 'too-many-requests',
  'auth/invalid-email': 'invalid-email',
  'auth/network-request-failed': 'network',
}

function failureOf(err: unknown): EmailFailure {
  const code = (err as { code?: unknown } | null)?.code
  return (typeof code === 'string' && FIREBASE_FAILURES[code]) || 'other'
}

async function send(email: string, account: AccountState): Promise<EmailOutcome> {
  try {
    await sendSetPasswordEmail(email)
    return { ok: true, email, account }
  } catch (err) {
    return { ok: false, email, reason: failureOf(err) }
  }
}

/** Step 1 then step 2: `ensure` is the matching sign-in-account route; nothing is sent unless it succeeds. Never throws. */
export async function ensureAndSendSetPasswordEmail(email: string, ensure: () => Promise<SignInAccountDto>): Promise<EmailOutcome> {
  let account: AccountState
  try {
    account = (await ensure()).firebaseAccount
  } catch (err) {
    return { ok: false, email, reason: 'account', detail: extractErrorMessage(err, '') || undefined }
  }
  return send(email, account)
}

/** Step 2 alone, for an address whose account state the server has just told us (a create response). Never throws. */
export function sendSetPasswordEmailFor(email: string, account: AccountState): Promise<EmailOutcome> {
  return send(email, account)
}

/**
 * The sentence for an outcome, and whether it is good news. It always names the address, never claims delivery for a failure, and gives
 * advice that fits the failure: only a rate limit or a dropped connection is worth trying again soon, and an invalid address needs fixing
 * first. `retry` is what the person does to try again, as an imperative that follows "then" and "To try again,": the control THIS screen
 * offers ("use Send set-password email on their row", "use Send again").
 */
export function describeEmailOutcome(outcome: EmailOutcome, retry: string): { tone: 'success' | 'error'; message: string } {
  const { email } = outcome
  if (outcome.ok) {
    const verb = outcome.account === 'created' ? 'set' : 'reset'
    return { tone: 'success', message: `We've sent ${email} a link to ${verb} their password. It can take a few minutes, so ask them to check spam.` }
  }

  const noLink = `No link was sent to ${email}.`
  switch (outcome.reason) {
    case 'account':
      return { tone: 'error', message: `${noLink} ${outcome.detail ?? "We couldn't set up a sign-in account for them."}` }
    case 'too-many-requests':
      return { tone: 'error', message: `${noLink} Firebase is limiting emails for now. Wait a few minutes, then ${retry}.` }
    case 'invalid-email':
      return { tone: 'error', message: `${noLink} That doesn't look like a valid email address. Correct it, then ${retry}.` }
    case 'network':
      return { tone: 'error', message: `${noLink} We couldn't reach Firebase. Check your connection, then ${retry}.` }
    case 'other':
      return { tone: 'error', message: `${noLink} To try again, ${retry}.` }
  }
}
