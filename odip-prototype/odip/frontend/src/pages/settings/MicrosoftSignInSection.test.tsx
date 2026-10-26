import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import MicrosoftSignInSection from './MicrosoftSignInSection'

// The Admin's page for linking the organisation's Microsoft directory. The real hooks run over a scripted API; only the auth config (the public start URL) is faked.

const START_URL = 'https://bunya.example.com/api/v1/auth/microsoft/start?intent=signin'
const { apiGet, apiPut, apiDelete, assign } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn(), assign: vi.fn() }))
vi.mock('@/api/client', async () => ({ ...(await vi.importActual<object>('@/api/client')), apiGet, apiPut, apiDelete }))
vi.mock('@/api/hooks', async () => ({
  ...(await vi.importActual<object>('@/api/hooks')),
  useAuthConfig: () => ({ isPending: false, isError: false, data: { microsoft: true, microsoftStartUrl: START_URL } }),
}))

const LINK = {
  microsoftTenantId: '8f1d2c7a-3b4e-4c5d-9e6f-0a1b2c3d4e5f',
  defaultRole: 'SupportWorker',
  linkedByName: 'Alexandra Montgomery-Fitzwilliam',
  linkedAt: '2026-10-20T01:00:00Z',
  updatedAt: '2026-10-21T02:00:00Z',
}

function stubLocation(origin = 'https://bunya.example.com') {
  Object.defineProperty(window, 'location', { configurable: true, value: { origin, assign, href: `${origin}/settings` } })
}

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function renderSection(url = '/settings?section=microsoft') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <section>
          <h2 tabIndex={-1}>Microsoft sign-in</h2>
          <MicrosoftSignInSection />
        </section>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup({ delay: null })
}

const linkGets = () => apiGet.mock.calls.filter(c => c[0] === '/auth/microsoft/link').length

beforeEach(() => {
  apiGet.mockReset().mockResolvedValue(null)
  apiPut.mockReset().mockResolvedValue(undefined)
  apiDelete.mockReset().mockResolvedValue(undefined)
  assign.mockReset()
  stubLocation()
  localStorage.clear()
})

describe('Microsoft sign-in: not linked', () => {
  it('Read only is the default, and Link goes to intent=link-tenant&defaultRole=SupportWorker after choosing Support Worker, after a fresh GET', async () => {
    const u = renderSection()
    const role = await screen.findByLabelText('New people join as')
    expect(role).toHaveValue('ReadOnly')
    await u.selectOptions(role, 'SupportWorker')
    expect(linkGets()).toBe(1)

    await u.click(screen.getByRole('button', { name: 'Link Microsoft' }))

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    const target = new URL(assign.mock.calls[0][0])
    expect(target.origin + target.pathname).toBe('https://bunya.example.com/api/v1/auth/microsoft/start')
    expect(target.searchParams.get('intent')).toBe('link-tenant')
    expect(target.searchParams.get('defaultRole')).toBe('SupportWorker')
    expect(linkGets()).toBe(2)
  })

  it('a failed preflight shows the connection Callout and does not navigate', async () => {
    const u = renderSection()
    await screen.findByLabelText('New people join as')
    apiGet.mockRejectedValue(new Error('Network Error'))

    await u.click(screen.getByRole('button', { name: 'Link Microsoft' }))

    expect(await screen.findByText("Couldn't reach Bunya Support. Check your connection and try again.")).toBeInTheDocument()
    expect(assign).not.toHaveBeenCalled()
  })

  it('on another host the Link button is replaced by the Open {host} Callout', async () => {
    stubLocation('http://192.168.4.70:8080')
    renderSection()
    await screen.findByLabelText('New people join as')

    expect(screen.queryByRole('button', { name: 'Link Microsoft' })).not.toBeInTheDocument()
    expect(screen.getByText('Link Microsoft from bunya.example.com')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open bunya.example.com' })).toHaveAttribute('href', 'https://bunya.example.com/settings?section=microsoft')
  })
})

describe('Microsoft sign-in: linked', () => {
  beforeEach(() => apiGet.mockResolvedValue(LINK))

  it('shows the directory ID, date and linker, and saves the role with expectedUpdatedAt', async () => {
    const u = renderSection()
    expect(await screen.findByText(LINK.microsoftTenantId)).toBeInTheDocument()
    expect(screen.getByText(/by Alexandra Montgomery-Fitzwilliam/)).toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Save role' })
    expect(save).toBeDisabled()

    await u.selectOptions(screen.getByLabelText('New people join as'), 'Coordinator')
    await u.click(save)

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/auth/microsoft/link', { defaultRole: 'Coordinator', expectedUpdatedAt: LINK.updatedAt }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Role saved.')
  })

  it('a 409 on save shows the server sentence', async () => {
    apiPut.mockRejectedValue({ response: { status: 409, data: { errors: ['Someone else changed this. Reload and try again.'] } } })
    const u = renderSection()
    await u.selectOptions(await screen.findByLabelText('New people join as'), 'Coordinator')

    await u.click(screen.getByRole('button', { name: 'Save role' }))

    expect(await screen.findByText(/Someone else changed this\. Reload and try again\./)).toBeInTheDocument()
  })

  it('the turn-off confirm warns about Microsoft-only people, and adds the 30-minute line only for a Microsoft session', async () => {
    const u = renderSection()
    await u.click(await screen.findByRole('button', { name: 'Turn off Microsoft sign-in' }))
    let dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/People who joined through Microsoft have no password, so they can't sign in until it's back on\./)).toBeInTheDocument()
    expect(within(dialog).queryByText(/signed out within 30 minutes/)).not.toBeInTheDocument()
    await u.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    localStorage.setItem('odip_sign_in_method', 'microsoft')
    await u.click(screen.getByRole('button', { name: 'Turn off Microsoft sign-in' }))
    dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText("You signed in with Microsoft, so you'll be signed out within 30 minutes.")).toBeInTheDocument()
  })

  it("after turning off, focus is on the section heading and 'Microsoft sign-in is off.' is announced", async () => {
    const u = renderSection()
    await u.click(await screen.findByRole('button', { name: 'Turn off Microsoft sign-in' }))
    apiGet.mockResolvedValue(null)

    await u.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Turn off' }))

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/auth/microsoft/link'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Microsoft sign-in' })).toHaveFocus())
    expect(screen.getByRole('status')).toHaveTextContent('Microsoft sign-in is off.')
  })
})

describe('Microsoft sign-in: coming back from Microsoft', () => {
  it('?microsoft=linked shows the success Callout, focuses the heading and strips the param', async () => {
    apiGet.mockResolvedValue(LINK)
    renderSection('/settings?section=microsoft&microsoft=linked')

    expect(await screen.findByText('Microsoft sign-in is on. Your team can now use Sign in with Microsoft.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Microsoft sign-in' })).toHaveFocus())
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/settings?section=microsoft'))
  })

  it('?microsoft=MicrosoftAdminOnly shows the directory-admin words', async () => {
    renderSection('/settings?section=microsoft&microsoft=MicrosoftAdminOnly')

    expect(await screen.findByText("That Microsoft account isn't an administrator of your directory.")).toBeInTheDocument()
    expect(screen.getByText(/Link with a Global, Privileged Role, Application or Cloud Application Administrator account/)).toBeInTheDocument()
  })
})
