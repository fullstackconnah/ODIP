import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import IntegrationsTab from './IntegrationsTab'
import type { EmploymentHeroAttentionDto, EmploymentHeroEmployeeDto, EmploymentHeroLeaveProblemDto, EmploymentHeroStatusDto } from '@/api/types'

const { state, calls } = vi.hoisted(() => ({
  state: { status: undefined as unknown, employees: [] as unknown[], dismissError: null as unknown, dismissVariables: undefined as string | undefined, disconnectError: null as unknown,
    workTypes: [{ id: '5', name: 'Ordinary' }, { id: '6', name: 'Night' }] as unknown, workTypesError: false, workTypesLoading: false, saveError: null as unknown,
    leaveCats: [{ id: '5', name: 'Annual Leave' }, { id: '7', name: 'Personal/Carer\'s Leave' }] as unknown, leaveCatsError: false, leaveCatsLoading: false, leaveSaveError: null as unknown,
    loadError: null as unknown, loadRetrying: false,
    retryError: null as unknown, retryVariables: undefined as string | undefined, retryPending: false },
  calls: { businesses: vi.fn(), connect: vi.fn(), sync: vi.fn(), disconnect: vi.fn(), link: vi.fn(), dismiss: vi.fn(), saveWorkTypes: vi.fn(), saveLeaveCats: vi.fn(), retryLeave: vi.fn() },
}))

vi.mock('@/api/hooks', () => ({
  useEmploymentHeroStatus: () => ({ data: state.status, isLoading: false, isError: false, refetch: vi.fn() }),
  useEmploymentHeroBusinesses: () => ({ mutateAsync: calls.businesses, isPending: false }),
  useConnectEmploymentHero: () => ({ mutateAsync: calls.connect, isPending: false }),
  useSyncEmploymentHero: () => ({ mutate: calls.sync, isPending: false, error: null }),
  useDisconnectEmploymentHero: () => ({ mutate: calls.disconnect, isPending: false, error: state.disconnectError }),
  useEmploymentHeroEmployees: () => ({ data: state.employees, isLoading: false, isError: false, error: null }),
  useLinkEmploymentHeroStaff: () => ({ mutate: calls.link, isPending: false, error: null }),
  useEmploymentHeroWorkTypes: () => ({ data: state.workTypesError || state.workTypesLoading ? undefined : state.workTypes, isLoading: state.workTypesLoading || state.loadRetrying, isError: state.workTypesError && !state.loadRetrying, error: state.loadRetrying ? null : state.loadError, isFetching: state.loadRetrying, errorUpdateCount: state.workTypesError ? 1 : 0, refetch: vi.fn() }),
  useSaveEmploymentHeroWorkTypes: () => ({ mutate: calls.saveWorkTypes, isPending: false, isSuccess: false, error: state.saveError }),
  useEmploymentHeroLeaveCategories: () => ({ data: state.leaveCatsError || state.leaveCatsLoading ? undefined : state.leaveCats, isLoading: state.leaveCatsLoading || state.loadRetrying, isError: state.leaveCatsError && !state.loadRetrying, error: state.loadRetrying ? null : state.loadError, isFetching: state.loadRetrying, errorUpdateCount: state.leaveCatsError ? 1 : 0, refetch: vi.fn() }),
  useSaveEmploymentHeroLeaveCategories: () => ({ mutate: calls.saveLeaveCats, isPending: false, isSuccess: false, error: state.leaveSaveError }),
  useRetryEmploymentHeroLeave: () => ({ mutate: calls.retryLeave, isPending: state.retryPending, error: state.retryError, variables: state.retryVariables }),
  useDismissEmploymentHeroItem: () => ({ mutate: calls.dismiss, isPending: false, error: state.dismissError, variables: state.dismissVariables }),
}))

