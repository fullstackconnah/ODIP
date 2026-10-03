import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useLogin, useResendVerification } from './auth'
import { SignInRefused } from '@/lib/signInRefusal'

// The sign-in mutation signs in to Firebase, then asks the exchange for an ODIP session. When the exchange refuses, the Firebase session it came with is of no
// use, so none is left behind, and for an unverified email the verification link is sent once, automatically, before that session goes. What is thrown
// carries the refusal, so the login page can say why.

const { signInWithEmailAndPassword, sendEmailVerification, signOut, mockApiPostRaw, firebase } = vi.hoisted(() => ({
  signInWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  signOut: vi.fn(),
  mockApiPostRaw: vi.fn(),
  firebase: { auth: { name: 'the-auth' } as object | null },
}))

vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword, sendEmailVerification, signOut }))
vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
  devAuthEnabled: false,
}))
vi.mock('../client', async () => {
  const actual = await vi.importActual<typeof import('../client')>('../client')
  return { ...actual, apiPostRaw: mockApiPostRaw, apiGet: vi.fn() }
})

const user = { email: 'jane.smith@acme.example.com', getIdToken: vi.fn() }

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
}

const refusal = (code: string, extra: object = {}) => ({ response: { status: 401, data: { success: false, errors: ['x'], code }, ...extra } })

beforeEach(() => {
  firebase.auth = { name: 'the-auth' }
  user.getIdToken.mockReset().mockResolvedValue('the-id-token')
  signInWithEmailAndPassword.mockReset().mockResolvedValue({ user })
  sendEmailVerification.mockReset().mockResolvedValue(undefined)
  signOut.mockReset().mockResolvedValue(undefined)
  mockApiPostRaw.mockReset()
})

