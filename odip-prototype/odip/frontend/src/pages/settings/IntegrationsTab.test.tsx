import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import IntegrationsTab from './IntegrationsTab'
import type { EmploymentHeroAttentionDto, EmploymentHeroEmployeeDto, EmploymentHeroStatusDto } from '@/api/types'

const { state, calls } = vi.hoisted(() => ({
  state: { status: undefined as unknown, employees: [] as unknown[], dismissError: null as unknown, dismissVariables: undefined as string | undefined, disconnectError: null as unknown },
  calls: { businesses: vi.fn(), connect: vi.fn(), sync: vi.fn(), disconnect: vi.fn(), link: vi.fn(), dismiss: vi.fn() },
}))

vi.mock('@/api/hooks', () => ({
  useEmploymentHeroStatus: () => ({ data: state.status, isLoading: false, isError: false, refetch: vi.fn() }),
  useEmploymentHeroBusinesses: () => ({ mutateAsync: calls.businesses, isPending: false }),
  useConnectEmploymentHero: () => ({ mutateAsync: calls.connect, isPending: false }),
  useSyncEmploymentHero: () => ({ mutate: calls.sync, isPending: false, error: null }),
  useDisconnectEmploymentHero: () => ({ mutate: calls.disconnect, isPending: false, error: state.disconnectError }),
  useEmploymentHeroEmployees: () => ({ data: state.employees, isLoading: false, isError: false, error: null }),
  useLinkEmploymentHeroStaff: () => ({ mutate: calls.link, isPending: false, error: null }),
  useDismissEmploymentHeroItem: () => ({ mutate: calls.dismiss, isPending: false, error: state.dismissError, variables: state.dismissVariables }),
}))

const status = (o: Partial<EmploymentHeroStatusDto> = {}): EmploymentHeroStatusDto => ({
  configured: true, connected: false, businessId: null, businessName: null, connectedAt: null, connectedByName: null,
  lastSyncAt: null, lastSyncError: null, staffLinked: 0, staffNotLinked: 0, attention: [], ...o,
})
const connected = (o: Partial<EmploymentHeroStatusDto> = {}) => status({
  connected: true, businessId: '777', businessName: 'Acme Care', connectedAt: '2026-10-13T01:00:00Z', connectedByName: 'Ada Admin',
  lastSyncAt: '2026-10-14T01:00:00Z', staffLinked: 12, staffNotLinked: 1, ...o,
})
const item = (o: Partial<EmploymentHeroAttentionDto>): EmploymentHeroAttentionDto => ({
  id: 'i1', kind: 'NotLinked', userId: 'u1', employeeId: null, name: 'Jane Smith', reason: 'No Employment Hero employee has their email.', ...o,
})
const renderTab = () => render(<MemoryRouter><IntegrationsTab /></MemoryRouter>)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  state.employees = []
  state.dismissError = null
  state.dismissVariables = undefined
  state.disconnectError = null
})

describe('IntegrationsTab — connecting', () => {
  it('says when the server has no master key, and offers no key field', () => {
    state.status = status({ configured: false })
    renderTab()
    expect(screen.getByText("Integrations aren't set up on this server yet.")).toBeInTheDocument()
    expect(screen.queryByLabelText('API key')).toBeNull()
  })

  it('finds the businesses for a pasted key, then connects with exactly that key and the chosen business', async () => {
    const user = userEvent.setup()
    state.status = status()
    calls.businesses.mockResolvedValue([{ id: '777', name: 'Acme Care' }, { id: '888', name: 'Bay Care' }])
    calls.connect.mockResolvedValue(connected())
    renderTab()

    const key = screen.getByLabelText('API key')
    expect(key).toHaveAttribute('type', 'password')
    expect(key).toHaveAttribute('autocomplete', 'new-password')
    await user.type(key, ' key-1 ')
    await user.click(screen.getByRole('button', { name: 'Find businesses' }))
    expect(calls.businesses).toHaveBeenCalledWith('key-1')
    await user.selectOptions(screen.getByLabelText('Business'), '888')
    await user.click(screen.getByRole('button', { name: 'Connect' }))

    expect(calls.connect).toHaveBeenCalledWith({ apiKey: 'key-1', businessId: '888' })
  })

  it('shows a refused key in its own words and keeps what was typed', async () => {
    const user = userEvent.setup()
    state.status = status()
    calls.businesses.mockRejectedValue({ response: { data: { errors: ["Employment Hero didn't accept the API key. Check it in Employment Hero and connect again."] } } })
    renderTab()

    await user.type(screen.getByLabelText('API key'), 'key-1')
    await user.click(screen.getByRole('button', { name: 'Find businesses' }))

    expect(await screen.findByText("Employment Hero didn't accept the API key. Check it in Employment Hero and connect again.")).toBeInTheDocument()
    expect(screen.getByLabelText('API key')).toHaveValue('key-1')
  })
})

