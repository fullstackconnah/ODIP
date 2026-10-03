// The sign-in exchange (POST /auth/exchange) refuses a sign-in with a 401 whose body carries a code saying why, or with a 429 and a Retry-After, so the login
// page can tell the person what to do instead of "login failed". The server holds the reasons (Odip.Api/Services/ExchangeRefusal.cs, which says why each is safe
// to reveal); this file holds the same list and the words for each. The two sides are separate builds, so the list is pinned on both (ExchangeRefusalTests, and
// signInRefusal.test.ts here): changing it is deliberate on either side.

export const SIGN_IN_REFUSAL_CODES = [
  'InvalidToken',
  'EmailNotVerified',
  'ProviderNotAllowed',
  'NoOdipAccount',
  'Ambiguous',
  'TenantInactive',
  'LockedOut',
] as const

export type SignInRefusalCode = (typeof SIGN_IN_REFUSAL_CODES)[number]

export interface SignInRefusal {
  code: SignInRefusalCode
  /** How long the server says to wait (Retry-After), for LockedOut; null when it did not say. */
  retryAfterSeconds: number | null
}

/**
 * Whether the verification link went out when the exchange said the email was not verified. 'recent' is no send THIS time, because the page asked the sign-in not
 * to (one was attempted a moment ago: see verificationSend.ts). Only meaningful for EmailNotVerified.
 */
export type VerificationSend = 'sent' | 'not-sent' | 'recent'

/** What the sign-in mutation rejects with when the exchange refused: the refusal, and (for EmailNotVerified) whether the verification link went. */
export class SignInRefused extends Error {
  readonly refusal: SignInRefusal
  readonly verification: VerificationSend | undefined

  constructor(refusal: SignInRefusal, verification?: VerificationSend) {
    super(`Sign-in refused: ${refusal.code}`)
    this.name = 'SignInRefused'
    this.refusal = refusal
    this.verification = verification
  }
}

type ExchangeFailure = {
  response?: { status?: number; data?: { code?: string } | null; headers?: Record<string, unknown> | { get?: (name: string) => unknown } }
}

function retryAfterSeconds(headers: NonNullable<ExchangeFailure['response']>['headers']): number | null {
  if (!headers) return null
  const raw = typeof (headers as { get?: unknown }).get === 'function'
    ? (headers as { get: (name: string) => unknown }).get('retry-after')
    : (headers as Record<string, unknown>)['retry-after']
  const seconds = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : NaN
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

/**
 * The refusal the exchange gave, when this failure is one; otherwise null (a Firebase error, a network failure). A 401 whose code is missing or not one this page
 * knows (a newer server) is the generic InvalidToken. Any 429 is LockedOut, with or without the body: the rate limiter's own 429 has none.
 */
export function signInRefusalOf(err: unknown): SignInRefusal | null {
  const response = (err as ExchangeFailure | null | undefined)?.response
  if (!response) return null

  if (response.status === 429) return { code: 'LockedOut', retryAfterSeconds: retryAfterSeconds(response.headers) }
  if (response.status !== 401) return null

  const code = response.data?.code
  const known = SIGN_IN_REFUSAL_CODES.find(candidate => candidate === code)
  return { code: known && known !== 'LockedOut' ? known : 'InvalidToken', retryAfterSeconds: null }
}

/** The wait, in plain words: "1 minute", "10 minutes", or "a few minutes" when the server did not say. */
export function describeWait(seconds: number | null): string {
  if (seconds === null) return 'a few minutes'
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

export interface RefusalWords {
  /** One plain sentence saying what happened. */
  sentence: string
  /** What to do next, when the sentence does not already say. */
  nextStep?: string
}

/**
 * The words for a refusal. `email` is what the person typed. For EmailNotVerified, `verification` says whether the verification link went out (the sign-in
 * mutation sends it automatically, at most once per hold); the sentence is truthful about it either way.
 */
export function describeSignInRefusal(refusal: SignInRefusal, email: string, verification?: VerificationSend): RefusalWords {
  switch (refusal.code) {
    case 'EmailNotVerified':
      if (verification === 'sent') {
        return { sentence: `Your email address isn't verified yet. We've sent a verification link to ${email}. Open it, then sign in again.` }
      }
      if (verification === 'recent') {
        return { sentence: `Your email address isn't verified yet. We sent a verification link to ${email} a moment ago. Open it, then sign in again.` }
      }
      return { sentence: "Your email address isn't verified yet, and we couldn't send the verification link just now.", nextStep: 'Wait a minute, then use Send it again.' }
    case 'NoOdipAccount':
      return { sentence: `${email} isn't set up in ODIP. Ask your administrator to add you.` }
    case 'TenantInactive':
      return { sentence: "Your organisation's ODIP account is inactive.", nextStep: 'Ask your administrator to reactivate it.' }
    case 'ProviderNotAllowed':
      return { sentence: "That sign-in method isn't enabled for ODIP. Use your email and password." }
    case 'Ambiguous':
      return { sentence: `More than one ODIP account uses ${email}, so we can't tell which is yours.`, nextStep: 'Ask your administrator to fix it.' }
    case 'LockedOut':
      return { sentence: `Too many attempts. Try again in ${describeWait(refusal.retryAfterSeconds)}.` }
    case 'InvalidToken':
      return { sentence: "We couldn't sign you in.", nextStep: 'Try again. If it keeps happening, ask your administrator.' }
  }
}
