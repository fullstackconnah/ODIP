import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, useLocation } from 'react-router-dom'
import LoginPage from './LoginPage'

// "Sign in with Microsoft" is a plain link to the server's start URL, shown only when GET /auth/config says Microsoft is on. The card waits for that answer so the
// button cannot arrive late and push the email field out from under a typing person. A refused Microsoft sign-in returns to /login?microsoft=<code>.

const START_URL = 'https://bunya.example.com/api/v1/auth/microsoft/start?intent=signin'
const config = vi.hoisted(() => ({
  value: { isPending: false, isError: false, data: undefined } as { isPending: boolean; isError: boolean; data: { microsoft: boolean; microsoftStartUrl: string | null } | undefined },
}))

vi.mock('@/lib/firebase', () => ({ auth: {}, devAuthEnabled: false }))
vi.mock('firebase/auth', () => ({ sendPasswordResetEmail: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useLogin: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResendVerification: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDevLogin: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDevUsers: () => ({ data: [], isError: false, error: null }),
  useAuthConfig: () => config.value,
  storeSession: vi.fn(),
}))

const on = () => { config.value = { isPending: false, isError: false, data: { microsoft: true, microsoftStartUrl: START_URL } } }

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function renderAt(url = '/login') {
  render(<MemoryRouter initialEntries={[url]}><LoginPage /><Where /></MemoryRouter>)
  return userEvent.setup({ delay: null })
}

beforeEach(() => {
  localStorage.clear()
  config.value = { isPending: false, isError: false, data: { microsoft: false, microsoftStartUrl: null } }
})

describe('LoginPage: Sign in with Microsoft', () => {
  it('shows no Microsoft button when config says off or fails', () => {
    renderAt()
    expect(screen.queryByRole('link', { name: 'Sign in with Microsoft' })).not.toBeInTheDocument()
    expect(screen.queryByText('or')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('shows the plain page when config fails', () => {
    config.value = { isPending: false, isError: true, data: undefined }
    renderAt()
    expect(screen.queryByRole('link', { name: 'Sign in with Microsoft' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('the card waits for config: no email field while it is pending', () => {
    config.value = { isPending: true, isError: false, data: undefined }
    renderAt()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('the button links to microsoftStartUrl, is named Sign in with Microsoft, and follows Sign in in tab order', async () => {
    on()
    const u = renderAt()
    const link = screen.getByRole('link', { name: 'Sign in with Microsoft' })
    expect(link).toHaveAttribute('href', START_URL)
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('or')).toBeInTheDocument()

    const order: string[] = []
    for (let i = 0; i < 6; i++) {
      await u.tab()
      order.push(document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '')
    }
    expect(order.slice(order.indexOf('Sign in')).slice(0, 3)).toEqual(['Sign in', 'Sign in with Microsoft', 'Forgot password?'])
  })

  it('?microsoft=MicrosoftLinkFromAccount shows its words, announces them after mount (region empty on first render), and strips the param', async () => {
    on()
    renderAt('/login?microsoft=MicrosoftLinkFromAccount')

    const words = "You already have a Bunya Support account with this email."
    expect((await screen.findAllByText(new RegExp(words))).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Sign in with your password, then link Microsoft in Settings, Profile./).length).toBeGreaterThan(0)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/login'))
    expect(screen.getByTestId('where').textContent).toBe('/login')
    const region = document.querySelector('[aria-live="polite"]') as HTMLElement
    expect(region).toHaveTextContent(words)
    // A screen reader user also hears what to do next.
    expect(region).toHaveTextContent('Sign in with your password, then link Microsoft in Settings, Profile.')
    // On the first render, before any effect, the region is there and empty, so a screen reader sees a change when the words arrive.
    const first = renderToString(<MemoryRouter initialEntries={['/login?microsoft=MicrosoftLinkFromAccount']}><LoginPage /></MemoryRouter>)
    expect(first).toMatch(/aria-live="polite"[^>]*><\/div>/)
    // The visible Callout does not announce a second time.
    const card = screen.getByLabelText('Email').closest('form') as HTMLElement
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('MicrosoftSessionEnded shows the info words', async () => {
    on()
    renderAt('/login?microsoft=MicrosoftSessionEnded')
    expect((await screen.findAllByText(/You've been signed out./)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Microsoft sign-ins last up to 12 hours/).length).toBeGreaterThan(0)
  })

  it('SessionLengthReached shows the organisation words', async () => {
    on()
    renderAt('/login?microsoft=SessionLengthReached')
    expect((await screen.findAllByText(/You've been signed out./)).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Your organisation asks everyone to sign in again/).length).toBeGreaterThan(0)
  })

  it('shows the words even when config is still pending, once the card appears', async () => {
    config.value = { isPending: true, isError: false, data: undefined }
    const { rerender } = render(<MemoryRouter initialEntries={['/login?microsoft=MicrosoftCancelled']}><LoginPage /></MemoryRouter>)
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    on()
    rerender(<MemoryRouter initialEntries={['/login?microsoft=MicrosoftCancelled']}><LoginPage /></MemoryRouter>)
    expect((await screen.findAllByText(/Microsoft didn't finish signing you in./)).length).toBeGreaterThan(0)
  })
})