describe('IntegrationsTab — connected', () => {
  it('shows the business, the last sync and the counts, syncs now, and disconnects only after a confirm', async () => {
    const user = userEvent.setup()
    state.status = connected({ lastSyncError: "Employment Hero is busy. ODIP tries again at the next sync." })
    renderTab()

    expect(screen.getByText('Acme Care')).toBeInTheDocument()
    expect(screen.getByText('12 staff members linked, 1 not linked')).toBeInTheDocument()
    expect(screen.getByText('Employment Hero is busy. ODIP tries again at the next sync.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    expect(calls.sync).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(calls.disconnect).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }))
    expect(calls.disconnect).toHaveBeenCalledTimes(1)
  })

  it('gives each kind of Needs-attention item its own action', async () => {
    const user = userEvent.setup()
    state.status = connected({
      attention: [
        item({ id: 'i1', kind: 'NotLinked', name: 'Jane Smith', employeeId: '301' }),
        item({ id: 'i2', kind: 'FixInEmploymentHero', userId: null, employeeId: '201', name: 'Nia Ko', reason: 'They have no email in Employment Hero, and ODIP needs one to add them.' }),
        item({ id: 'i3', kind: 'FixInOdip', userId: 'u3', name: 'Sam Lee', reason: 'Employment Hero has a new email for them.' }),
        item({ id: 'i4', kind: 'MissingFromEmploymentHero', userId: 'u4', name: 'Bo Chan', reason: "Linked, but no longer in Employment Hero's employee list." }),
      ],
    })
    state.employees = [
      { id: '301', name: 'Jane Smith', email: 'jane.smith@acme.org.au' },
      { id: '302', name: 'Jo Smith', email: null },
    ] satisfies EmploymentHeroEmployeeDto[]
    renderTab()

    const row = (name: string) => screen.getByText(name).closest('li') as HTMLElement
    expect(within(row('Nia Ko')).getByText('Fix it in Employment Hero; it clears at the next sync.')).toBeInTheDocument()
    expect(within(row('Sam Lee')).getByRole('link', { name: 'Open staff page: Sam Lee' })).toHaveAttribute('href', '/staff/u3/edit')
    await user.click(within(row('Bo Chan')).getByRole('button', { name: 'Dismiss: Bo Chan' }))
    expect(calls.dismiss).toHaveBeenCalledWith('i4')
    // Jane has a same-name suggestion, so Leave unlinked asks first: the next sync would add the EH Jane as a new staff member.
    await user.click(within(row('Jane Smith')).getByRole('button', { name: 'Leave unlinked: Jane Smith' }))
    expect(calls.dismiss).not.toHaveBeenCalledWith('i1')
    const confirm = screen.getByRole('alertdialog')
    expect(within(confirm).getByText('Jane Smith in Employment Hero will be added as a new staff member at the next sync.')).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Leave unlinked' }))
    expect(calls.dismiss).toHaveBeenCalledWith('i1')

    await user.click(within(row('Jane Smith')).getByRole('button', { name: 'Link to an Employment Hero employee: Jane Smith' }))
    const picker = screen.getByRole('dialog')
    expect(within(picker).getByLabelText('Employment Hero employee')).toHaveValue('301')   // the same-name suggestion
    await user.selectOptions(within(picker).getByLabelText('Employment Hero employee'), '302')
    await user.click(within(picker).getByRole('button', { name: 'Link' }))
    expect(calls.link).toHaveBeenCalledWith({ itemId: 'i1', employeeId: '302' }, expect.anything())
  })
})

describe('IntegrationsTab — the approved brief', () => {
  it('says what connecting does before the Connect button', async () => {
    const user = userEvent.setup()
    state.status = status()
    calls.businesses.mockResolvedValue([{ id: '777', name: 'Acme Care' }])
    renderTab()
    await user.type(screen.getByLabelText('API key'), 'key-1')
    await user.click(screen.getByRole('button', { name: 'Find businesses' }))
    expect(await screen.findByText(/adds anyone missing as a support worker \(no invite is sent\)/)).toBeInTheDocument()
    expect(screen.getByLabelText('Business')).toHaveValue('777')   // the only business is preselected
  })

  it('leaves someone with no suggestion unlinked without asking', async () => {
    const user = userEvent.setup()
    state.status = connected({ attention: [item({ id: 'i9', name: 'Kim Wu', employeeId: null })] })
    renderTab()
    await user.click(screen.getByRole('button', { name: 'Leave unlinked: Kim Wu' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(calls.dismiss).toHaveBeenCalledWith('i9')
  })

  it('groups the items by what to do, with a count on each group', () => {
    state.status = connected({
      attention: [
        item({ id: 'a', name: 'Ann Lee' }), item({ id: 'b', name: 'Bob Ng' }),
        item({ id: 'c', kind: 'MissingFromEmploymentHero', name: 'Cy Park' }),
      ],
    })
    renderTab()
    expect(screen.getByRole('heading', { name: 'Needs attention (3)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Not linked (2)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'No longer in Employment Hero (1)' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Fix in ODIP/ })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Find a person' })).toBeNull()   // 10 or fewer: no filter
  })

  it('offers a name filter above 10 items', async () => {
    const user = userEvent.setup()
    state.status = connected({ attention: Array.from({ length: 11 }, (_, i) => item({ id: `n${i}`, name: `Person ${i}` })) })
    renderTab()
    await user.type(screen.getByRole('textbox', { name: 'Find a person' }), 'Person 10')
    expect(screen.getByText('Person 10')).toBeInTheDocument()
    expect(screen.queryByText('Person 3')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Needs attention (11)' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Not linked (1)' })).toBeInTheDocument()
  })

  it('says nothing needs attention only after a sync has run', () => {
    state.status = connected({ attention: [] })
    const { unmount } = renderTab()
    expect(screen.getByText('Nothing needs attention.')).toBeInTheDocument()
    unmount()
    state.status = connected({ attention: [], lastSyncAt: null })
    renderTab()
    expect(screen.queryByText('Nothing needs attention.')).toBeNull()
    expect(screen.queryByRole('heading', { name: /Needs attention/ })).toBeNull()
  })

  it('shows a row action that failed at the top of the list, naming the person', () => {
    state.status = connected({ attention: [item({ id: 'i4', kind: 'MissingFromEmploymentHero', name: 'Bo Chan' })] })
    state.dismissError = new Error('boom')
    state.dismissVariables = 'i4'
    renderTab()
    expect(screen.getByText("Bo Chan: That couldn't be saved. Try again.")).toBeInTheDocument()
  })

  it('names the failed sync in the head badge and says nobody changed', () => {
    state.status = connected({ lastSyncError: "Employment Hero didn't accept the API key. Check it in Employment Hero and connect again." })
    renderTab()
    expect(screen.getByText('Last sync failed')).toBeInTheDocument()
    expect(screen.getByText("Nobody's details changed. ODIP tries again every 30 minutes.")).toBeInTheDocument()
  })
})

describe('IntegrationsTab — the review fixes', () => {
  it('shows a refused disconnect in its own words and keeps the dialog open until it works', async () => {
    const user = userEvent.setup()
    state.status = connected()
    state.disconnectError = { response: { data: { errors: ['A sync for this organisation is already running. Try again in a minute.'] } } }
    renderTab()
    expect(screen.getByText('A sync for this organisation is already running. Try again in a minute.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }))
    expect(calls.disconnect).toHaveBeenCalledWith(undefined, expect.objectContaining({ onSuccess: expect.any(Function) }))
    expect(calls.disconnect.mock.calls[0][1]).not.toHaveProperty('onSettled')
  })

  it('says when nobody matches the filter', async () => {
    const user = userEvent.setup()
    state.status = connected({ attention: Array.from({ length: 11 }, (_, i) => item({ id: `n${i}`, name: `Person ${i}` })) })
    renderTab()
    await user.type(screen.getByRole('textbox', { name: 'Find a person' }), 'Zed')
    expect(screen.getByText('No one matches "Zed".')).toBeInTheDocument()
  })

  it('marks an employee the sync added who never signed in, in the picker', async () => {
    const user = userEvent.setup()
    state.status = connected({ attention: [item({ id: 'i1', name: 'Jane Smith', employeeId: null })] })
    state.employees = [{ id: '302', name: 'Robert Smith', email: 'robert@acme.org.au', addedBySync: true }] satisfies EmploymentHeroEmployeeDto[]
    renderTab()
    await user.click(screen.getByRole('button', { name: 'Link to an Employment Hero employee: Jane Smith' }))
    expect(within(screen.getByRole('dialog')).getByRole('option', { name: 'Robert Smith (robert@acme.org.au) (added by sync, never signed in)' })).toBeInTheDocument()
  })
})
