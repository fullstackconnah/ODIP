import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import MedicationFormPage from './MedicationFormPage'

const { mockUseMedication, mockUseParticipant, mockCreateMutateAsync, mockUpdateMutateAsync } = vi.hoisted(() => ({
  mockUseMedication: vi.fn(),
  mockUseParticipant: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
}))

// Only the API layer is mocked — FormField, Dropdown, ToggleGroup are the real components, so
// this exercises the actual frequency-controls conditional rendering wiring.
vi.mock('@/api/hooks', () => ({
  useCreateMedication: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: false }),
  useUpdateMedication: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false, isError: false }),
  useMedication: mockUseMedication,
  useParticipant: mockUseParticipant,
}))

// MedicationFormPage calls useUnsavedChangesWarning, which uses react-router 7's useBlocker —
// that throws under a plain declarative <MemoryRouter>/<Routes>, so tests need a data router
// (same requirement App.tsx documents for the real app).
function renderCreatePage() {
  const router = createMemoryRouter(
    [{ path: '/medications/new', element: <MedicationFormPage /> }],
    { initialEntries: ['/medications/new?participantId=participant-1'] },
  )
  return render(<RouterProvider router={router} />)
}

function renderEditPage(medicationId: string) {
  const router = createMemoryRouter(
    [{ path: '/medications/:id/edit', element: <MedicationFormPage /> }],
    { initialEntries: [`/medications/${medicationId}/edit`] },
  )
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  mockUseMedication.mockReturnValue({ data: undefined, isLoading: false })
  mockUseParticipant.mockReturnValue({ data: undefined })
  mockCreateMutateAsync.mockReset()
})

describe('MedicationFormPage frequency controls', () => {
  it('defaults to Daily with SpecificDays/EveryNDays controls hidden', () => {
    renderCreatePage()

    // ToggleGroup is a single-select radio group (role="radio"), not a set of independent buttons.
    expect(screen.getByRole('radio', { name: 'Every day' })).toBeInTheDocument()
    expect(screen.queryByText(/^Days of week/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Starting from/)).not.toBeInTheDocument()
  })

  it('shows the weekday picker only when Specific days of the week is selected', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.click(screen.getByRole('radio', { name: 'Specific days of the week' }))

    expect(screen.getByText(/^Days of week/)).toBeInTheDocument()
    // The weekday picker itself is a separate hand-rolled multi-select button group, not a ToggleGroup.
    expect(screen.getByRole('button', { name: 'Mon' })).toBeInTheDocument()
    expect(screen.queryByText(/^Starting from/)).not.toBeInTheDocument()
  })

  it('shows the interval + anchor date controls only when Every N days is selected', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.click(screen.getByRole('radio', { name: 'Every N days' }))

    expect(screen.getByText(/^Starting from/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mon' })).not.toBeInTheDocument()
  })

  it('restates the every-N-days schedule in plain language once both fields are filled', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.click(screen.getByRole('radio', { name: 'Every N days' }))
    expect(screen.queryByText(/^Due every/)).not.toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('e.g. 2'), '2')
    const anchorInput = screen.getByLabelText(/Starting from/)
    await user.type(anchorInput, '2026-08-30')

    expect(screen.getByText(/^Due every 2 days, starting 30\/08\/2026\.$/)).toBeInTheDocument()
  })

  it('hides the frequency controls entirely for PRN medications', async () => {
    const user = userEvent.setup()
    renderCreatePage()

    await user.click(screen.getByRole('radio', { name: 'PRN (as needed)' }))

    expect(screen.queryByRole('radio', { name: 'Every day' })).not.toBeInTheDocument()
    expect(screen.getByText(/PRN Indication/i)).toBeInTheDocument()
  })

  it('prefills frequency, days of week, interval and anchor date when editing an existing schedule', () => {
    mockUseMedication.mockReturnValue({
      data: {
        id: 'med-1', participantId: 'participant-1', name: 'Levetiracetam', strength: '500mg',
        form: 'Tablet', route: 'Oral', doseDescription: '1 tablet', type: 'Regular',
        timesOfDay: '08:00', frequency: 'EveryNDays', daysOfWeek: [], intervalDays: 3,
        anchorDate: '2026-02-15', status: 'Active', isHighRisk: false, isPsychotropic: false,
        isChemicalRestraint: false, drugSchedule: 'Unscheduled', supportLevel: 'SelfAdministered',
        packaging: 'OriginalPackaging', startDate: '2026-01-01', endDate: null, nextReviewDue: null,
        complianceFlags: [], directions: null, prnIndication: null, prnMaxDosesPer24h: null,
        prnMinIntervalMinutes: null, purpose: null, bspInPlace: false,
        restrictivePracticeAuthorisationRef: null, isHighIntensitySupport: false, prescriberName: null,
        pharmacyName: null, consentObtained: true, consentGivenBy: 'Guardian', consentDate: '2026-01-01',
        storageRequirements: null, notes: null, prnDosesInLast24h: 0,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
      isLoading: false,
    })

    renderEditPage('med-1')

    expect(screen.getByText(/^Starting from/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('3')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2026-02-15')).toBeInTheDocument()
  })
})
