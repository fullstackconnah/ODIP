import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LoginPage from './LoginPage'

// The page and the sign-in hooks are the real ones; only Firebase and the HTTP call are replaced. Two-step verification: the "Verify it's you" step after
// the password, and the set-up step a refused sign-in leads to.

const m = vi.hoisted(() => ({
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  getMultiFactorResolver: vi.fn(),
  multiFactor: vi.fn(),
  assertionForSignIn: vi.fn(),
  assertionForEnrollment: vi.fn(),
  generateSecret: vi.fn(),
  apiPostRaw: vi.fn(),
  auth: { name: 'the-auth', currentUser: null as unknown },
}))

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: m.signInWithEmailAndPassword,
  signOut: m.signOut,
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  getMultiFactorResolver: m.getMultiFactorResolver,
  multiFactor: m.multiFactor,
  TotpMultiFactorGenerator: { FACTOR_ID: 'totp', assertionForSignIn: m.assertionForSignIn, assertionForEnrollment: m.assertionForEnrollment, generateSecret: m.generateSecret },
}))
vi.mock('@/lib/firebase', () => ({ auth: m.auth, devAuthEnabled: false }))
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  const apiClient = Object.assign(Object.create(actual.apiClient), { get: vi.fn().mockResolvedValue({ data: { data: { microsoft: false, microsoftStartUrl: null } } }) })
  return { ...actual, apiClient, apiPostRaw: m.apiPostRaw, apiGet: vi.fn() }
})