const status = (o: Partial<EmploymentHeroStatusDto> = {}): EmploymentHeroStatusDto => ({
  configured: true, connected: false, businessId: null, businessName: null, connectedAt: null, connectedByName: null,
  lastSyncAt: null, lastSyncError: null, staffLinked: 0, staffNotLinked: 0, timesheetsSent: 0, timesheetsWaiting: 0,
  workTypes: { standard: null, activeNight: null, passiveNight: null, sleepover: null }, attention: [],
  leaveSent: 0, leaveWaiting: 0, leaveCategories: { annual: null, sick: null, personal: null, other: null }, leaveProblems: [], ...o,
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
  state.workTypesError = false
  state.workTypesLoading = false
  state.leaveCatsError = false
  state.leaveCatsLoading = false
  state.leaveSaveError = null
  state.loadError = null
  state.loadRetrying = false
  state.retryError = null
  state.retryVariables = undefined
  state.retryPending = false
  state.saveError = null
})

describe('IntegrationsTab — connecting', () => {
  it('says when the server has no master key, and offers no key field', () => {
    state.status = status({ configured: false })
    renderTab()
    expect(screen.getByText("Integrations aren't set up on this server yet.")).toBeInTheDocument()
    // Plain words for an Admin; the server variable to set is named only in the server's log.
    expect(screen.getByText('Contact Bunya Support.')).toBeInTheDocument()
    expect(screen.queryByText(/INTEGRATIONS_MASTER_KEY/)).toBeNull()
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
    state.status = connected({ lastSyncError: "Employment Hero is busy. We'll try again at the next sync." })
    renderTab()

    expect(screen.getByText('Acme Care')).toBeInTheDocument()
    expect(screen.getByText('12 staff members linked, 1 not linked')).toBeInTheDocument()
    expect(screen.getByText("Employment Hero is busy. We'll try again at the next sync.")).toBeInTheDocument()
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
    expect(await screen.findByText(/add anyone missing as a support worker \(no invite is sent\)/)).toBeInTheDocument()
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
    expect(screen.queryByRole('heading', { name: /Fix in Bunya Support/ })).toBeNull()
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
    expect(screen.getByText("Nobody's details changed. We try again every 30 minutes.")).toBeInTheDocument()
  })
})

describe('IntegrationsTab — the review fixes', () => {
  it('shows a refused disconnect in its own words and keeps the dialog open until it works', async () => {
    const user = userEvent.setup()
    state.status = connected()
    state.disconnectError = { response: { data: { errors: ['A sync for this organisation is already running. Try again in a minute.'] } } }
    renderTab()
    expect(screen.queryByText('A sync for this organisation is already running. Try again in a minute.')).toBeNull()   // not on the card: it belongs to the dialog that asked
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('A sync for this organisation is already running. Try again in a minute.')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }))
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
    const picker = screen.getByRole('dialog')
    expect(within(picker).getByRole('option', { name: 'Robert Smith (robert@acme.org.au) (added by sync, never signed in)' })).toBeInTheDocument()
    expect(within(picker).queryByText(/added by the sync/)).toBeNull()   // the hint shows only once that employee is chosen
    await user.selectOptions(within(picker).getByLabelText('Employment Hero employee'), '302')
    expect(within(picker).getByText("The sync added Robert Smith as a new staff member, and they have never signed in. Linking gives this record to Jane Smith and archives that account.")).toBeInTheDocument()
  })
})

