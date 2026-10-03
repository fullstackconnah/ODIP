import { describe, expect, it } from 'vitest'
import { SIGN_IN_REFUSAL_CODES, SignInRefused, describeSignInRefusal, describeWait, signInRefusalOf, type SignInRefusal } from './signInRefusal'

const refused = (code: SignInRefusal['code'], retryAfterSeconds: number | null = null): SignInRefusal => ({ code, retryAfterSeconds })

describe('the codes', () => {
  it('are exactly the ones the server sends, so a change to the list is deliberate (ExchangeRefusalTests pins the same list)', () => {
    expect([...SIGN_IN_REFUSAL_CODES].sort()).toEqual(
      ['Ambiguous', 'EmailNotVerified', 'InvalidToken', 'LockedOut', 'NoOdipAccount', 'ProviderNotAllowed', 'TenantInactive'],
    )
  })
})

describe('signInRefusalOf', () => {
  it.each(['EmailNotVerified', 'NoOdipAccount', 'TenantInactive', 'ProviderNotAllowed', 'Ambiguous', 'InvalidToken'])('reads a 401 with the code %s', code => {
    expect(signInRefusalOf({ response: { status: 401, data: { code } } })).toEqual({ code, retryAfterSeconds: null })
  })

  it('reads a 401 with no code, or one it does not know (a newer server), as the generic InvalidToken', () => {
    expect(signInRefusalOf({ response: { status: 401, data: {} } })).toEqual(refused('InvalidToken'))
    expect(signInRefusalOf({ response: { status: 401, data: null } })).toEqual(refused('InvalidToken'))
    expect(signInRefusalOf({ response: { status: 401, data: { code: 'SomethingNew' } } })).toEqual(refused('InvalidToken'))
    // LockedOut belongs to a 429; on a 401 it is not believed.
    expect(signInRefusalOf({ response: { status: 401, data: { code: 'LockedOut' } } })).toEqual(refused('InvalidToken'))
  })

  it('reads any 429 as LockedOut, with or without a body (the rate limiter\'s own 429 has none), and takes the wait from Retry-After', () => {
    expect(signInRefusalOf({ response: { status: 429, data: { code: 'LockedOut' }, headers: { 'retry-after': '600' } } })).toEqual(refused('LockedOut', 600))
    expect(signInRefusalOf({ response: { status: 429, headers: { 'retry-after': 90 } } })).toEqual(refused('LockedOut', 90))
    expect(signInRefusalOf({ response: { status: 429 } })).toEqual(refused('LockedOut'))
  })

  it('reads Retry-After from an AxiosHeaders-style object as well as from a plain one', () => {
    const axiosHeaders = { get: (name: string) => (name === 'retry-after' ? '300' : undefined) }

    expect(signInRefusalOf({ response: { status: 429, headers: axiosHeaders } })).toEqual(refused('LockedOut', 300))
  })

  it.each(['abc', '0', '-5', ''])('ignores a Retry-After of %j', value => {
    expect(signInRefusalOf({ response: { status: 429, headers: { 'retry-after': value } } })).toEqual(refused('LockedOut'))
  })

  it('is null for anything that is not the exchange refusing: a Firebase error, a network failure, another status, nothing', () => {
    expect(signInRefusalOf({ code: 'auth/invalid-credential' })).toBeNull()
    expect(signInRefusalOf({ code: 'ERR_NETWORK', request: {} })).toBeNull()
    expect(signInRefusalOf({ response: { status: 500, data: { code: 'EmailNotVerified' } } })).toBeNull()
    expect(signInRefusalOf({ response: { status: 403 } })).toBeNull()
    expect(signInRefusalOf(null)).toBeNull()
    expect(signInRefusalOf(undefined)).toBeNull()
    expect(signInRefusalOf(new Error('boom'))).toBeNull()
  })
})

