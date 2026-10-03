import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import LoginPage from './LoginPage'
import { SignInRefused, type SignInRefusal } from '@/lib/signInRefusal'

// A refused sign-in used to be "Login failed. Please try again." whatever the reason: an account Firebase had re-created arrives unverified and the exchange
// refuses it, and nobody could tell that from a wrong password. The exchange now says why (a code), and the page turns each code into one plain sentence and a
// next step. The refusal arrives as a SignInRefused thrown by the sign-in mutation, which has already signed out of Firebase and, for an unverified email,
// sent the verification link once.

const { mockLogin, mockResend, mockDevLogin, sendPasswordResetEmail, firebase } = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockResend: vi.fn(),
  mockDevLogin: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  firebase: { auth: {} as object | null, devAuth: false },
}))

vi.mock('@/lib/firebase', () => ({
  get auth() {
    return firebase.auth
  },
  get devAuthEnabled() {
    return firebase.devAuth
  },
}))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail }))
vi.mock('@/api/hooks', () => ({
  useLogin: () => ({ mutateAsync: mockLogin, isPending: false }),
  useResendVerification: () => ({ mutateAsync: mockResend, isPending: false }),
  useDevLogin: () => ({ mutateAsync: mockDevLogin, isPending: false }),
  useDevUsers: () => ({ data: [], isError: false, error: null }),
}))

const EMAIL = 'jane.smith@acme.example.com'

const refusal = (code: SignInRefusal['code'], retryAfterSeconds: number | null = null) => ({ code, retryAfterSeconds })

