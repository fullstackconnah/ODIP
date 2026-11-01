import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import ProfileSection from './ProfileSection'

// My account > Profile passes the viewer's role down to the two-step group: a required SuperAdmin has no administrator above them to ask.

const m = vi.hoisted(() => ({ auth: { currentUser: null as unknown, onAuthStateChanged: null as unknown } }))
vi.mock('firebase/auth', () => ({
  multiFactor: () => ({ enrolledFactors: [{ uid: 'f1', displayName: 'Authenticator app', factorId: 'totp', enrollmentTime: '2026-11-02T01:00:00.000Z' }], unenroll: vi.fn() }),
  TotpMultiFactorGenerator: { generateSecret: vi.fn() },
}))
vi.mock('@/lib/firebase', () => ({ get auth() { return m.auth } }))
vi.mock('@/api/client', () => ({ endSession: vi.fn() }))
vi.mock('@/components/auth/TwoStepSetup', () => ({ TwoStepSetup: () => <div>setup panel</div> }))
vi.mock('@/api/hooks', () => ({
  useMyProfile: () => ({ data: { firstName: 'Jane', lastName: 'Smith', email: 'jane@acme.example.com', mobile: null, managedByEmploymentHero: false }, isError: false, refetch: vi.fn() }),
  useUpdateMyProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useAuthConfig: () => ({ data: { microsoft: false, microsoftStartUrl: null, mfaRequiredForAdmins: true } }),
  useMicrosoftAccount: () => ({ data: undefined, isError: false }),
  useUnlinkMicrosoftAccount: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}))

function renderAs(role: string) {
  localStorage.setItem('odip_user', JSON.stringify({ role, fullName: 'Jane Smith', username: 'jane@acme.example.com', tenantName: 'Acme' }))
  const element = <ProfileSection title="Profile" description="Your name and phone, and your password." readOnly={false} focusOnMount={false} />
  render(<RouterProvider router={createMemoryRouter([{ path: '/settings', element }], { initialEntries: ['/settings?section=profile'] })} />)
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  const user = { email: 'jane@acme.example.com' }
  m.auth.currentUser = user
  m.auth.onAuthStateChanged = (cb: (u: unknown) => void) => { cb(user); return () => {} }
})

describe('Profile: two-step verification copy by role', () => {
  it('tells a required SuperAdmin it is required, with no one to ask', () => {
    renderAs('SuperAdmin')
    expect(screen.getByText('Required for your role.')).toBeInTheDocument()
    expect(screen.queryByText(/ask your administrator/)).not.toBeInTheDocument()
  })

  it('still sends a required Admin to their administrator', () => {
    renderAs('Admin')
    expect(screen.getByText(/ask your administrator/)).toBeInTheDocument()
  })
})