describe('IntegrationsTab — timesheets and work types', () => {
  it('counts the timesheets and links to the Payroll page', () => {
    state.status = connected({ timesheetsSent: 1284, timesheetsWaiting: 3 })
    renderTab()
    expect(screen.getByText(/1,284 sent, 3 waiting/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Check pay periods' })).toHaveAttribute('href', '/rostering/payroll')
  })

  it('says none are sent yet when nothing has gone', () => {
    state.status = connected()
    renderTab()
    // Timesheets and Leave both read this when nothing has gone.
    expect(screen.getAllByText(/None sent yet/)).toHaveLength(2)
  })

  it('words the work types as the shape brief does', () => {
    state.status = connected()
    renderTab()
    expect(screen.getByText('Which Employment Hero work type each kind of shift is paid as. Night shifts wait until theirs is chosen.')).toBeInTheDocument()
    expect(within(screen.getByLabelText('Day and evening shifts')).getByRole('option', { name: 'Usual pay (no work type)' })).toBeInTheDocument()
  })

  it("reads the work types with the brief's words while loading", () => {
    state.status = connected()
    state.workTypesLoading = true
    renderTab()
    expect(screen.getByText("Reading Employment Hero's work types…")).toBeInTheDocument()
  })

  it('saves exactly the chosen ids, and only once something changed', async () => {
    const user = userEvent.setup()
    state.status = connected({ workTypes: { standard: '5', activeNight: null, passiveNight: null, sleepover: null } })
    renderTab()
    const save = screen.getByRole('button', { name: 'Save work types' })
    expect(save).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Active nights'), '6')
    expect(save).toBeEnabled()
    await user.click(save)
    expect(calls.saveWorkTypes).toHaveBeenCalledWith(
      { standard: '5', activeNight: '6', passiveNight: null, sleepover: null }, expect.anything(),
    )
  })

  it('flags a saved work type that Employment Hero no longer lists', () => {
    state.status = connected({ workTypes: { standard: '99', activeNight: null, passiveNight: null, sleepover: null } })
    renderTab()
    expect(screen.getByRole('option', { name: 'Not in Employment Hero any more' })).toBeInTheDocument()
    expect(screen.getByText('Pick again.')).toBeInTheDocument()
  })

  it('shows the refusal and keeps the choices when the save fails', () => {
    state.status = connected()
    state.saveError = new Error("boom")
    renderTab()
    expect(screen.getByText("The work types couldn't be saved. Try again.")).toBeInTheDocument()
  })

  it("keeps the server's words and a disabled Trying… button while the work types retry", () => {
    state.status = connected()
    state.workTypesError = true
    state.loadError = { response: { data: { message: 'Employment Hero is not answering.' } } }
    const { rerender } = renderTab()
    expect(screen.getByText('Employment Hero is not answering.')).toBeInTheDocument()
    state.loadRetrying = true
    rerender(<MemoryRouter><IntegrationsTab /></MemoryRouter>)
    expect(screen.getByText('Employment Hero is not answering.')).toBeInTheDocument()
    expect(screen.queryByText("Employment Hero's work types couldn't be loaded.")).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Trying…' })
    expect(button).toBeDisabled()
  })

  it('offers a retry when the work types cannot be loaded', () => {
    state.status = connected()
    state.workTypesError = true
    renderTab()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

const problem = (o: Partial<EmploymentHeroLeaveProblemDto> = {}): EmploymentHeroLeaveProblemDto => ({
  id: 'r1', leaveId: 'l1', name: 'Sam Lee', leaveType: 'Annual', startDate: '2026-11-03', endDate: '2026-11-05',
  cancelling: false, waiting: false, reason: 'Employment Hero refused it: Overlaps existing leave. ', ...o,
})

describe('IntegrationsTab — leave', () => {
  it('counts the leave sent and waiting, and says none when nothing has gone', () => {
    state.status = connected({ leaveSent: 12, leaveWaiting: 1 })
    renderTab()
    expect(screen.getByText('12 sent, 1 waiting')).toBeInTheDocument()
    cleanup()
    state.status = connected({ leaveSent: 12 })
    renderTab()
    expect(screen.getByText('12 sent')).toBeInTheDocument()
    cleanup()
    state.status = connected()
    renderTab()
    expect(screen.getAllByText(/None sent yet/)).toHaveLength(2)
  })

  it('has no Leave fact, categories or problems when not connected', () => {
    state.status = status({ connected: false })
    renderTab()
    expect(screen.queryByText('Leave categories')).not.toBeInTheDocument()
    expect(screen.queryByText(/Leave not sent/)).not.toBeInTheDocument()
  })

  it('words the leave categories as the shape brief does', () => {
    state.status = connected()
    renderTab()
    expect(screen.getByText(/A change applies to leave not yet sent\.$/)).toBeInTheDocument()
    for (const label of ['Annual leave', 'Sick leave', 'Personal leave', 'Other leave']) {
      expect(within(screen.getByLabelText(label)).getByRole('option', { name: 'Not chosen' })).toBeInTheDocument()
    }
  })

  it('reads the leave categories with the brief\'s words while loading', () => {
    state.status = connected()
    state.leaveCatsLoading = true
    renderTab()
    expect(screen.getByText("Reading Employment Hero's leave categories…")).toBeInTheDocument()
  })

  it('saves all four chosen ids, and only once something changed', async () => {
    const user = userEvent.setup()
    state.status = connected({ leaveCategories: { annual: '5', sick: null, personal: null, other: null } })
    renderTab()
    const save = screen.getByRole('button', { name: 'Save leave categories' })
    expect(save).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Personal leave'), '7')
    await user.click(save)
    expect(calls.saveLeaveCats).toHaveBeenCalledWith({ annual: '5', sick: null, personal: '7', other: null }, expect.anything())
  })

  it('flags a saved leave category that Employment Hero no longer lists', () => {
    state.status = connected({ leaveCategories: { annual: '99', sick: null, personal: null, other: null } })
    renderTab()
    expect(screen.getByRole('option', { name: 'Not in Employment Hero any more' })).toBeInTheDocument()
    expect(screen.getByText('Pick again.')).toBeInTheDocument()
  })

  it('shows the refusal and keeps every chosen value when the save fails', async () => {
    const user = userEvent.setup()
    state.status = connected({ leaveCategories: { annual: '5', sick: null, personal: null, other: null } })
    state.leaveSaveError = new Error('boom')
    renderTab()
    await user.selectOptions(screen.getByLabelText('Sick leave'), '7')
    expect(screen.getByText("The leave categories couldn't be saved. Try again.")).toBeInTheDocument()
    expect(screen.getByLabelText('Annual leave')).toHaveValue('5')
    expect(screen.getByLabelText('Sick leave')).toHaveValue('7')
  })

  it('keeps the error and offers Try again when the leave categories cannot be loaded', () => {
    state.status = connected()
    state.leaveCatsError = true
    renderTab()
    expect(screen.getByText("Employment Hero's leave categories couldn't be loaded.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it("keeps the server's words and a disabled Trying… button while the leave categories retry", () => {
    state.status = connected()
    state.leaveCatsError = true
    state.loadError = { response: { data: { message: 'Employment Hero is not answering.' } } }
    const { rerender } = renderTab()
    expect(screen.getByText('Employment Hero is not answering.')).toBeInTheDocument()
    state.loadRetrying = true
    rerender(<MemoryRouter><IntegrationsTab /></MemoryRouter>)
    expect(screen.getByText('Employment Hero is not answering.')).toBeInTheDocument()
    expect(screen.queryByText("Employment Hero's leave categories couldn't be loaded.")).not.toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Trying…' })
    expect(button).toBeDisabled()
  })

  it('lists leave not sent, a cancellation, and Try again with a specific name', async () => {
    const user = userEvent.setup()
    state.status = connected({ leaveProblems: [problem(), problem({ id: 'r2', name: 'Ned Park', cancelling: true, reason: 'Employment Hero refused it: Already cancelled.' })] })
    renderTab()
    expect(screen.getByRole('heading', { name: 'Leave not sent (2)' })).toBeInTheDocument()
    expect(screen.getByText(/^Annual leave · 3.5 Nov 2026$/)).toBeInTheDocument()
    expect(screen.getByText(/^Cancelling annual leave · /)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Try again: Sam Lee, 3.5 Nov 2026$/ }))
    expect(calls.retryLeave).toHaveBeenCalledWith('r1', expect.anything())
  })

  it('shows a waiting item with its reason and no Try again', () => {
    state.status = connected({ leaveProblems: [problem({ waiting: true, reason: 'Staff not linked to Employment Hero' })] })
    renderTab()
    expect(screen.getByText('Staff not linked to Employment Hero')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Try again: / })).not.toBeInTheDocument()
  })

  it('says Trying… while a retry runs and shows the refusal under that item only', () => {
    state.status = connected({ leaveProblems: [problem(), problem({ id: 'r2', name: 'Ned Park' })] })
    state.retryPending = true
    state.retryVariables = 'r1'
    renderTab()
    expect(screen.getByRole('button', { name: /Try again: Sam Lee/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Try again: Sam Lee/ })).toHaveTextContent('Trying…')
    expect(screen.getByRole('button', { name: /Try again: Ned Park/ })).toBeEnabled()
    cleanup()
    state.retryPending = false
    state.retryError = new Error('boom')
    renderTab()
    expect(screen.getAllByText(/couldn't be tried again/)).toHaveLength(1)
  })

  it('has no Leave not sent block at zero', () => {
    state.status = connected()
    renderTab()
    expect(screen.queryByText(/Leave not sent/)).not.toBeInTheDocument()
  })
})
