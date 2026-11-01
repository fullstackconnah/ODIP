// The words for what Firebase says when a code is checked or a factor is added or removed. One list, so the login step, the set-up panel and Settings agree.

import type { MultiFactorResolver, User } from 'firebase/auth'

export type TwoStepProblemKind = 'wrong' | 'too-many' | 'timed-out' | 'network' | 'expired' | 'recent-login' | 'unavailable' | 'other'

export interface TwoStepProblem {
  kind: TwoStepProblemKind
  sentence: string
}

const TIMED_OUT = ['auth/invalid-multi-factor-session', 'auth/missing-multi-factor-session']

/** `where`: the code was typed at sign-in ('verify') or while setting up ('setup'); only the wrong-code and expired sentences differ. */
export function twoStepProblem(err: unknown, where: 'verify' | 'setup'): TwoStepProblem {
  const code = (err as { code?: string } | null)?.code ?? ''
  if (code === 'auth/invalid-verification-code') {
    return {
      kind: 'wrong',
      sentence: where === 'verify'
        ? "That code didn't work. Enter the newest code from your app."
        : "That code didn't work. Check the app lists Bunya Support, then enter the newest code.",
    }
  }
  if (code === 'auth/too-many-requests') return { kind: 'too-many', sentence: 'Too many tries. Wait a few minutes, then sign in again.' }
  if (TIMED_OUT.includes(code) || (where === 'verify' && code === 'auth/code-expired')) return { kind: 'timed-out', sentence: 'This sign-in timed out. Sign in again.' }
  if (code === 'auth/code-expired') return { kind: 'expired', sentence: 'This setup code has expired.' }
  if (code === 'auth/requires-recent-login') return { kind: 'recent-login', sentence: 'For your security, sign in again to finish setting up.' }
  if (code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation') {
    return { kind: 'unavailable', sentence: "Two-step verification isn't available yet. Ask your administrator." }
  }
  if (code === 'auth/network-request-failed' || code === 'ERR_NETWORK') return { kind: 'network', sentence: 'Network error. Check your connection and try again.' }
  return { kind: 'other', sentence: 'Something went wrong. Try again.' }
}

/** The digits of what was typed or pasted ("123 456" → "123456"), at most 6. */
export const codeDigits = (typed: string) => typed.replace(/\D/g, '').slice(0, 6)

/** The password was right and the account has an authenticator app: the page asks for the code, resolving the sign-in with this. */
export class SecondFactorRequired extends Error {
  readonly resolver: MultiFactorResolver

  constructor(resolver: MultiFactorResolver) {
    super('Second factor required')
    this.name = 'SecondFactorRequired'
    this.resolver = resolver
  }
}

/** The exchange wants two-step verification and this account has none: the Firebase session is kept so the page can add the factor to this user. */
export class EnrolmentRequired extends Error {
  readonly user: User

  constructor(user: User) {
    super('Two-step verification must be set up')
    this.name = 'EnrolmentRequired'
    this.user = user
  }
}

/** A resend needs a code first (the account has two-step verification), so it can't go from here. */
export class SignInAgainNeeded extends Error {
  constructor() {
    super('Sign in again')
    this.name = 'SignInAgainNeeded'
  }
}
