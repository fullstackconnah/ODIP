import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import MedicationFormPage from './MedicationFormPage'
import { __testHooks } from '@/hooks/useBackNavigation'

const { mockUseMedication, mockUseParticipant, mockCreateMutateAsync, mockUpdateMutateAsync, mockUseCreateMedication } = vi.hoisted(() => ({
  mockUseMedication: vi.fn(),
  mockUseParticipant: vi.fn(),
  mockCreateMutateAsync: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockUseCreateMedication: vi.fn(),
}))

// Only the API layer is mocked — FormField, Dropdown, ToggleGroup are the real components, so
// this exercises the actual frequency-controls conditional rendering wiring.
vi.mock('@/api/hooks', () => ({
  useCreateMedication: mockUseCreateMedication,
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
  mockUseCreateMedication.mockReturnValue({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: false, error: null })
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

    expect(screen.getByText(/^Due every 2 days, starting Sun 30 Aug 2026\.$/)).toBeInTheDocument()
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
        pharmacyName: 'Chemist Warehouse', pharmacyPhone: '03 9123 4567', consentObtained: true,
        consentGivenBy: 'Guardian', consentDate: '2026-01-01',
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

// MED-01: PharmacyPhone is editable wherever PharmacyName is edited — this is the only place
// (MedicationFormPage) that currently edits either field.
describe('MedicationFormPage MED-01 pharmacy phone', () => {
  it('prefills the Pharmacy Phone field from the existing medication', () => {
    mockUseMedication.mockReturnValue({
      data: {
        id: 'med-1', participantId: 'participant-1', name: 'Levetiracetam', strength: '500mg',
        form: 'Tablet', route: 'Oral', doseDescription: '1 tablet', type: 'Regular',
        timesOfDay: '08:00', frequency: 'Daily', daysOfWeek: [], intervalDays: null,
        anchorDate: null, status: 'Active', isHighRisk: false, isPsychotropic: false,
        isChemicalRestraint: false, drugSchedule: 'Unscheduled', supportLevel: 'SelfAdministered',
        packaging: 'OriginalPackaging', startDate: '2026-01-01', endDate: null, nextReviewDue: null,
        complianceFlags: [], directions: null, prnIndication: null, prnMaxDosesPer24h: null,
        prnMinIntervalMinutes: null, purpose: null, bspInPlace: false,
        restrictivePracticeAuthorisationRef: null, isHighIntensitySupport: false, prescriberName: null,
        pharmacyName: 'Chemist Warehouse', pharmacyPhone: '03 9123 4567', consentObtained: true,
        consentGivenBy: null, consentDate: null,
        storageRequirements: null, notes: null, prnDosesInLast24h: 0,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      },
      isLoading: false,
    })

    renderEditPage('med-1')

    expect(screen.getByDisplayValue('03 9123 4567')).toBeInTheDocument()
  })

  it('submits the Pharmacy Phone value that was typed in, alongside Pharmacy Name', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'new-med' } })
    renderCreatePage()

    await user.type(screen.getByPlaceholderText('e.g. Paracetamol'), 'Levothyroxine')
    await user.type(screen.getByPlaceholderText('e.g. 1 tablet'), '1 tablet')
    await user.type(screen.getByPlaceholderText('e.g. Chemist Warehouse'), 'Chemist Warehouse')
    await user.type(screen.getByPlaceholderText('e.g. 03 9123 4567'), '03 9123 4567')
    await user.click(screen.getByRole('button', { name: /create medication/i }))

    expect(mockCreateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        pharmacyName: 'Chemist Warehouse',
        pharmacyPhone: '03 9123 4567',
      }),
    }))
  })
})

// PP-32: the backend's specific validation message (MedicationsController.cs:609-635) should
// reach the banner instead of the one generic "check your input" string for every failure.
describe('MedicationFormPage save-failure banner', () => {
  it('shows the server\'s specific validation message on a failed save', () => {
    mockUseCreateMedication.mockReturnValue({
      mutateAsync: mockCreateMutateAsync,
      isPending: false,
      isError: true,
      error: { response: { data: { message: 'A medication with this name is already active for this participant.' } } },
    })
    renderCreatePage()

    expect(screen.getByRole('alert')).toHaveTextContent('A medication with this name is already active for this participant.')
  })
})

