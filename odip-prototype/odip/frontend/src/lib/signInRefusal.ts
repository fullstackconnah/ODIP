// The sign-in exchange (POST /auth/exchange) refuses a sign-in with a 401 whose body carries a code saying why, or with a 429 and a Retry-After, so the login
// page can tell the person what to do instead of "login failed". The server holds the reasons (Odip.Api/Services/ExchangeRefusal.cs, which says why each is safe
// to reveal); this file holds the same list and the words for each. The two sides are separate builds, so the list is pinned on both (ExchangeRefusalTests, and
// signInRefusal.test.ts here): changing it is deliberate on either side.

import type { CalloutTone } from '@/components/Callout'

export const SIGN_IN_REFUSAL_CODES = [
  'InvalidToken',
  'EmailNotVerified',
  'ProviderNotAllowed',
  'NoOdipAccount',
  'Ambiguous',
  'TenantInactive',
  'AddressUnconfirmed',
  'LockedOut',
  'SessionLengthReached',
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
      return { sentence: `${email} isn't set up in Bunya Support. Ask your administrator to add you.` }
    case 'TenantInactive':
      return { sentence: "Your organisation's Bunya Support account is inactive.", nextStep: 'Ask your administrator to reactivate it.' }
    case 'AddressUnconfirmed':
      // Not "wrong": the address may well be right, it only has not been checked yet.
      return { sentence: `Your organisation needs to confirm ${email} before you can sign in to Bunya Support.`, nextStep: 'Ask your administrator to confirm it.' }
    case 'ProviderNotAllowed':
      return { sentence: "That sign-in method isn't enabled for Bunya Support. Use your email and password." }
    case 'Ambiguous':
      // No more than to ask the administrator: that other accounts share the address is for the server log and the runbook.
      return { sentence: `We can't sign you in with ${email} yet.`, nextStep: 'Ask your administrator to check your account.' }
    case 'LockedOut':
      return { sentence: `Too many attempts. Try again in ${describeWait(refusal.retryAfterSeconds)}.` }
    case 'SessionLengthReached':
      return { sentence: 'Your organisation asks you to sign in again.', nextStep: 'Sign in to carry on.' }
    case 'InvalidToken':
      return { sentence: "We couldn't sign you in.", nextStep: 'Try again. If it keeps happening, ask your administrator.' }
  }
}

// The Microsoft callbacks refuse (or finish) by returning to a page with ?microsoft=<code>. The codes are those of Odip.Api/Services/MicrosoftRefusal.cs, pinned on both
// sides like the list above. 'linked' (success) is not a refusal: the Settings pages handle it themselves.
export const MICROSOFT_REFUSAL_CODES = [
  'InvalidToken',
  'NoOdipAccount',
  'TenantInactive',
  'LockedOut',
  'MicrosoftNotLinked',
  'MicrosoftPersonalAccount',
  'MicrosoftGuest',
  'MicrosoftLinkFromAccount',
  'MicrosoftNoEmail',
  'MicrosoftCannotCreate',
  'MicrosoftCancelled',
  'SignInRequired',
  'MicrosoftAdminOnly',
  'MicrosoftOrgAlreadyLinked',
  'MicrosoftTenantTaken',
  'MicrosoftSessionChanged',
  'MicrosoftWrongTenant',
  'MicrosoftAccountTaken',
  'MicrosoftAccountAlreadyLinked',
  'MicrosoftOnlySignIn',
  'MicrosoftSessionEnded',
  'SessionLengthReached',
] as const

type MicrosoftWords = RefusalWords & { tone: CalloutTone }
const ASK_ADMIN_TO_ADD = 'Ask your administrator to add you.'
const WORK_ACCOUNT = 'Use the work account your organisation gave you.'