beforeEach(() => {
  firebase.auth = {}
  firebase.devAuth = false
  mockLogin.mockReset()
  mockResend.mockReset().mockResolvedValue(undefined)
  mockDevLogin.mockReset()
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

function renderPage() {
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  // No pause between keystrokes: typing an address and a password is most of what these tests do.
  return userEvent.setup({ delay: null })
}

async function signIn(u: ReturnType<typeof userEvent.setup>, password = 'a-password') {
  await u.type(screen.getByLabelText('Email'), EMAIL)
  await u.type(screen.getByLabelText('Password'), password)
  await u.click(screen.getByRole('button', { name: 'Sign In' }))
}

/** The one alert on the page: errors are announced, once. */
const alert = () => screen.findByRole('alert')

describe('LoginPage', () => {
  it('associates the Password label with the password input', () => {
    renderPage()

    const passwordInput = screen.getByLabelText('Password')
    expect(passwordInput).toHaveAttribute('id', 'login-password')
    expect(passwordInput).toHaveAttribute('type', 'password')
  })

  it('signs in and keeps the session when the exchange accepts the sign-in', async () => {
    mockLogin.mockResolvedValue({ success: true, data: { token: 'odip-token', tenantId: 'tenant-1' } })
    const u = renderPage()

    await signIn(u)

    await waitFor(() => expect(localStorage.getItem('odip_token')).toBe('odip-token'))
    expect(mockLogin).toHaveBeenCalledWith({ email: EMAIL, password: 'a-password' })
    expect(localStorage.getItem('odip_viewing_tenant')).toBe('tenant-1')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('LoginPage: a sign-in the exchange refused', () => {
  it('tells an unverified email that a verification link has been sent to it, and offers to send it again', async () => {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('EmailNotVerified'), 'sent'))
    const u = renderPage()

    await signIn(u)

    const shown = await alert()
    expect(within(shown).getByText(`Your email address isn't verified yet. We've sent a verification link to ${EMAIL}. Open it, then sign in again.`)).toBeInTheDocument()
    expect(within(shown).getByRole('button', { name: 'Send it again' })).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('does not claim the link was sent when it was not, and says to use Send it again', async () => {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('EmailNotVerified'), 'not-sent'))
    const u = renderPage()

    await signIn(u)

    const shown = await alert()
    expect(within(shown).getByText("Your email address isn't verified yet, and we couldn't send the verification link just now.")).toBeInTheDocument()
    expect(within(shown).getByText('Wait a minute, then use Send it again.')).toBeInTheDocument()
    expect(shown).not.toHaveTextContent(/we've sent/i)
  })

  it('holds Send it again for a while after any send, so it cannot be hammered, and sends again with what was typed when it is free', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockLogin.mockRejectedValue(new SignInRefused(refusal('EmailNotVerified'), 'sent'))
    const u = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    await signIn(u)
    const again = within(await alert()).getByRole('button', { name: 'Send it again' })

    // The link has only just gone, so the button waits. Held, but not `disabled`: focus stays on it for a keyboard user.
    expect(again).toHaveAttribute('aria-disabled', 'true')
    expect(again).not.toBeDisabled()
    await u.click(again)
    expect(mockResend).not.toHaveBeenCalled()

    await act(async () => { vi.advanceTimersByTime(31_000) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send it again' })).not.toHaveAttribute('aria-disabled', 'true'))
    await u.click(screen.getByRole('button', { name: 'Send it again' }))

    await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(1))
    expect(mockResend).toHaveBeenCalledWith({ email: EMAIL, password: 'a-password' })
    // The polite status is on the page before anything is said, so wait for what is said in it.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(`We've sent it again to ${EMAIL}. It can take a few minutes, so check your spam folder.`))
    // Held again: another click does nothing until the wait is over.
    await u.click(screen.getByRole('button', { name: 'Send it again' }))
    expect(mockResend).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(31_000) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send it again' })).not.toHaveAttribute('aria-disabled', 'true'))
  })

  it('does not hold the button when the first send did not go, so the person can try again at once', async () => {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('EmailNotVerified'), 'not-sent'))
    const u = renderPage()
    await signIn(u)

    const again = within(await alert()).getByRole('button', { name: 'Send it again' })

    expect(again).not.toHaveAttribute('aria-disabled', 'true')
    await u.click(again)
    await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(1))
  })

  it('says it could not send the link again, rather than nothing, when Firebase refuses', async () => {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('EmailNotVerified'), 'not-sent'))
    mockResend.mockRejectedValue({ code: 'auth/too-many-requests' })
    const u = renderPage()
    await signIn(u)

    await u.click(within(await alert()).getByRole('button', { name: 'Send it again' }))

    expect(await screen.findByText("We couldn't send it just now. Wait a few minutes, then try again.")).toBeInTheDocument()
    expect(screen.queryByText(/we've sent it again/i)).not.toBeInTheDocument()
  })

  it('tells an address with no ODIP account that it is not set up, and who to ask', async () => {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('NoOdipAccount')))
    const u = renderPage()

    await signIn(u)

    expect(within(await alert()).getByText(`${EMAIL} isn't set up in ODIP. Ask your administrator to add you.`)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send it again' })).not.toBeInTheDocument()
  })

  it('tells someone in an inactive organisation so, with the next step in its own line', async () => {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('TenantInactive')))
    const u = renderPage()

    await signIn(u)

    const shown = await alert()
    expect(within(shown).getByText("Your organisation's ODIP account is inactive.")).toBeInTheDocument()
    expect(within(shown).getByText('Ask your administrator to reactivate it.')).toBeInTheDocument()
  })

  it('tells a sign-in method that is not enabled to use email and password', async () => {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('ProviderNotAllowed')))
    const u = renderPage()

    await signIn(u)

    expect(within(await alert()).getByText("That sign-in method isn't enabled for ODIP. Use your email and password.")).toBeInTheDocument()
  })

  it('tells an address that is on more than one account only that it cannot sign in yet, and to ask an administrator to check the account', async () => {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('Ambiguous')))
    const u = renderPage()

    await signIn(u)

    const shown = await alert()
    expect(within(shown).getByText(`We can't sign you in with ${EMAIL} yet.`)).toBeInTheDocument()
    expect(within(shown).getByText('Ask your administrator to check your account.')).toBeInTheDocument()
    expect(shown).not.toHaveTextContent(/more than one/i)
  })

  it('keeps the generic refusal generic, with a way forward', async () => {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('InvalidToken')))
    const u = renderPage()

    await signIn(u)

    const shown = await alert()
    expect(within(shown).getByText("We couldn't sign you in.")).toBeInTheDocument()
    expect(within(shown).getByText('Try again. If it keeps happening, ask your administrator.')).toBeInTheDocument()
  })

  it.each([
    [600, 'Too many attempts. Try again in 10 minutes.'],
    [61, 'Too many attempts. Try again in 2 minutes.'],
    [30, 'Too many attempts. Try again in 1 minute.'],
    [null, 'Too many attempts. Try again in a few minutes.'],
  ])('tells a locked-out client how long to wait (%s seconds)', async (seconds, sentence) => {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('LockedOut', seconds)))
    const u = renderPage()

    await signIn(u)

    expect(within(await alert()).getByText(sentence)).toBeInTheDocument()
  })

  it('clears the message when the next attempt starts', async () => {
    mockLogin.mockRejectedValueOnce(new SignInRefused(refusal('NoOdipAccount'))).mockResolvedValueOnce({ success: true, data: { token: 't' } })
    const u = renderPage()
    await signIn(u)
    await alert()

    await u.click(screen.getByRole('button', { name: 'Sign In' }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})

describe('LoginPage: failures that are not the exchange refusing', () => {
  it.each(['auth/wrong-password', 'auth/user-not-found', 'auth/invalid-credential', 'auth/invalid-email'])(
    'gives one generic sentence for %s, so a wrong password and an unknown address cannot be told apart, and keeps Forgot password in reach',
    async code => {
      mockLogin.mockRejectedValue({ code })
      const u = renderPage()

      await signIn(u)

      expect(within(await alert()).getByText("That email and password don't match.")).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument()
    },
  )

  it('says too many attempts for Firebase\'s own rate limit, with no wait it does not know', async () => {
    mockLogin.mockRejectedValue({ code: 'auth/too-many-requests' })
    const u = renderPage()

    await signIn(u)

    expect(within(await alert()).getByText('Too many attempts. Try again in a few minutes.')).toBeInTheDocument()
  })

  it('says it is a network problem when the network failed', async () => {
    mockLogin.mockRejectedValue({ code: 'ERR_NETWORK', request: {} })
    const u = renderPage()

    await signIn(u)

    expect(within(await alert()).getByText('Network error. Check your connection and try again.')).toBeInTheDocument()
  })

  it('keeps the old generic line for a failure it cannot name', async () => {
    mockLogin.mockRejectedValue(new Error('something else'))
    const u = renderPage()

    await signIn(u)

    expect(within(await alert()).getByText('Login failed. Please try again.')).toBeInTheDocument()
  })
})

describe('LoginPage: Forgot password', () => {
  it('asks for the address first, and sends the reset email when it has one', async () => {
    const u = renderPage()

    await u.click(screen.getByRole('button', { name: 'Forgot password?' }))
    expect(within(await alert()).getByText('Enter your email address first, then click Forgot password')).toBeInTheDocument()

    await u.type(screen.getByLabelText('Email'), EMAIL)
    await u.click(screen.getByRole('button', { name: 'Forgot password?' }))

    await waitFor(() => expect(sendPasswordResetEmail).toHaveBeenCalledWith(firebase.auth, EMAIL))
    expect(await screen.findByText('Password reset email sent. Check your inbox.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('puts the unverified-email notice and its Send it again button away when the person turns to Forgot password instead', async () => {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('EmailNotVerified'), 'sent'))
    const u = renderPage()
    await signIn(u)
    await alert()

    await u.click(screen.getByRole('button', { name: 'Forgot password?' }))

    expect(await screen.findByText('Password reset email sent. Check your inbox.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send it again' })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('LoginPage: developer sign-in', () => {
  it('still says what went wrong for the two failures it names', async () => {
    firebase.devAuth = true
    const u = renderPage()
    mockDevLogin.mockRejectedValueOnce({ response: { status: 404 } }).mockRejectedValueOnce({ response: { status: 429 } })

    await u.click(screen.getByRole('button', { name: 'Sign in as selected user' }))
    expect(within(await alert()).getByText('Dev login failed — is DEV_AUTH_ENABLED set on the API?')).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Sign in as selected user' }))
    expect(await screen.findByText('Too many sign-in attempts. Wait a few minutes and try again.')).toBeInTheDocument()
  })
})

// The verification link goes out once per hold, however many times Sign In is pressed with an unverified account: Firebase rate-limits these, and "Send it
// again" has no lockout of its own. The page remembers the last attempt (in memory and in sessionStorage) and tells the sign-in not to send inside the hold.
describe('LoginPage: the verification link is sent at most once per hold', () => {
  const unverified = (verification: 'sent' | 'not-sent' | 'recent') => new SignInRefused(refusal('EmailNotVerified'), verification)
  const heldButton = () => screen.getByRole('button', { name: 'Send it again' })

  function renderWithTimers() {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    return userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
  }

  const signInAgain = (u: ReturnType<typeof userEvent.setup>) => u.click(screen.getByRole('button', { name: 'Sign In' }))

  it('asks the sign-in to send the first time, and not to send on a second attempt inside the hold, saying a link went a moment ago', async () => {
    mockLogin.mockRejectedValueOnce(unverified('sent')).mockRejectedValueOnce(unverified('recent'))
    const u = renderWithTimers()
    await signIn(u)
    await alert()

    await signInAgain(u)

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2))
    expect(mockLogin).toHaveBeenNthCalledWith(1, { email: EMAIL, password: 'a-password' })
    expect(mockLogin).toHaveBeenNthCalledWith(2, { email: EMAIL, password: 'a-password', sendVerification: false })
    expect(await screen.findByText(`Your email address isn't verified yet. We sent a verification link to ${EMAIL} a moment ago. Open it, then sign in again.`)).toBeInTheDocument()
  })

  it('holds Send it again for what is left of the hold, not a fresh 30 seconds, after a second attempt', async () => {
    mockLogin.mockRejectedValueOnce(unverified('sent')).mockRejectedValueOnce(unverified('recent'))
    const u = renderWithTimers()
    await signIn(u)
    await alert()
    await act(async () => { vi.advanceTimersByTime(20_000) })

    await signInAgain(u)
    await screen.findByText(/a moment ago/)

    expect(heldButton()).toHaveAttribute('aria-disabled', 'true')
    await act(async () => { vi.advanceTimersByTime(11_000) })
    await waitFor(() => expect(heldButton()).not.toHaveAttribute('aria-disabled', 'true'))
  })

  it('asks the sign-in to send again on an attempt after the hold is over', async () => {
    mockLogin.mockRejectedValue(unverified('sent'))
    const u = renderWithTimers()
    await signIn(u)
    await alert()
    await act(async () => { vi.advanceTimersByTime(31_000) })

    await signInAgain(u)

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2))
    expect(mockLogin).toHaveBeenNthCalledWith(2, { email: EMAIL, password: 'a-password' })
  })

  it('does not hold the send back for a different address', async () => {
    mockLogin.mockRejectedValue(unverified('sent'))
    const u = renderWithTimers()
    await signIn(u)
    await alert()

    await u.clear(screen.getByLabelText('Email'))
    await u.type(screen.getByLabelText('Email'), 'someone.else@acme.example.com')
    await signInAgain(u)

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2))
    expect(mockLogin).toHaveBeenNthCalledWith(2, { email: 'someone.else@acme.example.com', password: 'a-password' })
  })

  it('remembers the send across a reload of the page, so reloading and pressing Sign In again does not send another', async () => {
    mockLogin.mockRejectedValueOnce(unverified('sent')).mockRejectedValueOnce(unverified('recent'))
    const first = renderWithTimers()
    await signIn(first)
    await alert()
    cleanup()

    const second = renderWithTimers()
    await signIn(second)

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2))
    expect(mockLogin).toHaveBeenNthCalledWith(2, { email: EMAIL, password: 'a-password', sendVerification: false })
  })

  it('counts a send that failed as an attempt too, and then says truthfully that nothing went, with the button free', async () => {
    mockLogin.mockRejectedValueOnce(unverified('not-sent')).mockRejectedValueOnce(unverified('recent'))
    const u = renderWithTimers()
    await signIn(u)
    await alert()

    await signInAgain(u)

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2))
    expect(mockLogin).toHaveBeenNthCalledWith(2, { email: EMAIL, password: 'a-password', sendVerification: false })
    expect(await screen.findByText("Your email address isn't verified yet, and we couldn't send the verification link just now.")).toBeInTheDocument()
    expect(screen.queryByText(/a moment ago/)).not.toBeInTheDocument()
    expect(heldButton()).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('counts Send it again as a send: the next Sign In inside its hold does not send another', async () => {
    mockLogin.mockRejectedValueOnce(unverified('not-sent')).mockRejectedValueOnce(unverified('recent'))
    const u = renderWithTimers()
    await signIn(u)
    await alert()
    await u.click(heldButton())
    await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(1))

    await signInAgain(u)

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2))
    expect(mockLogin).toHaveBeenNthCalledWith(2, { email: EMAIL, password: 'a-password', sendVerification: false })
    expect(await screen.findByText(/a moment ago/)).toBeInTheDocument()
  })
})