// Q2 fix round: ReadOnly reads a medication's full record only through this form, so it opens as a view: every field disabled, no Save.
describe('MedicationFormPage — view mode for ReadOnly', () => {
  const med = {
    id: 'med-1', participantId: 'participant-1', name: 'Levetiracetam', strength: '500mg',
    form: 'Tablet', route: 'Oral', doseDescription: '1 tablet', type: 'Regular',
    timesOfDay: '08:00', frequency: 'Daily', daysOfWeek: [], intervalDays: null,
    anchorDate: null, status: 'Active', isHighRisk: false, isPsychotropic: false,
    isChemicalRestraint: false, drugSchedule: 'Unscheduled', supportLevel: 'SelfAdministered',
    packaging: 'OriginalPackaging', startDate: '2026-01-01', endDate: null, nextReviewDue: null,
    complianceFlags: [], directions: null, prnIndication: null, prnMaxDosesPer24h: null,
    prnMinIntervalMinutes: null, purpose: null, bspInPlace: false,
    restrictivePracticeAuthorisationRef: null, isHighIntensitySupport: false, prescriberName: null,
    pharmacyName: 'Chemist Warehouse', pharmacyPhone: '03 9123 4567', consentObtained: true,
    consentGivenBy: null, consentDate: null,
    storageRequirements: null, notes: null, prnDosesInLast24h: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }

  it.each([['ReadOnly', true], ['Coordinator', false]] as const)('%s: view mode %s', (role, view) => {
    localStorage.setItem('odip_user', JSON.stringify({ role }))
    mockUseMedication.mockReturnValue({ data: med, isLoading: false })
    renderEditPage('med-1')

    expect(screen.getByRole('heading', { name: view ? 'View medication' : /Edit/ })).toBeInTheDocument()
    if (view) expect(screen.getByDisplayValue('Levetiracetam')).toBeDisabled()
    else expect(screen.getByDisplayValue('Levetiracetam')).toBeEnabled()
    expect(screen.queryByRole('button', { name: /Save/ }) === null).toBe(view)
    expect(mockUpdateMutateAsync).not.toHaveBeenCalled()
    localStorage.clear()
  })

  it('shows a stored reporting answer to a view-only user, disabled', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    mockUseMedication.mockReturnValue({
      data: {
        ...med, isChemicalRestraint: true, purpose: 'Agitation',
        linkedRestrictivePractice: { id: 'rp-1', isActive: true, requiresReporting: true, authorisedBy: null, authorisationDate: null },
      },
      isLoading: false,
    })
    renderEditPage('med-1')

    const yes = screen.getByRole('radio', { name: 'Yes' })
    expect(yes).toBeDisabled()
    expect(yes).toBeChecked()
    expect(screen.getByRole('radio', { name: 'No' })).toBeDisabled()
    localStorage.clear()
  })
})

// NAV F7: the form is opened from the /medications register as well as from the participant's Medications tab.
describe('MedicationFormPage — Back, Cancel and Save return to where the form was opened', () => {
  const medication = {
    id: 'med-1', participantId: 'participant-1', name: 'Levetiracetam', strength: '500mg',
    form: 'Tablet', route: 'Oral', doseDescription: '1 tablet', type: 'Regular',
    timesOfDay: '08:00', frequency: 'Daily', daysOfWeek: [], intervalDays: null,
    anchorDate: null, status: 'Active', isHighRisk: false, isPsychotropic: false,
    isChemicalRestraint: false, drugSchedule: 'Unscheduled', supportLevel: 'SelfAdministered',
    packaging: 'OriginalPackaging', startDate: '2026-01-01', endDate: null, nextReviewDue: null,
    complianceFlags: [], directions: null, prnIndication: null, prnMaxDosesPer24h: null,
    prnMinIntervalMinutes: null, purpose: null, bspInPlace: false,
    restrictivePracticeAuthorisationRef: null, isHighIntensitySupport: false, prescriberName: null,
    pharmacyName: null, pharmacyPhone: null, consentObtained: false,
    consentGivenBy: null, consentDate: null,
    storageRequirements: null, notes: null, prnDosesInLast24h: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  }
  function renderFrom(previous: string | null) {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    mockUseMedication.mockReturnValue({ data: medication, isLoading: false })
    if (previous) {
      __testHooks.seedHistory(previous, '/medications/med-1/edit')
    }
    const router = createMemoryRouter(
      [{ path: '/medications/:id/edit', element: <MedicationFormPage /> }, { path: '*', element: <p>elsewhere</p> }],
      previous
        ? { initialEntries: [previous, '/medications/med-1/edit'], initialIndex: 1 }
        : { initialEntries: ['/medications/med-1/edit'] },
    )
    render(<RouterProvider router={router} />)
    return router
  }
  afterEach(() => { __testHooks.reset(); localStorage.clear() })

  it('from the register: Back, Cancel and Save each return to the register', async () => {
    mockUpdateMutateAsync.mockResolvedValue({ success: true })
    const user = userEvent.setup()
    const back = renderFrom('/medications')
    expect(screen.getByRole('link', { name: 'Back to Medications' })).toHaveAttribute('href', '/participants/participant-1?tab=medications')
    await user.click(screen.getByRole('link', { name: 'Back to Medications' }))
    await vi.waitFor(() => expect(back.state.location.pathname).toBe('/medications'))
    cleanup()
    const cancel = renderFrom('/medications')
    await user.click(screen.getByRole('link', { name: 'Cancel' }))
    await vi.waitFor(() => expect(cancel.state.location.pathname).toBe('/medications'))
    cleanup()
    const save = renderFrom('/medications')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(save.state.location.pathname).toBe('/medications'))
  })

  it('with no history (a deep link): the participant Medications tab stays the fallback', async () => {
    mockUpdateMutateAsync.mockResolvedValue({ success: true })
    const router = renderFrom(null)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/participants/participant-1'))
    expect(router.state.location.search).toBe('?tab=medications')
  })

})

