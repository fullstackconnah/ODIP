import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router-dom'
import OnboardingDetailPage from './OnboardingDetailPage'
import type { ParticipantOnboardingDto } from '@/api/types/inquiries'

// The checklist page as the owner approved it on 2026-10-13: a header (name, stage badge, View record), one action bar (Begin services, Make
// active) and one list of the four derived items. Hooks are mocked at the module seam; the payloads are the API's own shapes.
const { mockUseOnboarding, mockUseParticipant, beginServices, makeActive, recordAgreement, recordExplained } = vi.hoisted(() => ({
  mockUseOnboarding: vi.fn(),
  mockUseParticipant: vi.fn(),
  beginServices: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown },
  makeActive: { mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown },
  recordAgreement: { mutate: vi.fn(), isPending: false, error: null as unknown, reset: vi.fn() },
  recordExplained: { mutate: vi.fn(), isPending: false, error: null as unknown, reset: vi.fn() },
}))
vi.mock('@/api/hooks', () => ({
  useOnboarding: mockUseOnboarding,
  useParticipant: mockUseParticipant,
  useBeginServices: () => beginServices,
  useMakeParticipantActive: () => makeActive,
  useRecordOnboardingAgreement: () => recordAgreement,
  useRecordOnboardingExplained: () => recordExplained,
}))

const open: ParticipantOnboardingDto = {
  participantId: 'p-1', isReady: false, servicesStartedAt: null, agreementSignedOn: null, noAgreementReason: null, complaintsExplainedOn: null, rightsExplainedOn: null,
  items: [
    { key: 'profile', label: 'Profile details', done: true, missing: null },
    { key: 'serviceNeeds', label: 'Service needs', done: false, missing: 'No current agreement draft with dated, priced support lines.' },
    { key: 'agreement', label: 'Signed agreement', done: false, missing: 'Record the date it was signed, or why there is no written agreement.' },
    { key: 'complaints', label: 'Told how to make a complaint', done: false, missing: 'Record the date you explained how to make a complaint.' },
    { key: 'rights', label: 'Rights explained', done: false, missing: 'Record the date you explained their rights.' },
    { key: 'funding', label: 'Funding', done: false, missing: 'No plan budget recorded.' },
  ],
}

function Arrival() {
  const { pathname, search, state } = useLocation()
  return <p>Arrived at {pathname}{search} {JSON.stringify(state)}</p>
}

function renderPage() {
  const router = createMemoryRouter([
    { path: '/onboarding/:id', element: <OnboardingDetailPage /> },
    { path: '/participants', element: <Arrival /> },
  ], { initialEntries: ['/onboarding/p-1'] })
  return render(<RouterProvider router={router} />)
}

const asRole = (role: string) => localStorage.setItem('odip_user', JSON.stringify({ role }))

beforeEach(() => {
  asRole('Coordinator')
  mockUseOnboarding.mockReturnValue({ data: open, isLoading: false, isError: false })
  mockUseParticipant.mockReturnValue({ data: { id: 'p-1', firstName: 'Jamie', lastName: 'Rivers', preferredName: null, fullName: 'Jamie Rivers', isDraft: true, isActive: false }, isLoading: false })
  for (const m of [beginServices, makeActive, recordAgreement, recordExplained]) { m.mutate.mockReset(); m.reset.mockReset(); m.error = null; m.isPending = false }
})
afterEach(() => localStorage.clear())

describe('OnboardingDetailPage: the header', () => {
  it('names the participant, says the stage and links to the record', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Jamie Rivers' })).toBeInTheDocument()
    expect(screen.getByText('Onboarding')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View record' })).toHaveAttribute('href', '/participants/p-1')
  })

  it('says "Services started" once services have begun, and shows the date in place of the Begin services button', () => {
    mockUseOnboarding.mockReturnValue({ data: { ...open, servicesStartedAt: '2026-10-10T01:00:00Z' }, isLoading: false, isError: false })
    // Begin services switches the participant on (IsActive) and keeps the draft.
    mockUseParticipant.mockReturnValue({ data: { id: 'p-1', firstName: 'Jamie', lastName: 'Rivers', fullName: 'Jamie Rivers', isDraft: true, isActive: true }, isLoading: false })
    renderPage()

    expect(screen.getAllByText(/Services started/)[0]).toBeInTheDocument()
    expect(screen.getByText('Services started 10 Oct 2026')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Begin services' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make active' })).toBeInTheDocument()
  })
})

