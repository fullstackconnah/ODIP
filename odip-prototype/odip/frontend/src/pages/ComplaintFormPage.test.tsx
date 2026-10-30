import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import ComplaintFormPage from './ComplaintFormPage'
import { localIsoDate } from '@/lib/dateOnly'

const { mockUseComplaint, mockCreate, mockUpdate, mockUseIncidents, mockUseStaff } = vi.hoisted(() => ({
  mockUseComplaint: vi.fn(),
  mockCreate: vi.fn(),
  mockUpdate: vi.fn(),
  mockUseIncidents: vi.fn(),
  mockUseStaff: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useComplaint: mockUseComplaint,
  useCreateComplaint: () => ({ mutateAsync: mockCreate, isPending: false }),
  useUpdateComplaint: () => ({ mutateAsync: mockUpdate, isPending: false }),
  useIncidents: mockUseIncidents,
  useStaff: mockUseStaff,
}))

// The two pickers fetch their own lists; here they are plain selects so a test can choose an option and read the options on offer.
vi.mock('@/components/ParticipantPicker', () => ({
  ParticipantPicker: ({ value, onChange, allowNone, noneLabel, ...aria }: { value: string; onChange: (v: string) => void; allowNone?: boolean; noneLabel?: string }) => (
    <select aria-label="Participant picker" value={value} onChange={e => onChange(e.target.value)} {...aria}>
      {allowNone ? <option value="">{noneLabel}</option> : <option value="">Choose…</option>}
      <option value="p-1">Jo Smith</option>
      <option value="p-2">Ana Lee</option>
    </select>
  ),
}))
vi.mock('@/components/SearchableSelect', () => ({
  SearchableSelect: ({ items, value, onChange, placeholder }: { items: { value: string; label: string }[]; value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <select aria-label={placeholder} value={value} onChange={e => onChange(e.target.value)}>
      {items.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
    </select>
  ),
}))

const today = localIsoDate()

function complaint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1', receivedOn: '2026-10-05', channel: 'Phone', complainantKind: 'FamilyOrCarer', participantId: null, participantName: null,
    complainantName: 'Sam Carer', summary: 'Worker was late', status: 'Open', acknowledgedOn: null, actionsTaken: null, outcome: null,
    outcomeCommunicatedOn: null, toldAboutCommission: false, toldAboutCommissionOn: null, closedOn: null, handledByUserId: null,
    handledByName: null, incidentReportId: null, incidentReportTitle: null, openDays: 26, isActive: true,
    createdAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z', ...overrides,
  }
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/complaints/new', element: <ComplaintFormPage /> },
      { path: '/complaints/:id', element: <ComplaintFormPage /> },
      { path: '/complaints', element: <div>The list</div> },
    ],
    { initialEntries: [path] },
  )
  const result = render(<RouterProvider router={router} />)
  return { router, ...result }
}

const loaded = (data: unknown) => ({ data, isError: false, error: null, refetch: vi.fn(), isLoading: false, isFetching: false, failureCount: 0 })