describe('describeWait', () => {
  it.each([
    [null, 'a few minutes'],
    [1, '1 minute'],
    [60, '1 minute'],
    [61, '2 minutes'],
    [600, '10 minutes'],
    [900, '15 minutes'],
  ])('says %s seconds as %s', (seconds, words) => {
    expect(describeWait(seconds)).toBe(words)
  })
})

describe('describeSignInRefusal', () => {
  const email = 'jane.smith@acme.example.com'

  it('tells an unverified email that a link has been sent, when one has, and what to do with it', () => {
    expect(describeSignInRefusal(refused('EmailNotVerified'), email, 'sent').sentence)
      .toBe("Your email address isn't verified yet. We've sent a verification link to jane.smith@acme.example.com. Open it, then sign in again.")
  })

  it('does not claim a link was sent when it was not, and points at Send it again', () => {
    const words = describeSignInRefusal(refused('EmailNotVerified'), email, 'not-sent')

    expect(words.sentence).toBe("Your email address isn't verified yet, and we couldn't send the verification link just now.")
    expect(words.sentence).not.toMatch(/we've sent/i)
    expect(words.nextStep).toBe('Wait a minute, then use Send it again.')
  })

  it('says an address with no ODIP account is not set up and who to ask', () => {
    expect(describeSignInRefusal(refused('NoOdipAccount'), email).sentence).toBe("jane.smith@acme.example.com isn't set up in ODIP. Ask your administrator to add you.")
  })

  it('says an inactive organisation is inactive, with the next step', () => {
    expect(describeSignInRefusal(refused('TenantInactive'), email)).toEqual({
      sentence: "Your organisation's ODIP account is inactive.",
      nextStep: 'Ask your administrator to reactivate it.',
    })
  })

  it('says a sign-in method that is not enabled, and to use email and password', () => {
    expect(describeSignInRefusal(refused('ProviderNotAllowed'), email).sentence).toBe("That sign-in method isn't enabled for ODIP. Use your email and password.")
  })

  it('says an ambiguous address is on more than one account, with the next step', () => {
    expect(describeSignInRefusal(refused('Ambiguous'), email)).toEqual({
      sentence: "More than one ODIP account uses jane.smith@acme.example.com, so we can't tell which is yours.",
      nextStep: 'Ask your administrator to fix it.',
    })
  })

  it('says how long to wait when locked out, in whole minutes rounded up', () => {
    expect(describeSignInRefusal(refused('LockedOut', 600), email).sentence).toBe('Too many attempts. Try again in 10 minutes.')
    expect(describeSignInRefusal(refused('LockedOut', 61), email).sentence).toBe('Too many attempts. Try again in 2 minutes.')
    expect(describeSignInRefusal(refused('LockedOut', 30), email).sentence).toBe('Too many attempts. Try again in 1 minute.')
    expect(describeSignInRefusal(refused('LockedOut'), email).sentence).toBe('Too many attempts. Try again in a few minutes.')
  })

  it('keeps the generic refusal generic', () => {
    expect(describeSignInRefusal(refused('InvalidToken'), email)).toEqual({
      sentence: "We couldn't sign you in.",
      nextStep: 'Try again. If it keeps happening, ask your administrator.',
    })
  })

  it('gives every code its own sentence', () => {
    const sentences = SIGN_IN_REFUSAL_CODES.map(code => describeSignInRefusal(refused(code), email, 'sent').sentence)

    expect(new Set(sentences).size).toBe(SIGN_IN_REFUSAL_CODES.length)
  })
})

describe('SignInRefused', () => {
  it('carries the refusal and whether the verification link went, and is an Error', () => {
    const failure = new SignInRefused(refused('EmailNotVerified'), 'sent')

    expect(failure).toBeInstanceOf(Error)
    expect(failure.refusal).toEqual(refused('EmailNotVerified'))
    expect(failure.verification).toBe('sent')
    expect(failure.message).toBe('Sign-in refused: EmailNotVerified')
  })
})