describe('OnboardingDetailPage: the list', () => {
  it('heads the list "N of M done" and gives each item a mark, one line of what is missing, and one fix link', () => {
    renderPage()

    const list = screen.getByRole('list', { name: '1 of 6 done' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map(r => within(r).getByRole('heading').textContent)).toEqual(['Profile details', 'Service needs', 'Signed agreement', 'Told how to make a complaint', 'Rights explained', 'Funding'])
    expect(within(rows[0]).getByText('Done')).toBeInTheDocument()
    expect(within(rows[1]).getByText('To do')).toBeInTheDocument()
    expect(within(rows[1]).getByText('No current agreement draft with dated, priced support lines.')).toBeInTheDocument()
    expect(within(rows[0]).getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/participants/p-1/profile?from=onboarding')
    expect(within(rows[1]).getByRole('link', { name: 'Open agreement draft' })).toHaveAttribute('href', '/participants/p-1/agreement-draft?from=onboarding')
    expect(within(rows[2]).getByRole('button', { name: 'Record it' })).toBeInTheDocument()
    expect(within(rows[3]).getByRole('button', { name: 'Record it' })).toBeInTheDocument()
    expect(within(rows[4]).getByRole('button', { name: 'Record it' })).toBeInTheDocument()
    expect(within(rows[5]).getByRole('link', { name: 'Funding tab' })).toHaveAttribute('href', '/participants/p-1?tab=funding')
  })

  it('has nothing else: no stage card, no recommended action, no "what is still missing", no manual ticks, no intake or schedule rows', () => {
    renderPage()

    for (const gone of ['Current stage', 'Recommended next action', "What's still missing", 'Intake completed', 'Schedule review', 'Complete profile'])
      expect(screen.queryByText(gone)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /validate profile|confirm saved service needs/i })).not.toBeInTheDocument()
  })

  it('shows a read-only role the list without the action bar or the edit fixes', () => {
    asRole('ReadOnly')
    renderPage()

    expect(screen.getByRole('list', { name: '1 of 6 done' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Begin services' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make active' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Edit profile' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record it' })).not.toBeInTheDocument()
  })
})

describe('OnboardingDetailPage: Begin services and Make active', () => {
  it('Begin services confirms first, naming the open items, then posts for this participant', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Begin services' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Begin services for Jamie Rivers?' })
    expect(within(dialog).getByText('Service needs')).toBeInTheDocument()
    expect(within(dialog).getByText('Funding')).toBeInTheDocument()
    expect(within(dialog).queryByText('Profile details')).not.toBeInTheDocument()
    expect(beginServices.mutate).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Begin services' }))
    expect(beginServices.mutate).toHaveBeenCalledWith({ id: 'p-1' }, expect.anything())
  })

  it('Make active warns with the open items, and on success shows the participant on the Active tab', async () => {
    makeActive.mutate.mockImplementation((_vars, options: { onSuccess: () => void }) => options.onSuccess())
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Make active' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Make Jamie Rivers active?' })
    expect(within(dialog).getByText(/5 checklist items are still open/)).toBeInTheDocument()
    expect(within(dialog).getByText('Signed agreement')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Make active' }))

    expect(makeActive.mutate).toHaveBeenCalledWith({ id: 'p-1' }, expect.anything())
    expect(await screen.findByText(/Arrived at \/participants\?tab=active/)).toHaveTextContent('{"participantActivated":{"participantId":"p-1","name":"Jamie Rivers"}}')
  })

  it('shows the server\'s own reason when Enforce refuses', () => {
    makeActive.error = { response: { status: 400, data: { success: false, errors: ['This participant cannot be activated until their signed service agreement evidence is recorded.'] } } }
    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent('This participant cannot be activated until their signed service agreement evidence is recorded.')
  })

  it('offers no lifecycle actions for a participant who is no longer in onboarding', () => {
    mockUseParticipant.mockReturnValue({ data: { id: 'p-1', firstName: 'Jamie', lastName: 'Rivers', fullName: 'Jamie Rivers', isDraft: false, isActive: true }, isLoading: false })
    renderPage()

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Make active' })).not.toBeInTheDocument()
  })
})

