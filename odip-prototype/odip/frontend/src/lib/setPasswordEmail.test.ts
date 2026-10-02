import { afterEach, describe, expect, it, vi } from 'vitest'
import { canSendSetPasswordEmail, sendActionLabel, sendSetPasswordEmail } from './setPasswordEmail'

const { sendPasswordResetEmail, firebase } = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn(),
  // `auth` is null where Firebase is not configured (local dev auth). A getter, so each test can change it.
  firebase: { auth: null as object | null },
}))

vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
}))

afterEach(() => {
  firebase.auth = null
  sendPasswordResetEmail.mockReset()
})

describe('canSendSetPasswordEmail', () => {
  it('is true only where Firebase is configured, because Firebase is what sends the email', () => {
    firebase.auth = null
    expect(canSendSetPasswordEmail()).toBe(false)

    firebase.auth = { name: 'auth' }
    expect(canSendSetPasswordEmail()).toBe(true)
  })
})

describe('sendSetPasswordEmail', () => {
  it('asks Firebase to email the address a link to set a password', async () => {
    const auth = { name: 'auth' }
    firebase.auth = auth
    sendPasswordResetEmail.mockResolvedValue(undefined)

    await sendSetPasswordEmail('ann@example.com')

    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1)
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(auth, 'ann@example.com')
  })

  it('rejects, and asks Firebase for nothing, when Firebase is not configured', async () => {
    firebase.auth = null

    await expect(sendSetPasswordEmail('ann@example.com')).rejects.toThrow(/not configured/i)
    expect(sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('passes a Firebase failure on to the caller', async () => {
    firebase.auth = { name: 'auth' }
    sendPasswordResetEmail.mockRejectedValue(new Error('auth/too-many-requests'))

    await expect(sendSetPasswordEmail('ann@example.com')).rejects.toThrow('auth/too-many-requests')
  })
})

describe('sendActionLabel', () => {
  it('says "set" for someone who has never signed in: they are being given a first password', () => {
    expect(sendActionLabel(null)).toBe('Send set-password email')
  })

  it('says "reset" for anyone who has signed in: they already had one', () => {
    expect(sendActionLabel('2026-09-01T00:00:00Z')).toBe('Send password reset email')
  })

  it('reads a missing last-login (an older response without the field) as never signed in', () => {
    expect(sendActionLabel(undefined)).toBe('Send set-password email')
  })
})