// C25: a failed or missing record must never open an empty form that a save would write over the real one.
describe('MedicationFormPage — editing a record that has not loaded', () => {
  it('says it is loading while the record loads, with no form', () => {
    mockUseMedication.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderEditPage('med-1')
    expect(screen.getByRole('status')).toHaveTextContent('Loading medication…')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })

  it('shows the error with Try again when the load fails, and no form', async () => {
    const refetch = vi.fn()
    mockUseMedication.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 500 } }, refetch })
    renderEditPage('med-1')
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load this medication/i)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('says not found on a 404, with no form', () => {
    mockUseMedication.mockReturnValue({ data: undefined, isLoading: false, isError: true, error: { response: { status: 404 } }, refetch: vi.fn() })
    renderEditPage('med-1')
    expect(screen.getByText('Medication not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to medications' })).toHaveAttribute('href', '/medications')
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
  })
})

describe('MedicationFormPage — chemical restraint register panel', () => {
  async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByPlaceholderText('e.g. Paracetamol'), 'Risperidone')
    await user.type(screen.getByPlaceholderText('e.g. 1 tablet'), '1 tablet')
    await user.type(screen.getByPlaceholderText('What this medication is for'), 'Agitation')
  }

  it('asks the reporting question, requires an answer, and saves the restraint fields', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'new-med', participantId: 'participant-1' } })
    renderCreatePage()
    await fillBasics(user)
    await user.click(screen.getByLabelText('Chemical restraint'))

    await user.click(screen.getByRole('button', { name: /create medication/i }))
    expect(await screen.findByText('Choose Yes or No')).toBeInTheDocument()
    expect(mockCreateMutateAsync).not.toHaveBeenCalled()

    await user.click(screen.getByRole('radio', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: /create medication/i }))
    expect(mockCreateMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        isChemicalRestraint: true,
        restraintAuthorised: false,
        restraintAuthorisedBy: null,
        restraintAuthorisationDate: null,
        restraintRequiresReporting: true,
      }),
    }))
  })

  it('swaps the reporting question for authoriser and date when authorised', async () => {
    const user = userEvent.setup()
    mockCreateMutateAsync.mockResolvedValue({ success: true, data: { id: 'new-med', participantId: 'participant-1' } })
    renderCreatePage()
    await fillBasics(user)
    await user.click(screen.getByLabelText('Chemical restraint'))
    await user.click(screen.getByLabelText('This restrictive practice is authorised'))

    expect(screen.queryByText('Does this need to be reported to the NDIS Commission?')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /create medication/i }))
    expect(await screen.findByText('Add who authorised it')).toBeInTheDocument()
    expect(screen.getByText('Add the date it was authorised')).toBeInTheDocument()
  })

  it('shows a warning banner with the reload copy on a 409', () => {
    mockUseCreateMedication.mockReturnValue({
      mutateAsync: mockCreateMutateAsync, isPending: false, isError: true,
      error: { response: { status: 409, data: {} } },
    })
    renderCreatePage()
    expect(screen.getByRole('alert')).toHaveTextContent("This medicine's register entry was changed while you were editing. Reload the page")
  })
})