describe('OnboardingDetailPage: the agreement record', () => {
  it('records a reason there is no written agreement, sending only that', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getAllByRole('button', { name: 'Record it' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Signed agreement' })
    await user.click(within(dialog).getByRole('radio', { name: 'No written agreement' }))
    await user.type(within(dialog).getByLabelText(/Reason/), 'The participant chose not to have one.')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(recordAgreement.mutate).toHaveBeenCalledWith({ noAgreementReason: 'The participant chose not to have one.' }, expect.anything())
  })

  it('records a signed date, sending only that', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getAllByRole('button', { name: 'Record it' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Signed agreement' })
    await user.type(within(dialog).getByLabelText(/Signed on/), '2026-10-02')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(recordAgreement.mutate).toHaveBeenCalledWith({ signedOn: '2026-10-02' }, expect.anything())
  })

  it('shows the server\'s field error on the field and keeps what was typed', async () => {
    recordAgreement.error = { response: { status: 400, data: { errors: { signedOn: ['The signed date cannot be in the future.'] } } } }
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getAllByRole('button', { name: 'Record it' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Signed agreement' })
    const date = within(dialog).getByLabelText(/Signed on/)
    await user.type(date, '2099-01-01')

    expect(within(dialog).getByText('The signed date cannot be in the future.')).toBeInTheDocument()
    expect(date).toHaveValue('2099-01-01')
  })
})

describe('OnboardingDetailPage: the complaints and rights record', () => {
  const openDialog = async (user: ReturnType<typeof userEvent.setup>, row: number) => {
    await user.click(screen.getAllByRole('button', { name: 'Record it' })[row])
    return screen.getByRole('dialog', { name: 'Complaints and rights' })
  }

  it('opens one dialog from either item, with Save off until a date is set', async () => {
    const user = userEvent.setup()
    renderPage()

    for (const row of [1, 2]) {
      const dialog = await openDialog(user, row)
      expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    }
    expect(recordExplained.mutate).not.toHaveBeenCalled()
  })

  it('puts focus on the date field of the row it was opened from', async () => {
    const user = userEvent.setup()
    renderPage()

    for (const [row, label] of [[1, 'Told how to make a complaint on'], [2, 'Rights explained on']] as const) {
      const dialog = await openDialog(user, row)
      expect(within(dialog).getByLabelText(label)).toHaveFocus()
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    }
  })

  it('sends one date and null for the blank one', async () => {
    const user = userEvent.setup()
    renderPage()

    const dialog = await openDialog(user, 1)
    await user.type(within(dialog).getByLabelText('Rights explained on'), '2026-10-02')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(recordExplained.mutate).toHaveBeenCalledWith({ complaintsExplainedOn: null, rightsExplainedOn: '2026-10-02' }, expect.anything())
  })

  it('prefills both dates, and clearing one sends null for it', async () => {
    mockUseOnboarding.mockReturnValue({ data: { ...open, complaintsExplainedOn: '2026-10-01', rightsExplainedOn: '2026-10-02' }, isLoading: false, isError: false })
    const user = userEvent.setup()
    renderPage()

    const dialog = await openDialog(user, 1)
    expect(within(dialog).getByLabelText('Told how to make a complaint on')).toHaveValue('2026-10-01')
    expect(within(dialog).getByLabelText('Rights explained on')).toHaveValue('2026-10-02')
    await user.clear(within(dialog).getByLabelText('Told how to make a complaint on'))
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))

    expect(recordExplained.mutate).toHaveBeenCalledWith({ complaintsExplainedOn: null, rightsExplainedOn: '2026-10-02' }, expect.anything())
  })

  it('refuses a future date and a date before 1990 on the field, without sending', async () => {
    const user = userEvent.setup()
    renderPage()

    const dialog = await openDialog(user, 1)
    const complaints = within(dialog).getByLabelText('Told how to make a complaint on')
    await user.type(complaints, '2999-01-01')
    expect(within(dialog).getByText('The date cannot be in the future.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.clear(complaints)
    await user.type(complaints, '1989-12-31')
    expect(within(dialog).getByText('Check the date: it is before 1990.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(recordExplained.mutate).not.toHaveBeenCalled()
  })

  it('shows the server\'s field error under its field', async () => {
    recordExplained.error = { response: { status: 400, data: { errors: { rightsExplainedOn: ['The date cannot be in the future.'] } } } }
    const user = userEvent.setup()
    renderPage()

    const dialog = await openDialog(user, 2)

    expect(within(dialog).getByText('The date cannot be in the future.')).toBeInTheDocument()
  })

  it('offers no Record it to a role that cannot manage the lifecycle', () => {
    asRole('ReadOnly')
    renderPage()

    expect(screen.queryByRole('button', { name: 'Record it' })).not.toBeInTheDocument()
  })
})

// NAV F5: Complete intake started from this checklist comes back here, with the notice the Onboarding table shows.
describe('OnboardingDetailPage — arrival from a completed intake', () => {
  it('confirms the completed intake once', () => {
    const router = createMemoryRouter([{ path: '/onboarding/:id', element: <OnboardingDetailPage /> }], {
      initialEntries: [{ pathname: '/onboarding/p-1', state: { intakeComplete: { participantId: 'p-1', name: 'Jamie Rivers' } } }],
    })
    render(<RouterProvider router={router} />)
    expect(screen.getByText('Intake complete — Jamie Rivers is now in onboarding.')).toBeInTheDocument()
    // Cleared from history, so a reload or a later visit does not replay it.
    expect(router.state.location.state).toBeNull()
  })

  it('shows no notice on an ordinary visit', () => {
    renderPage()
    expect(screen.queryByText(/intake complete —/i)).not.toBeInTheDocument()
  })
})

describe('OnboardingDetailPage: fix round 1', () => {
  it('clears the last refusal before a new attempt, so the callout shows the latest one (V7)', async () => {
    beginServices.error = { response: { status: 400, data: { errors: ['Begin refused.'] } } }
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Make active' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Make active' }))

    expect(beginServices.reset).toHaveBeenCalled()
    expect(makeActive.reset).toHaveBeenCalled()
    expect(beginServices.reset.mock.invocationCallOrder[0]).toBeLessThan(makeActive.mutate.mock.invocationCallOrder[0])
  })

  it('offers no fixes once the participant is no longer in onboarding: the record is read-only (V23)', () => {
    mockUseParticipant.mockReturnValue({ data: { id: 'p-1', firstName: 'Jamie', lastName: 'Rivers', fullName: 'Jamie Rivers', isDraft: false, isActive: true }, isLoading: false })
    renderPage()

    expect(screen.getByRole('list', { name: '1 of 6 done' })).toBeInTheDocument()
    for (const fix of ['Edit profile', 'Open agreement draft', 'Funding tab']) expect(screen.queryByRole('link', { name: fix })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record it' })).not.toBeInTheDocument()
  })

  it('holds both actions while either is in flight (V24)', async () => {
    beginServices.isPending = true
    const user = userEvent.setup()
    renderPage()

    const makeActiveButton = screen.getByRole('button', { name: 'Make active' })
    expect(makeActiveButton).toHaveAttribute('aria-disabled', 'true')
    await user.click(makeActiveButton)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('treats a services-started participant who was switched off as onboarding again, offering Begin services (V5)', () => {
    mockUseOnboarding.mockReturnValue({ data: { ...open, servicesStartedAt: '2026-10-10T01:00:00Z' }, isLoading: false, isError: false })
    mockUseParticipant.mockReturnValue({ data: { id: 'p-1', firstName: 'Jamie', lastName: 'Rivers', fullName: 'Jamie Rivers', isDraft: true, isActive: false }, isLoading: false })
    renderPage()

    expect(screen.getByText('Onboarding')).toBeInTheDocument()
    expect(screen.queryByText(/Services started/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Begin services' })).toBeInTheDocument()
  })
})

describe('OnboardingDetailPage: fix round 2', () => {
  it('says Begin services brings an archived participant back, when their services had started before (N4)', async () => {
    mockUseOnboarding.mockReturnValue({ data: { ...open, servicesStartedAt: '2026-10-10T01:00:00Z' }, isLoading: false, isError: false })
    mockUseParticipant.mockReturnValue({ data: { id: 'p-1', firstName: 'Jamie', lastName: 'Rivers', fullName: 'Jamie Rivers', isDraft: true, isActive: false }, isLoading: false })
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Begin services' }))

    expect(within(screen.getByRole('alertdialog')).getByText('This brings an archived participant back onto the rostering board.')).toBeInTheDocument()
  })

  it('does not say so for a first Begin services', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Begin services' }))

    expect(within(screen.getByRole('alertdialog')).queryByText(/archived participant/)).not.toBeInTheDocument()
  })
})