describe('useLogin', () => {
  it('signs in, exchanges the ID token and returns the session, leaving the Firebase session in place', async () => {
    mockApiPostRaw.mockResolvedValue({ success: true, data: { token: 'odip-token' } })
    const { result } = renderHook(() => useLogin(), { wrapper })

    const answer = await result.current.mutateAsync({ email: 'jane.smith@acme.example.com', password: 'a-password' })

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(firebase.auth, 'jane.smith@acme.example.com', 'a-password')
    expect(mockApiPostRaw).toHaveBeenCalledWith('/auth/exchange', { idToken: 'the-id-token' })
    expect(answer).toEqual({ success: true, data: { token: 'odip-token' } })
    expect(signOut).not.toHaveBeenCalled()
    expect(sendEmailVerification).not.toHaveBeenCalled()
  })

  it('sends the verification link once when the exchange says the email is not verified, then signs out of Firebase, and says it went', async () => {
    mockApiPostRaw.mockRejectedValue(refusal('EmailNotVerified'))
    const { result } = renderHook(() => useLogin(), { wrapper })

    const failure = await result.current.mutateAsync({ email: 'jane.smith@acme.example.com', password: 'a-password' }).catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(SignInRefused)
    expect((failure as SignInRefused).refusal).toEqual({ code: 'EmailNotVerified', retryAfterSeconds: null })
    expect((failure as SignInRefused).verification).toBe('sent')
    expect(sendEmailVerification).toHaveBeenCalledTimes(1)
    expect(sendEmailVerification).toHaveBeenCalledWith(user)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledWith(firebase.auth)
    // The link goes while the person is still signed in: signing out first would leave nobody to send it to.
    expect(sendEmailVerification.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0])
  })

  it('still signs out and still says why when the verification link cannot be sent (Firebase rate-limits them), and says it did not go', async () => {
    mockApiPostRaw.mockRejectedValue(refusal('EmailNotVerified'))
    sendEmailVerification.mockRejectedValue({ code: 'auth/too-many-requests' })
    const { result } = renderHook(() => useLogin(), { wrapper })

    const failure = await result.current.mutateAsync({ email: 'jane.smith@acme.example.com', password: 'a-password' }).catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(SignInRefused)
    expect((failure as SignInRefused).refusal.code).toBe('EmailNotVerified')
    expect((failure as SignInRefused).verification).toBe('not-sent')
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it.each(['NoOdipAccount', 'TenantInactive', 'ProviderNotAllowed', 'Ambiguous', 'InvalidToken'])(
    'throws the %s refusal and signs out of Firebase, without sending any email',
    async code => {
      mockApiPostRaw.mockRejectedValue(refusal(code))
      const { result } = renderHook(() => useLogin(), { wrapper })

      const failure = await result.current.mutateAsync({ email: 'jane.smith@acme.example.com', password: 'a-password' }).catch((err: unknown) => err)

      expect(failure).toBeInstanceOf(SignInRefused)
      expect((failure as SignInRefused).refusal.code).toBe(code)
      expect((failure as SignInRefused).verification).toBeUndefined()
      expect(sendEmailVerification).not.toHaveBeenCalled()
      expect(signOut).toHaveBeenCalledTimes(1)
    },
  )

  it('throws a 401 with no code, or one it does not know, as the generic InvalidToken', async () => {
    mockApiPostRaw.mockRejectedValue({ response: { status: 401, data: { success: false, errors: ['x'], code: 'SomethingNew' } } })
    const { result } = renderHook(() => useLogin(), { wrapper })

    const failure = await result.current.mutateAsync({ email: 'a@b.com', password: 'p' }).catch((err: unknown) => err)

    expect((failure as SignInRefused).refusal.code).toBe('InvalidToken')
  })

  it('throws a 429 as LockedOut with the wait the server gave, and signs out', async () => {
    mockApiPostRaw.mockRejectedValue({ response: { status: 429, data: { success: false, code: 'LockedOut' }, headers: { 'retry-after': '600' } } })
    const { result } = renderHook(() => useLogin(), { wrapper })

    const failure = await result.current.mutateAsync({ email: 'a@b.com', password: 'p' }).catch((err: unknown) => err)

    expect((failure as SignInRefused).refusal).toEqual({ code: 'LockedOut', retryAfterSeconds: 600 })
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('signs out and throws the original error when the exchange failed for any other reason (a network failure)', async () => {
    const offline = { code: 'ERR_NETWORK', request: {} }
    mockApiPostRaw.mockRejectedValue(offline)
    const { result } = renderHook(() => useLogin(), { wrapper })

    const failure = await result.current.mutateAsync({ email: 'a@b.com', password: 'p' }).catch((err: unknown) => err)

    expect(failure).toBe(offline)
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('throws Firebase\'s own error, and never reaches the exchange, when the email and password are wrong', async () => {
    const wrongPassword = { code: 'auth/invalid-credential' }
    signInWithEmailAndPassword.mockRejectedValue(wrongPassword)
    const { result } = renderHook(() => useLogin(), { wrapper })

    const failure = await result.current.mutateAsync({ email: 'a@b.com', password: 'wrong' }).catch((err: unknown) => err)

    expect(failure).toBe(wrongPassword)
    expect(mockApiPostRaw).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
  })
})

describe('useResendVerification', () => {
  it('signs in again with what was typed, sends the link to that user, and signs out', async () => {
    const { result } = renderHook(() => useResendVerification(), { wrapper })

    await result.current.mutateAsync({ email: 'jane.smith@acme.example.com', password: 'a-password' })

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(firebase.auth, 'jane.smith@acme.example.com', 'a-password')
    expect(sendEmailVerification).toHaveBeenCalledTimes(1)
    expect(sendEmailVerification).toHaveBeenCalledWith(user)
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(mockApiPostRaw).not.toHaveBeenCalled()
  })

  it('signs out and throws Firebase\'s error when the link cannot be sent', async () => {
    const limited = { code: 'auth/too-many-requests' }
    sendEmailVerification.mockRejectedValue(limited)
    const { result } = renderHook(() => useResendVerification(), { wrapper })

    const failure = await result.current.mutateAsync({ email: 'a@b.com', password: 'p' }).catch((err: unknown) => err)

    expect(failure).toBe(limited)
    expect(signOut).toHaveBeenCalledTimes(1)
  })
})
