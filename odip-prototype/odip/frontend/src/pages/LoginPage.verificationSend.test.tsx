import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import LoginPage from './LoginPage'

// The page and the sign-in hooks here are the real ones; only Firebase and the HTTP call are replaced. The page tests mock the hooks, so on their own they cannot
// show that two refused sign-ins send ONE verification link: that depends on what the page asks of the hook and on what the hook does with it. Here the exchange
// refuses an unverified account every time, as the server does, and the links are counted where they leave: at Firebase (each one counts against its rate limit).

const { signInWithEmailAndPassword, sendEmailVerification, signOut, sendPasswordResetEmail, mockApiPostRaw } = vi.hoisted(() => ({
  signInWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  signOut: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  mockApiPostRaw: vi.fn(),
}))

vi.mock('firebase/auth', () => ({ signInWithEmailAndPassword, sendEmailVerification, signOut, sendPasswordResetEmail }))
vi.mock('@/lib/firebase', () => ({ auth: { name: 'the-auth' }, devAuthEnabled: false }))
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, apiPostRaw: mockApiPostRaw, apiGet: vi.fn() }
})

const EMAIL = 'jane.smith@acme.example.com'
const user = { email: EMAIL, getIdToken: vi.fn() }
const refusedUnverified = { response: { status: 401, data: { success: false, errors: ['x'], code: 'EmailNotVerified' } } }

const SENT = `Your email address isn't verified yet. We've sent a verification link to ${EMAIL}. Open it, then sign in again.`
const SENT_A_MOMENT_AGO = `Your email address isn't verified yet. We sent a verification link to ${EMAIL} a moment ago. Open it, then sign in again.`
const COULD_NOT_SEND = "Your email address isn't verified yet, and we couldn't send the verification link just now."

beforeEach(() => {
  user.getIdToken.mockReset().mockResolvedValue('the-id-token')
  signInWithEmailAndPassword.mockReset().mockResolvedValue({ user })
  sendEmailVerification.mockReset().mockResolvedValue(undefined)
  signOut.mockReset().mockResolvedValue(undefined)
  sendPasswordResetEmail.mockReset().mockResolvedValue(undefined)
  mockApiPostRaw.mockReset().mockRejectedValue(refusedUnverified)
  localStorage.clear()
  sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

type User = ReturnType<typeof userEvent.setup>

function renderPage(): User {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter><LoginPage /></MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup({ delay: null, advanceTimers: vi.advanceTimersByTime })
}

const pressSignIn = (u: User) => u.click(screen.getByRole('button', { name: 'Sign In' }))
const wait = (ms: number) => act(async () => { vi.advanceTimersByTime(ms) })

async function signIn(u: User) {
  await u.type(screen.getByLabelText('Email'), EMAIL)
  await u.type(screen.getByLabelText('Password'), 'a-password')
  await pressSignIn(u)
}

/** Until the nth sign-in has been refused and ended its Firebase session (the link, if one goes, goes before that). */
const untilRefused = (nth: number) => waitFor(() => expect(signOut).toHaveBeenCalledTimes(nth))

describe('LoginPage with the real sign-in: the verification link goes at most once per hold', () => {
  it('sends one link for two refused sign-ins in a row, and says the second time that one went a moment ago', async () => {
    const u = renderPage()
    await signIn(u)
    expect(await screen.findByText(SENT)).toBeInTheDocument()

    await pressSignIn(u)

    expect(await screen.findByText(SENT_A_MOMENT_AGO)).toBeInTheDocument()
    expect(mockApiPostRaw).toHaveBeenCalledTimes(2)
    expect(sendEmailVerification).toHaveBeenCalledTimes(1)
    expect(signOut).toHaveBeenCalledTimes(2)
  })

  it('sends one link however many times Sign In is pressed inside the hold, and another once the hold is over', async () => {
    const u = renderPage()
    await signIn(u)
    await untilRefused(1)

    for (const nth of [2, 3, 4]) {
      await wait(5_000)
      await pressSignIn(u)
      await untilRefused(nth)
    }
    expect(mockApiPostRaw).toHaveBeenCalledTimes(4)
    expect(sendEmailVerification).toHaveBeenCalledTimes(1)

    await wait(30_000)
    await pressSignIn(u)
    await untilRefused(5)

    expect(sendEmailVerification).toHaveBeenCalledTimes(2)
    expect(await screen.findByText(SENT)).toBeInTheDocument()
  })

  it('does not try again inside the hold after a send that failed, and does not claim a link went', async () => {
    sendEmailVerification.mockRejectedValue({ code: 'auth/too-many-requests' })
    const u = renderPage()
    await signIn(u)
    expect(await screen.findByText(COULD_NOT_SEND)).toBeInTheDocument()

    await pressSignIn(u)
    await untilRefused(2)

    expect(sendEmailVerification).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(COULD_NOT_SEND)).toBeInTheDocument()
    expect(screen.queryByText(/a moment ago/)).not.toBeInTheDocument()
  })

  it('counts a link sent with Send it again: a Sign In pressed right after sends no other', async () => {
    const u = renderPage()
    await signIn(u)
    await untilRefused(1)
    await wait(31_000)
    await u.click(screen.getByRole('button', { name: 'Send it again' }))
    await waitFor(() => expect(sendEmailVerification).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(2))

    await pressSignIn(u)
    await untilRefused(3)

    expect(await screen.findByText(SENT_A_MOMENT_AGO)).toBeInTheDocument()
    expect(sendEmailVerification).toHaveBeenCalledTimes(2)
  })

  it('sends a link for a different address straight away, whatever was sent to the last', async () => {
    const u = renderPage()
    await signIn(u)
    await untilRefused(1)

    await u.clear(screen.getByLabelText('Email'))
    await u.type(screen.getByLabelText('Email'), 'someone.else@acme.example.com')
    await pressSignIn(u)
    await untilRefused(2)

    expect(sendEmailVerification).toHaveBeenCalledTimes(2)
  })
})
