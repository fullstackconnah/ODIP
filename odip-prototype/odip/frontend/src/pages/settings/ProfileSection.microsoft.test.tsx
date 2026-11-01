import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import ProfileSection from './ProfileSection'

// Profile > Microsoft account: any signed-in person can link or unlink their own Microsoft account once their organisation has turned Microsoft sign-in on.

const START_URL = 'https://bunya.example.com/api/v1/auth/microsoft/start?intent=signin'
const { apiGet, apiDelete, assign, config } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiDelete: vi.fn(),
  assign: vi.fn(),
  config: { microsoft: true },
}))
vi.mock('@/api/client', async () => ({ ...(await vi.importActual<object>('@/api/client')), apiGet, apiDelete }))
vi.mock('@/api/hooks', async () => ({
  ...(await vi.importActual<object>('@/api/hooks')),
  useAuthConfig: () => ({ isPending: false, isError: false, data: { microsoft: config.microsoft, microsoftStartUrl: config.microsoft ? START_URL : null } }),
}))

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function renderProfile(role = 'Coordinator', url = '/settings?section=profile') {
  localStorage.setItem('odip_user', JSON.stringify({ role, fullName: 'Jane Smith', username: 'jane@acme.example.com', tenantName: 'Acme' }))
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <RouterProvider router={createMemoryRouter([{ path: '/settings', element: <><ProfileSection title="Profile" description="" readOnly={false} focusOnMount={false} /><Where /></> }], { initialEntries: [url] })} />
    </QueryClientProvider>,
  )
  return userEvent.setup({ delay: null })
}

const PROFILE = { firstName: 'Jane', lastName: 'Smith', email: 'jane@acme.example.com', mobile: null, managedByEmploymentHero: false }
let microsoftAccount = { orgLinked: false, accountLinked: false }
const account = (orgLinked: boolean, accountLinked: boolean) => { microsoftAccount = { orgLinked, accountLinked } }

beforeEach(() => {
  microsoftAccount = { orgLinked: false, accountLinked: false }
  apiGet.mockReset().mockImplementation(async (url: string) => (url === '/profile' ? PROFILE : microsoftAccount))
  apiDelete.mockReset().mockResolvedValue(undefined)
  assign.mockReset()
  config.microsoft = true
  localStorage.clear()
  Object.defineProperty(window, 'location', { configurable: true, value: { origin: 'https://bunya.example.com', assign, href: 'https://bunya.example.com/settings' } })
})

describe('Profile: Microsoft account', () => {
  it("is hidden when the org isn't linked, for a SuperAdmin, when viewing as someone, and when the flag is off", async () => {
    account(false, false)
    renderProfile()
    await waitFor(() => expect(apiGet).toHaveBeenCalled())
    expect(screen.queryByText('Microsoft account')).not.toBeInTheDocument()
  })

  it('is hidden for a SuperAdmin', async () => {
    account(true, false)
    renderProfile('SuperAdmin')
    expect(await screen.findByDisplayValue('Jane')).toBeInTheDocument()
    expect(screen.queryByText('Microsoft account')).not.toBeInTheDocument()
  })

  it('is hidden when viewing as someone', async () => {
    account(true, false)
    sessionStorage.setItem('odip_viewing_user', 'u2')
    renderProfile()
    expect(await screen.findByText('Jane Smith')).toBeInTheDocument()
    expect(screen.queryByText('Microsoft account')).not.toBeInTheDocument()
  })

  it('is hidden when the flag is off', async () => {
    config.microsoft = false
    account(true, false)
    renderProfile()
    expect(await screen.findByDisplayValue('Jane')).toBeInTheDocument()
    expect(screen.queryByText('Microsoft account')).not.toBeInTheDocument()
  })

  it('Link goes to intent=link-account', async () => {
    account(true, false)
    const u = renderProfile()

    await u.click(await screen.findByRole('button', { name: 'Link Microsoft account' }))

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(new URL(assign.mock.calls[0][0]).searchParams.get('intent')).toBe('link-account')
  })

  it('a 409 on unlink keeps the dialog open with the server sentence', async () => {
    account(true, true)
    apiDelete.mockRejectedValue({ response: { status: 409, data: { code: 'MicrosoftOnlySignIn', errors: ['Microsoft is your only way to sign in. Ask an admin to set up a password first.'] } } })
    const u = renderProfile()
    await u.click(await screen.findByRole('button', { name: 'Unlink' }))

    await u.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Unlink' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(await within(dialog).findByText("Microsoft is your only way to sign in, so you can't unlink it yet.")).toBeInTheDocument()
    expect(within(dialog).getByText(/Ask an admin to send you a set-password email from your page in Staff, set a password, then unlink\./)).toBeInTheDocument()
  })

  it('after unlinking, focus is on Link Microsoft account', async () => {
    account(true, true)
    const u = renderProfile()
    await u.click(await screen.findByRole('button', { name: 'Unlink' }))
    account(true, false)

    await u.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Unlink' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Link Microsoft account' })).toHaveFocus())
    expect(screen.getAllByRole('status').some(r => r.textContent === 'Microsoft account unlinked.')).toBe(true)
  })

  it('?microsoft=linked shows the success Callout even before the account answers, then strips the param', async () => {
    account(true, true)
    renderProfile('Coordinator', '/settings?section=profile&microsoft=linked')

    expect(await screen.findByText('Your Microsoft account is linked. Next time you can use Sign in with Microsoft.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/settings?section=profile'))
  })

  it('?microsoft=MicrosoftNotLinked shows the account words even though the org is now unlinked', async () => {
    account(false, false)
    renderProfile('Coordinator', '/settings?section=profile&microsoft=MicrosoftNotLinked')

    expect(await screen.findByText('Microsoft sign-in has been turned off for your organisation.')).toBeInTheDocument()
  })
})
