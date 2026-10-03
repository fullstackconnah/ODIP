import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import type { PlanPricingSettingsDto } from '@/api/types'
import { settings as makeSettings } from '@/test/fixtures/planPricing'
import PlanPricingSettingsTab from './PlanPricingSettingsTab'

const { query, mutate, mutation } = vi.hoisted(() => ({
  query: { current: {} as Record<string, unknown> },
  mutate: vi.fn(),
  mutation: { isPending: false },
}))

vi.mock('@/api/hooks', () => ({
  usePlanPricingSettings: () => query.current,
  useUpdatePlanPricingSettings: () => ({ mutate, isPending: mutation.isPending }),
}))

function setUp(saved: PlanPricingSettingsDto = makeSettings()) {
  query.current = { data: saved, isLoading: false, refetch: vi.fn() }
  // useUnsavedChangesWarning needs a data router, as in the app.
  const router = createMemoryRouter([{ path: '/settings', element: <PlanPricingSettingsTab /> }], { initialEntries: ['/settings'] })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => { mutate.mockReset(); mutation.isPending = false })

describe('Plan pricing settings', () => {
  it('shows the six registration groups with their names and whether they are confirmed', () => {
    setUp(makeSettings({ registrationGroupsConfirmed: false, registrationGroupsHeld: ['0107', '0125'] }))

    expect(screen.getByText('Not confirmed')).toBeInTheDocument()
    const groups = screen.getByRole('group', { name: 'Registration groups' })
    expect(within(groups).getAllByRole('checkbox')).toHaveLength(6)
    expect(within(groups).getByRole('checkbox', { name: /0107 Daily personal activities/ })).toBeChecked()
    expect(within(groups).getByRole('checkbox', { name: /0125 Participation in community, social and civic activities/ })).toBeChecked()
    expect(within(groups).getByRole('checkbox', { name: /0136/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Confirm these groups' })).toBeEnabled()
  })

  it('confirms the groups with exactly the groups ticked, and says so', async () => {
    const user = userEvent.setup()
    setUp(makeSettings({ registrationGroupsConfirmed: false }))

    await user.click(screen.getByRole('checkbox', { name: /0108/ }))
    await user.click(screen.getByRole('checkbox', { name: /0136/ }))
    await user.click(screen.getByRole('button', { name: 'Confirm these groups' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toEqual({ registrationGroupsHeld: ['0107', '0104', '0125', '0115'], registrationGroupsConfirmed: true })
    mutate.mock.calls[0][1].onSuccess()
    expect(await screen.findByText('Registration groups confirmed.')).toBeInTheDocument()
  })

  it('confirms the groups as they are when nothing was changed and they were never confirmed', async () => {
    const user = userEvent.setup()
    setUp(makeSettings({ registrationGroupsConfirmed: false }))

    await user.click(screen.getByRole('button', { name: 'Confirm these groups' }))

    expect(mutate.mock.calls[0][0]).toEqual({ registrationGroupsHeld: ['0107', '0104', '0125', '0136', '0115', '0108'], registrationGroupsConfirmed: true })
  })

  it('has nothing to confirm once they are confirmed, until one is changed', async () => {
    const user = userEvent.setup()
    setUp(makeSettings({ registrationGroupsConfirmed: true }))

    expect(screen.getByText('Confirmed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save groups' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /0115/ }))
    expect(screen.getByRole('button', { name: 'Save groups' })).toBeEnabled()
  })

  it('says that no group at all means nothing can be priced', async () => {
    const user = userEvent.setup()
    setUp(makeSettings({ registrationGroupsHeld: ['0107'] }))

    await user.click(screen.getByRole('checkbox', { name: /0107/ }))

    expect(screen.getByRole('alert')).toHaveTextContent('With no registration group, nothing can be priced.')
  })

  it('says in one plain sentence what each crossing policy does, and changes with the choice', async () => {
    const user = userEvent.setup()
    setUp()

    expect(screen.getByText(/priced in parts, each part at its own item\. The lower, conservative reading\./)).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'B: higher of' }))
    expect(screen.getByText(/the higher-priced part applies to all of it, claimed on the day it starts\. Never across a sleepover/)).toBeInTheDocument()
  })

  it('sends only what changed, so a stale form cannot undo a setting somebody else just made', async () => {
    const user = userEvent.setup()
    setUp()

    await user.click(screen.getByRole('radio', { name: 'B: higher of' }))
    await user.click(screen.getByRole('checkbox', { name: 'Claim provider travel' }))
    fireEvent.change(screen.getByLabelText('Standard vehicle, $ a kilometre'), { target: { value: '1.05' } })
    await user.click(screen.getByRole('radio', { name: '0125 Community access' }))
    await user.click(screen.getByRole('checkbox', { name: 'Coordinator' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toEqual({ crossingPolicy: 'HigherOf', claimProviderTravel: false, travelKmRateStandard: 1.05, groupOutings: 'CommunityAccess', approverRoles: ['Admin'] })
    mutate.mock.calls[0][1].onSuccess()
    expect(await screen.findByText('Pricing settings saved.')).toBeInTheDocument()
  })

  it('holds the per-kilometre rate to $5, says so next to the field, and will not save a slipped decimal point', async () => {
    const user = userEvent.setup()
    setUp()

    fireEvent.change(screen.getByLabelText('Standard vehicle, $ a kilometre'), { target: { value: '9.9' } })

    expect(screen.getByText('The rate must be between $0 and $5 a kilometre.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(mutate).not.toHaveBeenCalled()
  })

  it('marks the rates provisional while the setting says they are 2025-26 values, and can turn that off', async () => {
    const user = userEvent.setup()
    setUp()

    const provisional = screen.getByRole('checkbox', { name: 'These rates are provisional' })
    expect(provisional).toBeChecked()
    await user.click(provisional)
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(mutate.mock.calls[0][0]).toEqual({ travelRatesProvisional: false })
  })

  it('shows short-term accommodation as it is, the new items only, with nothing to choose', () => {
    setUp()

    const section = screen.getByRole('region', { name: 'Short-term accommodation' })
    expect(section).toHaveTextContent('Planned with the new hourly support items plus accommodation nights.')
    expect(section).toHaveTextContent('The legacy per-day items end on 30 June 2027')
    expect(within(section).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(section).queryByRole('radio')).not.toBeInTheDocument()
  })

  it('needs at least one approver role', async () => {
    const user = userEvent.setup()
    setUp(makeSettings({ approverRoles: ['Admin'] }))

    await user.click(screen.getByRole('checkbox', { name: 'Admin' }))

    expect(screen.getByText('At least one role must be able to approve.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })

  it('shows the server\'s own words when a save is refused, and keeps what was entered', async () => {
    const user = userEvent.setup()
    setUp()

    await user.click(screen.getByRole('radio', { name: 'B: higher of' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    mutate.mock.calls[0][1].onError({ response: { data: { errors: ['Unknown crossing policy. Use Split or HigherOf.'] } } })

    expect(await screen.findByText('Unknown crossing policy. Use Split or HigherOf.')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'B: higher of' })).toBeChecked()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('says nothing has been saved yet when these are the defaults', () => {
    setUp(makeSettings({ isDefault: true, registrationGroupsConfirmed: false }))
    expect(screen.getByText(/Nothing has been saved yet: these are the defaults the plan builder assumes/)).toBeInTheDocument()
  })

  it('shows the group buttons as saving while a save is on its way', () => {
    mutation.isPending = true
    setUp(makeSettings({ registrationGroupsConfirmed: false }))
    expect(screen.getByRole('button', { name: 'Confirm these groups' })).toBeDisabled()
  })
})

// Design review 10: ticking a group made the footer say "Unsaved changes" beside a disabled Save settings, while the button that saves a group is a screen higher.
describe('Plan pricing settings: two ways to save, and which one has something to save', () => {
  it('says Unsaved changes to the groups beside their own button, and points there from the footer, when only a group was ticked', async () => {
    const user = userEvent.setup()
    setUp()

    await user.click(screen.getByRole('checkbox', { name: /0136/ }))

    const groupsButton = screen.getByRole('button', { name: 'Save groups' })
    expect(groupsButton).toBeEnabled()
    expect(groupsButton.parentElement).toHaveTextContent('Unsaved changes to the groups')
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()                           // the footer's own words are for the settings below
    expect(screen.getByText('The registration groups are saved with their own button, above.')).toBeInTheDocument()
  })

  it('says Unsaved changes in the footer for a setting, and not beside the groups, which have nothing to save', async () => {
    const user = userEvent.setup()
    setUp()

    await user.click(screen.getByRole('radio', { name: 'B: higher of' }))

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.queryByText('Unsaved changes to the groups')).not.toBeInTheDocument()
    expect(screen.queryByText(/saved with their own button/)).not.toBeInTheDocument()
  })

  it('says both when both have something to save, and the footer does not send anyone to the groups for what it can save itself', async () => {
    const user = userEvent.setup()
    setUp()

    await user.click(screen.getByRole('checkbox', { name: /0136/ }))
    await user.click(screen.getByRole('radio', { name: 'B: higher of' }))

    expect(screen.getByText('Unsaved changes to the groups')).toBeInTheDocument()
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    expect(screen.queryByText(/saved with their own button/)).not.toBeInTheDocument()
  })
})

describe('Plan pricing settings while they load', () => {
  it('says it is loading, and says when it could not load, with a way to try again', async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    query.current = { data: undefined, isLoading: true, refetch }
    const router = createMemoryRouter([{ path: '/settings', element: <PlanPricingSettingsTab /> }], { initialEntries: ['/settings'] })
    const { unmount } = render(<RouterProvider router={router} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading plan pricing tab')
    unmount()

    query.current = { data: undefined, isLoading: false, isError: true, refetch }
    render(<RouterProvider router={createMemoryRouter([{ path: '/settings', element: <PlanPricingSettingsTab /> }], { initialEntries: ['/settings'] })} />)
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this plan pricing tab")
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  // Review F20: a SuperAdmin with no organisation chosen is told so by the server (a 400); the tab said only that it could not load, and Try again could not fix it.
  it("shows the server's sentence when it says what to do (choose an organisation to view as), and offers no Try again for it", () => {
    query.current = { data: undefined, isLoading: false, isError: true, refetch: vi.fn(), error: { response: { status: 400, data: { success: false, errors: ['Choose an organisation to view as before using the plan pricing engine: its settings belong to one organisation.'] } } } }
    render(<RouterProvider router={createMemoryRouter([{ path: '/settings', element: <PlanPricingSettingsTab /> }], { initialEntries: ['/settings'] })} />)

    expect(screen.getByText('Choose an organisation to view as before using the plan pricing engine: its settings belong to one organisation.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument()
  })

  it('keeps the plain failure, with its Try again, for anything else that goes wrong', () => {
    query.current = { data: undefined, isLoading: false, isError: true, refetch: vi.fn(), error: { response: { status: 500, data: { message: 'Boom' } } } }
    render(<RouterProvider router={createMemoryRouter([{ path: '/settings', element: <PlanPricingSettingsTab /> }], { initialEntries: ['/settings'] })} />)

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this plan pricing tab")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})
