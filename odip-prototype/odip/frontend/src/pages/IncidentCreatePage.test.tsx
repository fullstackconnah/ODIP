import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import IncidentCreatePage from './IncidentCreatePage'

const {
  mockUseIncident, mockCreateMutateAsync, mockUpdateMutateAsync,
} = vi.hoisted(() => ({
  mockUseIncident: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — FormField, Card are the real components, so this exercises the
// actual conditional-reveal wiring (INC-01 trip dropdown, INC-02 specify field).
vi.mock('@/api/hooks', () => ({
  useCreateIncident: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: false }),
  useUpdateIncident: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false, isError: false }),
  useIncident: mockUseIncident,
  useTrips: () => ({ data: [{ id: 'trip-1', tripName: 'Gold Coast Beach Break' }, { id: 'trip-2', tripName: 'Blue Mountains Adventure' }] }),
  useStaff: () => ({ data: [{ id: 'staff-1', fullName: 'Alex Rivera' }] }),
  useParticipants: () => ({ data: [{ id: 'participant-1', firstName: 'Sophie', lastName: 'Brown', fullName: 'Sophie Brown' }] }),
}))

// IncidentCreatePage calls useUnsavedChangesWarning, which uses react-router 7's useBlocker —
// that throws under a plain declarative <MemoryRouter>/<Routes>, so tests need a data router
// (same requirement ParticipantCreatePage.test.tsx documents).
function renderCreatePage() {
  const router = createMemoryRouter(
    [
      { path: '/incidents/new', element: <IncidentCreatePage /> },
      { path: '/incidents', element: <div>Incidents list</div> },
    ],
    { initialEntries: ['/incidents/new'] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  mockUseIncident.mockReturnValue({ data: undefined })
  mockCreateMutateAsync.mockReset()
  mockUpdateMutateAsync.mockReset()
  mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'new-incident-1' } })
})

describe('IncidentCreatePage — INC-01 service type / trip linkage', () => {
  it('does not show the Trip dropdown until Service Type is set to Trip', async () => {
    renderCreatePage()

    expect(screen.queryByLabelText(/^Trip/)).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'Trip')

    expect(screen.getByLabelText(/^Trip/)).toBeInTheDocument()
  })

  it('hides the Trip dropdown again when Service Type changes away from Trip', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'Trip')
    expect(screen.getByLabelText(/^Trip/)).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'STA')
    expect(screen.queryByLabelText(/^Trip/)).not.toBeInTheDocument()
  })

  it('blocks submit when Service Type is Trip but no trip is selected', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Slip near pool')
    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'Trip')
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Details here')
    await user.selectOptions(screen.getByLabelText('Reported By *'), 'staff-1')
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(await screen.findByText(/trip must be selected/i)).toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('submits with a serviceType/tripInstanceId payload when Trip is selected', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Slip near pool')
    await user.selectOptions(screen.getByLabelText(/Service Type/i), 'Trip')
    await user.selectOptions(screen.getByLabelText(/^Trip/), 'trip-1')
    // incidentType defaults to 'Other', which requires the specify field too.
    await user.type(screen.getByPlaceholderText('Describe the incident type'), 'Slip and fall')
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Details here')
    await user.selectOptions(screen.getByLabelText('Reported By *'), 'staff-1')
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      serviceType: 'Trip',
      tripInstanceId: 'trip-1',
    })
  })
})

describe('IncidentCreatePage — INC-02 "Other" incident type specify field', () => {
  it('shows the specify field once Incident Type is Other (the default)', () => {
    renderCreatePage()
    expect(screen.getByLabelText(/Specify Incident Type/i)).toBeInTheDocument()
  })

  it('hides the specify field for a non-Other incident type', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.selectOptions(screen.getByLabelText('Incident Type *'), 'Injury')
    expect(screen.queryByLabelText(/Specify Incident Type/i)).not.toBeInTheDocument()
  })

  it('blocks submit when Incident Type is Other but nothing is specified', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Something happened')
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Details here')
    await user.selectOptions(screen.getByLabelText('Reported By *'), 'staff-1')
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(await screen.findByText(/specify the incident type/i)).toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()
  })

  it('submits with otherTypeSpecify once filled in', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('Brief incident summary'), 'Something happened')
    await user.type(screen.getByPlaceholderText('Describe the incident type'), 'Lost property')
    await user.type(screen.getByPlaceholderText('Detailed description of the incident...'), 'Details here')
    await user.selectOptions(screen.getByLabelText('Reported By *'), 'staff-1')
    await user.type(screen.getByLabelText(/Date & Time/i), '2026-09-01T10:00')

    await user.click(screen.getByRole('button', { name: /submit incident report/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledTimes(1)
    expect(mockCreateMutateAsync.mock.calls[0][0]).toMatchObject({
      incidentType: 'Other',
      otherTypeSpecify: 'Lost property',
    })
  })
})
