import { describe, expect, it } from 'vitest'
import { MICROSOFT_REFUSAL_CODES, SIGN_IN_REFUSAL_CODES, SignInRefused, describeMicrosoftOutcome, describeSignInRefusal, describeWait, signInRefusalOf, type SignInRefusal } from './signInRefusal'

const refused = (code: SignInRefusal['code'], retryAfterSeconds: number | null = null): SignInRefusal => ({ code, retryAfterSeconds })

describe('the codes', () => {
  it('are exactly the ones the server sends, so a change to the list is deliberate (ExchangeRefusalTests pins the same list)', () => {
    expect([...SIGN_IN_REFUSAL_CODES].sort()).toEqual(
      ['Ambiguous', 'EmailNotVerified', 'InvalidToken', 'LockedOut', 'NoOdipAccount', 'ProviderNotAllowed', 'TenantInactive', 'AddressUnconfirmed', 'SessionLengthReached', 'MfaEnrolmentRequired'].sort(),
    )
  })
})

describe('signInRefusalOf', () => {
  it.each(['EmailNotVerified', 'NoOdipAccount', 'TenantInactive', 'ProviderNotAllowed', 'Ambiguous', 'InvalidToken', 'SessionLengthReached', 'MfaEnrolmentRequired'])('reads a 401 with the code %s', code => {
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

  it('says a link was sent a moment ago when the page held the automatic send back, rather than that one is being sent now', () => {
    expect(describeSignInRefusal(refused('EmailNotVerified'), email, 'recent').sentence)
      .toBe("Your email address isn't verified yet. We sent a verification link to jane.smith@acme.example.com a moment ago. Open it, then sign in again.")
  })

  it('does not claim a link was sent when it was not, and points at Send it again', () => {
    const words = describeSignInRefusal(refused('EmailNotVerified'), email, 'not-sent')

    expect(words.sentence).toBe("Your email address isn't verified yet, and we couldn't send the verification link just now.")
    expect(words.sentence).not.toMatch(/we've sent/i)
    expect(words.nextStep).toBe('Wait a minute, then use Send it again.')
  })

  it('says an address with no ODIP account is not set up and who to ask', () => {
    expect(describeSignInRefusal(refused('NoOdipAccount'), email).sentence).toBe("jane.smith@acme.example.com isn't set up in Bunya Support. Ask your administrator to add you.")
  })

  it('asks the organisation to confirm the address and never calls it wrong', () => {
    const words = describeSignInRefusal(refused('AddressUnconfirmed'), email)

    expect(words).toEqual({
      sentence: `Your organisation needs to confirm ${email} before you can sign in to Bunya Support.`,
      nextStep: 'Ask your administrator to confirm it.',
    })
    expect(JSON.stringify(words)).not.toMatch(/wrong|incorrect|invalid/i)
  })

  it('says an inactive organisation is inactive, with the next step', () => {
    expect(describeSignInRefusal(refused('TenantInactive'), email)).toEqual({
      sentence: "Your organisation's Bunya Support account is inactive.",
      nextStep: 'Ask your administrator to reactivate it.',
    })
  })

  it('says a sign-in method that is not enabled, and to use email and password', () => {
    expect(describeSignInRefusal(refused('ProviderNotAllowed'), email).sentence).toBe("That sign-in method isn't enabled for Bunya Support. Use your email and password.")
  })

  it('says no more for an ambiguous address than that it cannot sign in yet and to ask the administrator: not that other accounts share it', () => {
    const words = describeSignInRefusal(refused('Ambiguous'), email)

    expect(words).toEqual({
      sentence: "We can't sign you in with jane.smith@acme.example.com yet.",
      nextStep: 'Ask your administrator to check your account.',
    })
    expect(`${words.sentence} ${words.nextStep}`).not.toMatch(/more than one|another|shared?/i)
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

  it('words the two-step refusal', () => {
    expect(describeSignInRefusal(refused('MfaEnrolmentRequired'), email)).toEqual({
      sentence: 'Your role needs two-step verification.',
      nextStep: 'Sign in again to set it up.',
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

// The Microsoft callbacks refuse with 21 codes (Odip.Api/Services/MicrosoftRefusal.cs), pinned here in file order. They arrive in the URL (?microsoft=<code>), so an
// unknown one must still read sensibly.
describe('the Microsoft outcome words', () => {
  const PLACES = ['signin', 'organisation', 'account'] as const

  it('pins the Microsoft refusal codes', () => {
    expect([...MICROSOFT_REFUSAL_CODES]).toEqual([
      'InvalidToken', 'NoOdipAccount', 'TenantInactive', 'LockedOut', 'MicrosoftNotLinked', 'MicrosoftPersonalAccount', 'MicrosoftGuest', 'MicrosoftLinkFromAccount',
      'MicrosoftNoEmail', 'MicrosoftCannotCreate', 'MicrosoftCancelled', 'SignInRequired', 'MicrosoftAdminOnly', 'MicrosoftOrgAlreadyLinked', 'MicrosoftTenantTaken',
      'MicrosoftSessionChanged', 'MicrosoftWrongTenant', 'MicrosoftAccountTaken', 'MicrosoftAccountAlreadyLinked', 'MicrosoftOnlySignIn', 'MicrosoftSessionEnded', 'SessionLengthReached',
    ])
  })

  it('every Microsoft code has words in every place', () => {
    for (const code of MICROSOFT_REFUSAL_CODES) {
      for (const place of PLACES) {
        const words = describeMicrosoftOutcome(code, place)
        expect(words.sentence, `${code} ${place}`).not.toBe('')
        expect(words.tone, `${code} ${place}`).toMatch(/^(danger|warning|info)$/)
        expect(`${words.sentence} ${words.nextStep ?? ''}`, `${code} ${place}`).not.toMatch(/odip/i)
      }
    }
  })

  it('an unknown Microsoft code gets the InvalidToken words', () => {
    expect(describeMicrosoftOutcome('SomethingNew', 'signin')).toEqual(describeMicrosoftOutcome('InvalidToken', 'signin'))
    expect(describeMicrosoftOutcome(null, 'account')).toEqual(describeMicrosoftOutcome('InvalidToken', 'account'))
  })

  it('MicrosoftNotLinked words differ for signin and account', () => {
    expect(describeMicrosoftOutcome('MicrosoftNotLinked', 'signin').sentence).toBe("Your organisation hasn't turned on Microsoft sign-in.")
    expect(describeMicrosoftOutcome('MicrosoftNotLinked', 'account').sentence).toBe('Microsoft sign-in has been turned off for your organisation.')
  })

  it('sets the tone per code and tells the person what to do next', () => {
    expect(describeMicrosoftOutcome('MicrosoftCancelled', 'signin').tone).toBe('warning')
    expect(describeMicrosoftOutcome('MicrosoftSessionEnded', 'signin')).toMatchObject({ tone: 'info', sentence: "You've been signed out." })
    expect(describeMicrosoftOutcome('SessionLengthReached', 'signin')).toMatchObject({ tone: 'info', sentence: "You've been signed out." })
    expect(describeMicrosoftOutcome('MicrosoftOrgAlreadyLinked', 'organisation').tone).toBe('info')
    expect(describeMicrosoftOutcome('MicrosoftOrgAlreadyLinked', 'organisation').nextStep).toBeUndefined()
    expect(describeMicrosoftOutcome('MicrosoftOnlySignIn', 'account')).toMatchObject({
      tone: 'danger',
      sentence: "Microsoft is your only way to sign in, so you can't unlink it yet.",
      nextStep: 'Ask an admin to send you a set-password email from your page in Staff, set a password, then unlink.',
    })
  })
})
