import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  describeEmailOutcome, describeTypedPassword, ensureAndSendSetPasswordEmail, sendSetPasswordEmailFor, TENANT_FIRST_USER_ACCOUNT_FAILED, type EmailOutcome,
} from './signInEmail'

const { sendPasswordResetEmail, firebase } = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth). A getter, so each test can change it.
  firebase: { auth: { name: 'auth-stub' } as object | null },
}))

vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

const EMAIL = 'jane.smith@acme.example.com'
const authStub = { name: 'auth-stub' }

afterEach(() => {
  firebase.auth = authStub
  sendPasswordResetEmail.mockReset()
})

/** Firebase's own errors carry the reason in `code`. */
const firebaseError = (code: string) => Object.assign(new Error(`Firebase: Error (${code}).`), { code })

/** An axios-shaped failure: the API's envelope sits on `response.data`. */
const apiError = (message: string) => ({ response: { data: { success: false, errors: [message] } } })

describe('ensureAndSendSetPasswordEmail', () => {
  it('asks the server to make sure the account exists first, and only then asks Firebase to send', async () => {
    sendPasswordResetEmail.mockResolvedValue(undefined)
    let finishEnsure!: (value: { firebaseAccount: 'created' | 'existing' }) => void
    const ensure = vi.fn(() => new Promise<{ firebaseAccount: 'created' | 'existing' }>(resolve => { finishEnsure = resolve }))

    const pending = ensureAndSendSetPasswordEmail(EMAIL, ensure)

    expect(ensure).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
    finishEnsure({ firebaseAccount: 'created' })
    await expect(pending).resolves.toEqual({ ok: true, email: EMAIL, account: 'created' })
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, EMAIL)
  })

  it('carries on the server\'s word that the account was already there', async () => {
    sendPasswordResetEmail.mockResolvedValue(undefined)

    const outcome = await ensureAndSendSetPasswordEmail(EMAIL, async () => ({ firebaseAccount: 'existing' }))

    expect(outcome).toEqual({ ok: true, email: EMAIL, account: 'existing' })
  })

  it('sends nothing, and reports the server\'s reason, when the server cannot set the account up', async () => {
    const reason = 'Addresses at platform.example.com are reserved for platform administrators.'

    const outcome = await ensureAndSendSetPasswordEmail(EMAIL, () => Promise.reject(apiError(reason)))

    expect(outcome).toEqual({ ok: false, email: EMAIL, reason: 'account', detail: reason })
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('reports a failure with no message from the server without inventing one', async () => {
    const outcome = await ensureAndSendSetPasswordEmail(EMAIL, () => Promise.reject(new Error('Network Error')))

    expect(outcome).toEqual({ ok: false, email: EMAIL, reason: 'account', detail: undefined })
  })

  it.each([
    ['auth/too-many-requests', 'too-many-requests'],
    ['auth/invalid-email', 'invalid-email'],
    ['auth/network-request-failed', 'network'],
    ['auth/user-not-found', 'other'],
    ['auth/internal-error', 'other'],
  ])('maps Firebase %s to the %s failure, after the account was made sure of', async (code, reason) => {
    sendPasswordResetEmail.mockRejectedValue(firebaseError(code))

    const outcome = await ensureAndSendSetPasswordEmail(EMAIL, async () => ({ firebaseAccount: 'created' }))

    expect(outcome).toEqual({ ok: false, email: EMAIL, reason })
  })

  it('treats an error that is not Firebase\'s as an "other" send failure', async () => {
    sendPasswordResetEmail.mockRejectedValue(new Error('boom'))

    const outcome = await ensureAndSendSetPasswordEmail(EMAIL, async () => ({ firebaseAccount: 'created' }))

    expect(outcome).toEqual({ ok: false, email: EMAIL, reason: 'other' })
  })

  it('never throws', async () => {
    firebase.auth = null

    await expect(ensureAndSendSetPasswordEmail(EMAIL, async () => ({ firebaseAccount: 'created' }))).resolves.toMatchObject({ ok: false })
  })
})

describe('sendSetPasswordEmailFor', () => {
  it('sends straight away to an address whose account state is already known, without asking the server', async () => {
    sendPasswordResetEmail.mockResolvedValue(undefined)

    const outcome = await sendSetPasswordEmailFor(EMAIL, 'existing')

    expect(outcome).toEqual({ ok: true, email: EMAIL, account: 'existing' })
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(authStub, EMAIL)
  })

  it('reports a Firebase failure by its code', async () => {
    sendPasswordResetEmail.mockRejectedValue(firebaseError('auth/too-many-requests'))

    expect(await sendSetPasswordEmailFor(EMAIL, 'created')).toEqual({ ok: false, email: EMAIL, reason: 'too-many-requests' })
  })
})

describe('describeEmailOutcome', () => {
  // What the person should do to try again, as an imperative: where the screen offers the retry.
  const retry = 'use Send set-password email on their row'
  const sent = (account: 'created' | 'existing'): EmailOutcome => ({ ok: true, email: EMAIL, account })
  const failed = (reason: 'account' | 'too-many-requests' | 'invalid-email' | 'network' | 'other', detail?: string): EmailOutcome =>
    ({ ok: false, email: EMAIL, reason, detail })

  it('says "set" for an account that was just made and names the address', () => {
    expect(describeEmailOutcome(sent('created'), retry)).toEqual({
      tone: 'success',
      message: `We've sent ${EMAIL} a link to set their password. It can take a few minutes, so ask them to check spam.`,
    })
  })

  it('says "reset" for an account that was already there', () => {
    expect(describeEmailOutcome(sent('existing'), retry)).toEqual({
      tone: 'success',
      message: `We've sent ${EMAIL} a link to reset their password. It can take a few minutes, so ask them to check spam.`,
    })
  })

  it.each([
    ['too-many-requests', undefined, `No link was sent to ${EMAIL}. Firebase is limiting emails for now. Wait a few minutes, then use Send set-password email on their row.`],
    ['invalid-email', undefined, `No link was sent to ${EMAIL}. That doesn't look like a valid email address. Correct it, then use Send set-password email on their row.`],
    ['network', undefined, `No link was sent to ${EMAIL}. We couldn't reach Firebase. Check your connection, then use Send set-password email on their row.`],
    ['other', undefined, `No link was sent to ${EMAIL}. To try again, use Send set-password email on their row.`],
    ['account', 'This staff member is inactive, so they cannot be given a sign-in account.', `No link was sent to ${EMAIL}. This staff member is inactive, so they cannot be given a sign-in account.`],
    ['account', undefined, `No link was sent to ${EMAIL}. We couldn't set up a sign-in account for them.`],
  ] as const)('a %s failure (%s) is an error that says no link was sent', (reason, detail, message) => {
    expect(describeEmailOutcome(failed(reason, detail), retry)).toEqual({ tone: 'danger', message })
  })

  it('uses the retry phrase it is given, so a screen with its own Send again button says that instead', () => {
    expect(describeEmailOutcome(failed('too-many-requests'), 'use Send again').message)
      .toBe(`No link was sent to ${EMAIL}. Firebase is limiting emails for now. Wait a few minutes, then use Send again.`)
    expect(describeEmailOutcome(failed('other'), 'use Send again').message).toBe(`No link was sent to ${EMAIL}. To try again, use Send again.`)
  })

  it('never claims delivery for a failure, and never says "try again in a moment"', () => {
    for (const reason of ['account', 'too-many-requests', 'invalid-email', 'network', 'other'] as const) {
      const { message } = describeEmailOutcome(failed(reason), retry)
      expect(message).not.toMatch(/we've sent|emailed/i)
      expect(message).not.toMatch(/in a moment/i)
      expect(message).toContain(EMAIL)
    }
  })
})

describe('the three outcomes of the account step, as POST .../sign-in-account words them', () => {
  // Success, an address Firebase refuses as malformed (a 400 the admin fixes by correcting it), and anything else (a 502 that says where to turn).
  const retry = 'use Send set-password email on their row'
  const invalidAddress = "That doesn't look like a valid email address. Correct it first."
  const otherFailure = "Unable to set up the user's sign-in account. If it keeps happening, ask whoever runs the Firebase project."

  it('success: the account is made sure of and the link goes', async () => {
    sendPasswordResetEmail.mockResolvedValue(undefined)

    const outcome = await ensureAndSendSetPasswordEmail(EMAIL, async () => ({ firebaseAccount: 'created' }))

    expect(describeEmailOutcome(outcome, retry).tone).toBe('success')
  })

  it('an address Firebase refuses as invalid is told to be corrected, with no email sent and no retry that cannot work', async () => {
    const outcome = await ensureAndSendSetPasswordEmail('jane@acme', () => Promise.reject(apiError(invalidAddress)))

    expect(describeEmailOutcome(outcome, retry)).toEqual({ tone: 'danger', message: `No link was sent to jane@acme. ${invalidAddress}` })
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('any other failure says where to turn, and never promises that trying again later will help', async () => {
    const outcome = await ensureAndSendSetPasswordEmail(EMAIL, () => Promise.reject(apiError(otherFailure)))

    const { tone, message } = describeEmailOutcome(outcome, retry)
    expect(tone).toBe('danger')
    expect(message).toBe(`No link was sent to ${EMAIL}. ${otherFailure}`)
    expect(message).not.toMatch(/try again later/i)
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })
})

describe('describeTypedPassword', () => {
  it("says they can sign in now, and what to ask of them, for an account the app made", () => {
    expect(describeTypedPassword('created', 'Ann One', 'ann@example.com')).toBe(
      'Ann One can sign in now with the temporary password you set. Share it with them securely, and ask them to change it with Forgot password after they first sign in.',
    )
  })

  it("says the password was not applied, naming the address, for an account that already existed", () => {
    expect(describeTypedPassword('existing', 'Ann One', 'ann@example.com')).toBe("ann@example.com already had a sign-in account, so the password you set wasn't applied.")
  })

  it('never claims they can sign in with a password that did not reach their account', () => {
    expect(describeTypedPassword('existing', 'Ann One', 'ann@example.com')).not.toMatch(/can sign in now/)
  })
})

describe('TENANT_FIRST_USER_ACCOUNT_FAILED', () => {
  it("says the tenant exists, that the first user's account could not be set up, and where to go on", () => {
    expect(TENANT_FIRST_USER_ACCOUNT_FAILED).toBe("Tenant created, but their sign-in account couldn't be set up. Use Send set-password email in the Users tab.")
  })
})
