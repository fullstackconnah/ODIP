import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TwoStepGroup } from './TwoStepGroup'

const m = vi.hoisted(() => ({
  multiFactor: vi.fn(),
  unenroll: vi.fn(),
  endSession: vi.fn(),
  auth: { currentUser: null as unknown, onAuthStateChanged: null as unknown },
}))

vi.mock('firebase/auth', () => ({
  multiFactor: m.multiFactor,
  TotpMultiFactorGenerator: { generateSecret: vi.fn() },
}))
vi.mock('@/lib/firebase', () => ({ get auth() { return m.auth } }))
vi.mock('@/api/client', () => ({ endSession: m.endSession }))
vi.mock('@/components/auth/TwoStepSetup', () => ({ TwoStepSetup: () => <div>setup panel</div> }))

const factor = { uid: 'f1', displayName: 'Authenticator app', factorId: 'totp', enrollmentTime: '2026-11-02T01:00:00.000Z' }
let factors: unknown[] = []

function signedInAs(firebaseUser: unknown) {
  m.auth.currentUser = firebaseUser
  m.auth.onAuthStateChanged = (cb: (u: unknown) => void) => { cb(firebaseUser); return () => {} }
}

beforeEach(() => {
  localStorage.clear()
  factors = []
  m.endSession.mockReset()
  m.unenroll.mockReset().mockResolvedValue(undefined)
  m.multiFactor.mockReset().mockImplementation(() => ({ get enrolledFactors() { return factors }, unenroll: m.unenroll }))
  signedInAs({ email: 'jane@acme.example.com' })
})

describe('TwoStepGroup', () => {
  it('is off for an optional role, with the button that opens set-up', async () => {
    const u = userEvent.setup()
    render(<TwoStepGroup required={false} />)

    expect(screen.getByRole('heading', { name: 'Two-step verification' })).toBeInTheDocument()
    expect(screen.getByText('Off')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Set up two-step verification' }))
    expect(screen.getByText('setup panel')).toBeInTheDocument()
  })

  it('is on once a factor exists, showing when it was added', () => {
    factors = [factor]
    render(<TwoStepGroup required={false} />)

    expect(screen.getByText('On')).toBeInTheDocument()
    expect(screen.getByText('Authenticator app')).toBeInTheDocument()
    expect(screen.getByText(/^Added /)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove two-step verification' })).toBeInTheDocument()
  })

  it('removes the factor after a confirm, then signs out', async () => {
    factors = [factor]
    const u = userEvent.setup()
    render(<TwoStepGroup required={false} />)
    await u.click(screen.getByRole('button', { name: 'Remove two-step verification' }))

    expect(screen.getByText('Remove two-step verification?')).toBeInTheDocument()
    expect(screen.getByText("You'll be signed out. Next time, you'll sign in with just your password.")).toBeInTheDocument()
    expect(m.unenroll).not.toHaveBeenCalled()
    await u.click(screen.getByRole('button', { name: 'Remove and sign out' }))

    await waitFor(() => expect(m.unenroll).toHaveBeenCalledWith('f1'))
    await waitFor(() => expect(m.endSession).toHaveBeenCalled())
  })

  it('says it could not remove, and asks to sign in again when Firebase wants a recent sign-in', async () => {
    factors = [factor]
    m.unenroll.mockRejectedValueOnce({ code: 'auth/requires-recent-login' })
    const u = userEvent.setup()
    render(<TwoStepGroup required={false} />)
    await u.click(screen.getByRole('button', { name: 'Remove two-step verification' }))
    await u.click(screen.getByRole('button', { name: 'Remove and sign out' }))

    expect(await screen.findByText('For your security, sign in again to finish removing it.')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(m.endSession).toHaveBeenCalled()
  })

  it('shows Required with Set up now for a required role without a factor', () => {
    render(<TwoStepGroup required />)

    expect(screen.getByText('Required')).toBeInTheDocument()
    expect(screen.getByText('Your role needs two-step verification.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set up now' })).toBeInTheDocument()
  })

  it('hides Remove for a required role that has a factor', () => {
    factors = [factor]
    render(<TwoStepGroup required />)

    expect(screen.queryByRole('button', { name: 'Remove two-step verification' })).not.toBeInTheDocument()
    expect(screen.getByText(/Required for your role/)).toBeInTheDocument()
  })

  it.each([
    ['a Microsoft sign-in', () => { localStorage.setItem('odip_sign_in_method', 'microsoft') }],
    ['no Firebase user (dev sign-in)', () => signedInAs(null)],
  ])('is not shown for %s', (_name, arrange) => {
    arrange()
    render(<TwoStepGroup required={false} />)

    expect(screen.queryByRole('heading', { name: 'Two-step verification' })).not.toBeInTheDocument()
  })
})
