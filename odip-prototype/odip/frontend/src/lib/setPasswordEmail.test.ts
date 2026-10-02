import { afterEach, describe, expect, it, vi } from 'vitest'
import { canSendSetPasswordEmail, sendSetPasswordEmail } from './setPasswordEmail'

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