// The error is a role=alert, which a screen reader reads whole whenever anything inside it changes. So what happens to "Send it again" must not change its
// text (the label stays, the button is marked busy), and the outcome of a resend goes to a polite status that was on the page first, not to a second alert.
// "Sending the verification link" gives a screen reader the progress the label used to. And while a resend is in flight Sign In waits: the resend's late
// sign-out would end the Firebase session a new sign-in had just made.
describe('LoginPage: sending the verification link again', () => {
  function pendingResend() {
    let finish: () => void = () => {}
    let fail: (reason: unknown) => void = () => {}
    mockResend.mockImplementation(() => new Promise<void>((resolve, reject) => { finish = resolve; fail = reject }))
    return { finish: () => act(async () => finish()), fail: (reason: unknown) => act(async () => fail(reason)) }
  }

  // A send that did not go leaves Send it again free to press at once.
  async function refusedUnverified() {
    mockLogin.mockRejectedValue(new SignInRefused(refusal('EmailNotVerified'), 'not-sent'))
    const u = renderPage()
    await signIn(u)
    await alert()
    return u
  }

  const sendAgain = () => screen.getByRole('button', { name: 'Send it again' })
  const signInButton = () => screen.getByRole('button', { name: 'Sign In' })

  it('keeps the text of the alert, Send it again included, as it was while the link is being sent, and marks the button busy', async () => {
    const resend = pendingResend()
    const u = await refusedUnverified()
    const shown = await alert()
    const spoken = shown.textContent
    const again = sendAgain()

    await u.click(again)

    await waitFor(() => expect(again).toHaveAttribute('aria-busy', 'true'))
    expect(within(shown).getByRole('button', { name: 'Send it again' })).toBe(again)
    expect(again).toHaveAttribute('aria-disabled', 'true')
    expect(shown.textContent).toBe(spoken)

    await resend.finish()
    await waitFor(() => expect(again).not.toHaveAttribute('aria-busy', 'true'))
    expect(shown.textContent).toBe(spoken)
  })

  it('says that it is sending and then that it went, in a polite status that is on the page before either, and shows the sentence once', async () => {
    const resend = pendingResend()
    const u = await refusedUnverified()
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    await u.click(sendAgain())
    await waitFor(() => expect(status).toHaveTextContent('Sending the verification link.'))
    await resend.finish()

    await waitFor(() => expect(status).toHaveTextContent(`We've sent it again to ${EMAIL}. It can take a few minutes, so check your spam folder.`))
    expect(status).not.toHaveTextContent('Sending')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toBe(status)
  })

  it('does not add a second alert when the resend fails: the failure is said in that polite status', async () => {
    const resend = pendingResend()
    const u = await refusedUnverified()
    const status = screen.getByRole('status')

    await u.click(sendAgain())
    await resend.fail({ code: 'auth/too-many-requests' })

    await waitFor(() => expect(status).toHaveTextContent("We couldn't send it just now. Wait a few minutes, then try again."))
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('disables Sign In while the link is being sent again, and enables it when that is over', async () => {
    const resend = pendingResend()
    const u = await refusedUnverified()
    expect(signInButton()).toBeEnabled()

    await u.click(sendAgain())

    await waitFor(() => expect(signInButton()).toBeDisabled())
    await resend.finish()
    await waitFor(() => expect(signInButton()).toBeEnabled())
  })

  it('does not start a sign-in from the keyboard or a bare submit either while the link is being sent again', async () => {
    pendingResend()
    const u = await refusedUnverified()
    await u.click(sendAgain())
    await waitFor(() => expect(signInButton()).toBeDisabled())

    await u.type(screen.getByLabelText('Password'), '{Enter}')
    fireEvent.submit(screen.getByLabelText('Password').closest('form')!)

    expect(mockLogin).toHaveBeenCalledTimes(1)
  })
})