describe('ComplaintFormPage', () => {
  beforeEach(() => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u-me', role: 'Admin' }))
    mockUseComplaint.mockReset().mockReturnValue(loaded(undefined))
    mockCreate.mockReset().mockResolvedValue({ success: true, data: { id: 'new-1', updatedAt: 'x' } })
    mockUpdate.mockReset().mockResolvedValue({ success: true, data: { id: 'c-1', updatedAt: 'y' } })
    mockUseIncidents.mockReset().mockReturnValue({ data: [], isLoading: false })
    mockUseStaff.mockReset().mockReturnValue({ data: [{ id: 'u-me', fullName: 'Me Myself' }] })
  })
  afterEach(() => { localStorage.clear() })

  async function fillRequired(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(screen.getByLabelText(/How it came in/), 'Phone')
    await user.type(screen.getByLabelText(/What it's about/), '  Worker was late  ')
  }

  it('creates: posts the full body with Open status, nulls for the edit-only fields, then opens the new record', async () => {
    const user = userEvent.setup()
    const { router } = renderAt('/complaints/new')
    expect(screen.getByRole('heading', { level: 1, name: 'Record a complaint' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument()
    await fillRequired(user)
    await user.selectOptions(screen.getByLabelText(/Who made the complaint/), 'FamilyOrCarer')
    await user.type(screen.getByLabelText(/Their name/), ' Sam Carer ')
    await user.click(screen.getByRole('button', { name: 'Save complaint' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      receivedOn: today, channel: 'Phone', complainantKind: 'FamilyOrCarer', participantId: null, complainantName: 'Sam Carer',
      summary: 'Worker was late', status: 'Open', acknowledgedOn: null, actionsTaken: null, outcome: null, outcomeCommunicatedOn: null,
      toldAboutCommission: false, toldAboutCommissionOn: null, closedOn: null, handledByUserId: 'u-me', incidentReportId: null,
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/complaints/new-1'))
  })

  it('Anonymous sends no name and no participant, and hides both fields', async () => {
    const user = userEvent.setup()
    renderAt('/complaints/new')
    await fillRequired(user)
    await user.selectOptions(screen.getByLabelText(/Who made the complaint/), 'FamilyOrCarer')
    await user.type(screen.getByLabelText(/Their name/), 'Sam')
    await user.selectOptions(screen.getByLabelText(/Who made the complaint/), 'Anonymous')
    expect(screen.queryByLabelText(/Their name/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Participant picker')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save complaint' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ complainantKind: 'Anonymous', participantId: null, complainantName: null })
  })

  it('a Participant complainant needs a participant and sends no typed name', async () => {
    const user = userEvent.setup()
    renderAt('/complaints/new')
    await fillRequired(user)
    await user.selectOptions(screen.getByLabelText(/Who made the complaint/), 'Participant')
    expect(screen.queryByLabelText(/Their name/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save complaint' }))
    expect(await screen.findByText('Choose the participant.')).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
    await user.selectOptions(screen.getByLabelText('Participant picker'), 'p-1')
    await user.click(screen.getByRole('button', { name: 'Save complaint' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ complainantKind: 'Participant', participantId: 'p-1', complainantName: null })
  })

  it('shows the required-field messages, makes no request, and focuses the first invalid field', async () => {
    const user = userEvent.setup()
    renderAt('/complaints/new')
    await user.click(screen.getByRole('button', { name: 'Save complaint' }))
    expect(await screen.findByText('Choose how it came in.')).toBeInTheDocument()
    expect(screen.getByText('Describe the complaint.')).toBeInTheDocument()
    expect(screen.getByText('Choose who made the complaint.')).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByLabelText(/How it came in/)).toHaveFocus())
  })

  it('rejects a future received date with the house words', async () => {
    const user = userEvent.setup()
    renderAt('/complaints/new')
    await fillRequired(user)
    await user.selectOptions(screen.getByLabelText(/Who made the complaint/), 'Staff')
    const box = screen.getByLabelText(/Received on/)
    await user.clear(box)
    await user.type(box, '2099-01-01')
    await user.click(screen.getByRole('button', { name: 'Save complaint' }))
    expect(await screen.findByText("The date can't be in the future.")).toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('ticking the Commission box asks for a date (today) and unticking clears it', async () => {
    const user = userEvent.setup()
    renderAt('/complaints/new')
    expect(screen.queryByLabelText(/Told on/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /NDIS Commission/ }))
    expect(screen.getByLabelText(/Told on/)).toHaveValue(today)
    await user.click(screen.getByRole('checkbox', { name: /NDIS Commission/ }))
    expect(screen.queryByLabelText(/Told on/)).not.toBeInTheDocument()
    await fillRequired(user)
    await user.selectOptions(screen.getByLabelText(/Who made the complaint/), 'Staff')
    await user.click(screen.getByRole('button', { name: 'Save complaint' }))
    await waitFor(() => expect(mockCreate).toHaveBeenCalled())
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ toldAboutCommission: false, toldAboutCommissionOn: null })
  })

  it('a refused save keeps every typed value and moves focus to the message (C17)', async () => {
    const user = userEvent.setup()
    mockCreate.mockRejectedValue({ response: { status: 400, data: { errors: ['The linked incident is not in your organisation.'] } } })
    renderAt('/complaints/new')
    await fillRequired(user)
    await user.selectOptions(screen.getByLabelText(/Who made the complaint/), 'Staff')
    await user.click(screen.getByRole('button', { name: 'Save complaint' }))
    const message = await screen.findByText('The linked incident is not in your organisation.')
    await waitFor(() => expect(message.closest('[tabindex="-1"]')).toHaveFocus())
    expect(screen.getByLabelText(/What it's about/)).toHaveValue('  Worker was late  ')
    expect(screen.getByLabelText(/How it came in/)).toHaveValue('Phone')
  })

  it('edit: loads the record, shows the status line, and PUTs the full body with expectedUpdatedAt', async () => {
    const user = userEvent.setup()
    mockUseComplaint.mockReturnValue(loaded(complaint()))
    renderAt('/complaints/c-1')
    expect(screen.getByRole('heading', { level: 1, name: 'Complaint' })).toBeInTheDocument()
    expect(screen.getByText(/Received 05\/10\/2026/)).toBeInTheDocument()
    expect(screen.getByText(/Open 26 days/)).toBeInTheDocument()
    expect(screen.getByText(/Not acknowledged yet/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Actions taken'), 'Rang the family')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith({
      id: 'c-1',
      data: {
        receivedOn: '2026-10-05', channel: 'Phone', complainantKind: 'FamilyOrCarer', participantId: null, complainantName: 'Sam Carer',
        summary: 'Worker was late', status: 'Open', acknowledgedOn: null, actionsTaken: 'Rang the family', outcome: null,
        outcomeCommunicatedOn: null, toldAboutCommission: false, toldAboutCommissionOn: null, closedOn: null, handledByUserId: null,
        incidentReportId: null, expectedUpdatedAt: '2026-10-06T00:00:00Z',
      },
    })
  })

  it('choosing Closed fills Closed on with today, and the PUT carries it; Closed needs no outcome', async () => {
    const user = userEvent.setup()
    mockUseComplaint.mockReturnValue(loaded(complaint()))
    renderAt('/complaints/c-1')
    expect(screen.queryByLabelText(/Closed on/)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Status'), 'Closed')
    expect(screen.getByLabelText(/Closed on/)).toHaveValue(today)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled())
    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ status: 'Closed', closedOn: today, outcome: null })
  })

  it('a date before the received date is refused', async () => {
    const user = userEvent.setup()
    mockUseComplaint.mockReturnValue(loaded(complaint()))
    renderAt('/complaints/c-1')
    const ack = screen.getByLabelText(/Acknowledged on/)
    await user.type(ack, '2026-10-01')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText("This date can't be before the complaint was received.")).toBeInTheDocument()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('an archived record is read-only with a note and no Save', () => {
    mockUseComplaint.mockReturnValue(loaded(complaint({ isActive: false })))
    renderAt('/complaints/c-1')
    expect(screen.getByText(/This complaint is archived/)).toBeInTheDocument()
    expect(screen.getByLabelText(/What it's about/)).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('M2: choosing a participant narrows the incident options to theirs', async () => {
    const user = userEvent.setup()
    mockUseIncidents.mockReturnValue({
      isLoading: false,
      data: [
        { id: 'i-1', title: 'Fall at home', incidentDateTime: '2026-10-02T09:00:00', involvedParticipantId: 'p-1' },
        { id: 'i-2', title: 'Missing medication', incidentDateTime: '2026-10-03T09:00:00', involvedParticipantId: 'p-2' },
      ],
    })
    renderAt('/complaints/new')
    const picker = screen.getByLabelText('Search incidents…')
    expect(Array.from(picker.querySelectorAll('option')).map(o => o.textContent)).toEqual([
      'No linked incident', expect.stringContaining('Fall at home'), expect.stringContaining('Missing medication'),
    ])
    await user.selectOptions(screen.getByLabelText(/Who made the complaint/), 'Participant')
    await user.selectOptions(screen.getByLabelText('Participant picker'), 'p-2')
    expect(Array.from(screen.getByLabelText('Search incidents…').querySelectorAll('option')).map(o => o.textContent)).toEqual([
      'No linked incident', expect.stringContaining('Missing medication'),
    ])
  })

  it('states: loading, not found, error with retry, and a 403 callout', async () => {
    const user = userEvent.setup()
    mockUseComplaint.mockReturnValue({ ...loaded(undefined), isLoading: true })
    const first = renderAt('/complaints/c-1')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    first.unmount()

    mockUseComplaint.mockReturnValue({ ...loaded(undefined), isError: true, error: { response: { status: 404 } } })
    const second = renderAt('/complaints/c-1')
    expect(screen.getByText(/couldn't find|not found/i)).toBeInTheDocument()
    second.unmount()

    const refetch = vi.fn()
    mockUseComplaint.mockReturnValue({ ...loaded(undefined), isError: true, error: { response: { status: 500 } }, refetch })
    const third = renderAt('/complaints/c-1')
    await user.click(screen.getByRole('button', { name: /try again|retry/i }))
    expect(refetch).toHaveBeenCalled()
    third.unmount()

    mockUseComplaint.mockReturnValue({ ...loaded(undefined), isError: true, error: { response: { status: 403 } } })
    renderAt('/complaints/c-1')
    expect(screen.getByText("You can't see complaints. They're for Admins and Coordinators.")).toBeInTheDocument()
  })
})