const MICROSOFT_WORDS: Record<(typeof MICROSOFT_REFUSAL_CODES)[number], MicrosoftWords> = {
  InvalidToken: { tone: 'danger', sentence: "Microsoft sign-in didn't go through.", nextStep: 'Try again. If it keeps happening, ask your administrator.' },
  LockedOut: { tone: 'danger', sentence: 'Too many attempts.', nextStep: 'Try again in a few minutes.' },
  TenantInactive: { tone: 'danger', sentence: "Your organisation's Bunya Support account is inactive.", nextStep: 'Ask your administrator to reactivate it.' },
  NoOdipAccount: { tone: 'danger', sentence: "This Microsoft account can't sign in to Bunya Support.", nextStep: 'Ask your administrator to check your account.' },
  MicrosoftNotLinked: { tone: 'danger', sentence: "Your organisation hasn't turned on Microsoft sign-in.", nextStep: 'Sign in with your email and password, or ask your administrator.' },
  MicrosoftPersonalAccount: { tone: 'danger', sentence: "That's a personal Microsoft account.", nextStep: WORK_ACCOUNT },
  MicrosoftGuest: { tone: 'danger', sentence: "That Microsoft account is a guest in your organisation's directory.", nextStep: WORK_ACCOUNT },
  MicrosoftLinkFromAccount: { tone: 'danger', sentence: 'You already have a Bunya Support account with this email.', nextStep: 'Sign in with your password, then link Microsoft in Settings, Profile.' },
  MicrosoftNoEmail: { tone: 'danger', sentence: "Your Microsoft account has no email address, so we can't set you up.", nextStep: ASK_ADMIN_TO_ADD },
  MicrosoftCannotCreate: { tone: 'danger', sentence: "We can't create a Bunya Support account for this Microsoft account.", nextStep: ASK_ADMIN_TO_ADD },
  MicrosoftCancelled: { tone: 'warning', sentence: "Microsoft didn't finish signing you in.", nextStep: "Try again. If Microsoft asked for an admin's approval, ask your IT administrator to approve Bunya Support." },
  SignInRequired: { tone: 'warning', sentence: 'Your Bunya Support session ended before Microsoft finished.', nextStep: 'Sign in again, then try again from this page.' },
  MicrosoftAdminOnly: {
    tone: 'danger',
    sentence: "That Microsoft account isn't an administrator of your directory.",
    nextStep: 'Link with a Global, Privileged Role, Application or Cloud Application Administrator account, or ask your IT administrator to link it.',
  },
  MicrosoftOrgAlreadyLinked: { tone: 'info', sentence: 'Microsoft sign-in is already on for your organisation.' },
  MicrosoftTenantTaken: { tone: 'danger', sentence: 'That Microsoft directory is already linked to another Bunya Support organisation.', nextStep: "If that's not right, contact Bunya Support." },
  MicrosoftSessionChanged: { tone: 'warning', sentence: 'Your Bunya Support account changed while Microsoft was open.', nextStep: 'Reload the page and try again.' },
  MicrosoftWrongTenant: { tone: 'danger', sentence: "That Microsoft account isn't from your organisation's directory.", nextStep: 'Sign in to Microsoft with your work account, then try again.' },
  MicrosoftAccountTaken: { tone: 'danger', sentence: 'That Microsoft account is already linked to another person in Bunya Support.', nextStep: 'Ask your administrator.' },
  MicrosoftAccountAlreadyLinked: { tone: 'info', sentence: 'Your Microsoft account is already linked.' },
  // The server's own 409 says "Ask an admin to set up a password first", which no admin can do; the Staff page can send a set-password email.
  MicrosoftOnlySignIn: {
    tone: 'danger',
    sentence: "Microsoft is your only way to sign in, so you can't unlink it yet.",
    nextStep: 'Ask an admin to send you a set-password email from your page in Staff, set a password, then unlink.',
  },
  MicrosoftSessionEnded: {
    tone: 'info',
    sentence: "You've been signed out.",
    nextStep: 'Microsoft sign-ins last up to 12 hours, or end sooner if your account changes. Sign in again to carry on.',
  },
  // Settings > Security: the organisation's session length ran out. Reached from the Firebase path too, which the login page words through this list.
  SessionLengthReached: {
    tone: 'info',
    sentence: "You've been signed out.",
    nextStep: 'Your organisation asks everyone to sign in again after a set time. Sign in to carry on.',
  },
}

/** The words and tone for the code a Microsoft callback returned with; a code this build doesn't know reads as InvalidToken. `place` changes the words only for MicrosoftNotLinked. */
export function describeMicrosoftOutcome(code: string | null, place: 'signin' | 'organisation' | 'account'): MicrosoftWords {
  const words = MICROSOFT_WORDS[code as keyof typeof MICROSOFT_WORDS] ?? MICROSOFT_WORDS.InvalidToken
  if (code === 'MicrosoftNotLinked' && place === 'account') {
    return { tone: 'danger', sentence: 'Microsoft sign-in has been turned off for your organisation.', nextStep: 'Ask your administrator to turn it back on.' }
  }
  return words
}