const EMAIL = 'jane.smith@acme.example.com'
const session = { success: true, data: { id: 'u1', token: 't', expiresAt: '2099-01-01T00:00:00Z', username: 'jane', fullName: 'Jane Smith', role: 'Admin', tenantName: 'Acme', tenantId: 'x' } }
const refused = (code: string) => ({ response: { status: 401, data: { success: false, errors: ['x'], code } } })
const resolveSignIn = vi.fn()
const enroll = vi.fn()
const user = { email: EMAIL, getIdToken: vi.fn() }
const enrolled: unknown[] = []

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  m.auth.currentUser = null
  enrolled.length = 0
  user.getIdToken.mockReset().mockResolvedValue('the-id-token')
  m.signInWithEmailAndPassword.mockReset().mockResolvedValue({ user })
  m.signOut.mockReset().mockResolvedValue(undefined)
  m.apiPostRaw.mockReset().mockResolvedValue(session)
  m.getMultiFactorResolver.mockReset().mockReturnValue({ hints: [{ factorId: 'totp', uid: 'hint-1' }], resolveSignIn })
  resolveSignIn.mockReset().mockResolvedValue({ user })
  m.assertionForSignIn.mockReset().mockReturnValue('assertion')
  m.assertionForEnrollment.mockReset().mockReturnValue('enrol-assertion')
  enroll.mockReset().mockResolvedValue(undefined)
  m.multiFactor.mockReset().mockImplementation(() => ({ enrolledFactors: enrolled, getSession: async () => 'session', enroll }))
  m.generateSecret.mockReset().mockResolvedValue({
    secretKey: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
    generateQrCodeUrl: () => `otpauth://totp/Bunya%20Support:${EMAIL}?secret=ABCD`,
    enrollmentCompletionDeadline: new Date(Date.now() + 600_000).toISOString(),
  })
})

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes><Route path="/" element={<LoginPage />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

async function signInToVerify(u: ReturnType<typeof renderPage>) {
  m.signInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/multi-factor-auth-required' })
  await u.type(await screen.findByLabelText('Email'), EMAIL)
  await u.type(screen.getByLabelText('Password'), 'pw-for-tests')
  await u.click(screen.getByRole('button', { name: 'Sign in' }))
  return screen.findByRole('heading', { name: "Verify it's you" })
}

describe("LoginPage: Verify it's you", () => {
  it('shows the step with focus on Code, and Verify waits for 6 digits', async () => {
    const u = renderPage()
    await signInToVerify(u)

    expect(screen.getByText('Enter the 6-digit code from your authenticator app.')).toBeInTheDocument()
    expect(screen.getByLabelText('Code')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled()
    await u.type(screen.getByLabelText('Code'), '123 45')
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled()
    await u.type(screen.getByLabelText('Code'), '6')
    expect(screen.getByRole('button', { name: 'Verify' })).toBeEnabled()
  })

  it('resolves the sign-in with the code, then exchanges, and clears the held password', async () => {
    const u = renderPage()
    await signInToVerify(u)
    await u.type(screen.getByLabelText('Code'), '123456')
    await u.click(screen.getByRole('button', { name: 'Verify' }))

    await waitFor(() => expect(m.apiPostRaw).toHaveBeenCalledWith('/auth/exchange', { idToken: 'the-id-token' }))
    expect(m.assertionForSignIn).toHaveBeenCalledWith('hint-1', '123456')
    expect(resolveSignIn).toHaveBeenCalledWith('assertion')
    expect(resolveSignIn.mock.invocationCallOrder[0]).toBeLessThan(m.apiPostRaw.mock.invocationCallOrder[0])
    // The route is the same after the sign-in, so the page stays mounted here: the password must be gone from it.
    expect(await screen.findByLabelText('Password')).toHaveValue('')
  })

  it.each([
    ['auth/invalid-verification-code', "That code didn't work. Enter the newest code from your app."],
    ['auth/network-request-failed', 'Network error. Check your connection and try again.'],
  ])('says %s in a sentence, announced once', async (code, sentence) => {
    resolveSignIn.mockRejectedValue({ code })
    const u = renderPage()
    await signInToVerify(u)
    await u.type(screen.getByLabelText('Code'), '123456')
    await u.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText(sentence)).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    if (code === 'auth/invalid-verification-code') {
      expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByLabelText('Code')).toHaveFocus()
    }
  })

  it('holds Verify after too many tries but leaves Back', async () => {
    resolveSignIn.mockRejectedValue({ code: 'auth/too-many-requests' })
    const u = renderPage()
    await signInToVerify(u)
    await u.type(screen.getByLabelText('Code'), '123456')
    await u.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText('Too many tries. Wait a few minutes, then sign in again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled()
  })

  it('offers Sign in again when the sign-in timed out, and that returns to the password', async () => {
    resolveSignIn.mockRejectedValue({ code: 'auth/invalid-multi-factor-session' })
    const u = renderPage()
    await signInToVerify(u)
    await u.type(screen.getByLabelText('Code'), '123456')
    await u.click(screen.getByRole('button', { name: 'Verify' }))

    expect(await screen.findByText('This sign-in timed out. Sign in again.')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
  })

  it('says the method is not supported when the account has no authenticator-app factor', async () => {
    m.getMultiFactorResolver.mockReturnValue({ hints: [{ factorId: 'phone', uid: 'p' }], resolveSignIn })
    const u = renderPage()
    await signInToVerify(u)

    expect(screen.getByText("This account's verification method isn't supported here. Ask your administrator to reset two-step verification.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
  })

  it('Back signs out, keeps the email and drops the password', async () => {
    const u = renderPage()
    await signInToVerify(u)
    await u.click(screen.getByRole('button', { name: 'Back' }))

    expect(m.signOut).toHaveBeenCalled()
    expect(await screen.findByLabelText('Email')).toHaveValue(EMAIL)
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('shows the password step and exchanges nothing when Firebase still holds a user but there is no session', async () => {
    m.auth.currentUser = { email: EMAIL, getIdToken: user.getIdToken }
    renderPage()

    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: "Verify it's you" })).not.toBeInTheDocument()
    expect(m.apiPostRaw).not.toHaveBeenCalled()
    expect(user.getIdToken).not.toHaveBeenCalled()
  })
})

describe('LoginPage: the exchange asks for two-step verification', () => {
  async function signInToEnrol(u: ReturnType<typeof renderPage>) {
    m.apiPostRaw.mockRejectedValueOnce(refused('MfaEnrolmentRequired'))
    await u.type(await screen.findByLabelText('Email'), EMAIL)
    await u.type(screen.getByLabelText('Password'), 'pw-for-tests')
    await u.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  it('does not sign out, and shows the set-up step', async () => {
    const u = renderPage()
    await signInToEnrol(u)

    expect(await screen.findByRole('heading', { name: 'Set up two-step verification' })).toBeInTheDocument()
    expect(screen.getByText('Your role needs a code from an authenticator app when you sign in. It takes about a minute.')).toBeInTheDocument()
    expect(m.signOut).not.toHaveBeenCalled()
  })

  it('signs out and asks to sign in again when the account already has a factor', async () => {
    enrolled.push({ uid: 'f1' })
    const u = renderPage()
    await signInToEnrol(u)

    expect(await screen.findByText('Sign in again to finish.')).toBeInTheDocument()
    expect(m.signOut).toHaveBeenCalled()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  it('signs in once the factor is added and the exchange accepts', async () => {
    const u = renderPage()
    await signInToEnrol(u)
    await u.type(await screen.findByLabelText('Code'), '123456')
    await u.click(screen.getByRole('button', { name: 'Turn on and sign in' }))

    await waitFor(() => expect(enroll).toHaveBeenCalledWith('enrol-assertion', 'Authenticator app'))
    expect(user.getIdToken).toHaveBeenLastCalledWith(true)
    await waitFor(() => expect(m.apiPostRaw).toHaveBeenCalledTimes(2))
    expect(await screen.findByLabelText('Password')).toHaveValue('')
  })

  it('signs in again when the exchange still refuses, and lands on Verify with the set-up line', async () => {
    const u = renderPage()
    await signInToEnrol(u)
    m.apiPostRaw.mockRejectedValueOnce(refused('MfaEnrolmentRequired'))
    m.signInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/multi-factor-auth-required' })
    await u.type(await screen.findByLabelText('Code'), '123456')
    await u.click(screen.getByRole('button', { name: 'Turn on and sign in' }))

    expect(await screen.findByRole('heading', { name: "Verify it's you" })).toBeInTheDocument()
    expect(screen.getByText("You're set up. Enter the newest code from your app to finish signing in.")).toBeInTheDocument()
    expect(m.signInWithEmailAndPassword).toHaveBeenLastCalledWith(m.auth, EMAIL, 'pw-for-tests')
  })

  it('Cancel signs out and returns to the password step', async () => {
    const u = renderPage()
    await signInToEnrol(u)
    await u.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(m.signOut).toHaveBeenCalled()
    expect(await screen.findByLabelText('Password')).toHaveValue('')
  })
})
