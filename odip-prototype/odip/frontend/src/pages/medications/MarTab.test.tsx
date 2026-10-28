import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MarTab from './MarTab'

const { mockUseMar, mockUseParticipants, mockUseRecordPrnOutcome, mockNavigate, permissionsOverride } = vi.hoisted(() => ({
  mockUseMar: vi.fn(),
  mockUseParticipants: vi.fn(),
  mockUseRecordPrnOutcome: vi.fn(),
  mockNavigate: vi.fn(),
  permissionsOverride: { canCreateIncidents: true },
}))

vi.mock('@/api/hooks', () => ({
  useMar: mockUseMar,
  useParticipants: mockUseParticipants,
  useRecordPrnOutcome: mockUseRecordPrnOutcome,
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({
    canRecordAdministrations: true, canManageMedications: true, canCreateIncidents: permissionsOverride.canCreateIncidents,
  }),
}))

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('./RecordAdministrationModal', () => ({ RecordAdministrationModal: () => null }))
vi.mock('./MissedMedicationGuidance', () => ({ MissedMedicationGuidance: () => null }))

function scheduledEntry(overrides: Record<string, unknown> = {}) {
  return {
    medicationId: 'med-1',
    participantId: 'participant-1',
    participantName: 'Priya Nair',
    medicationName: 'Paracetamol',
    strength: '500mg',
    doseDescription: '1 tablet',
    form: 'Tablet',
    route: 'Oral',
    packaging: 'OriginalPackaging',
    pharmacyName: null,
    pharmacyPhone: null,
    scheduledTime: '08:00',
    scheduledAt: '2026-09-13T08:00:00Z',
    isHighRisk: false,
    supportLevel: 'FullSupport',
    isOverdue: false,
    administration: null,
    ...overrides,
  }
}

function prnEntry(overrides: Record<string, unknown> = {}) {
  return {
    medicationId: 'med-2',
    participantId: 'participant-2',
    participantName: 'Noah Blake',
    name: 'Ibuprofen',
    strength: '200mg',
    doseDescription: '1 tablet',
    prnIndication: 'Pain',
    prnMaxDosesPer24h: 4,
    prnMinIntervalMinutes: 240,
    packaging: 'OriginalPackaging',
    pharmacyName: null,
    pharmacyPhone: null,
    dosesInLast24h: 0,
    lastDoseAt: null,
    outcomePendingAdministrationId: null,
    ...overrides,
  }
}

function renderTab() {
  return render(
    <MemoryRouter>
      <MarTab />
    </MemoryRouter>,
  )
}

describe('MarTab — day navigation', () => {
  it('sizes the day buttons and the date field off the same control height', () => {
    mockUseMar.mockReturnValue({ data: { entries: [], prnMedications: [] }, isLoading: false })
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync: vi.fn() })

    renderTab()

    const controls = [
      screen.getByRole('button', { name: 'Previous day' }),
      screen.getByRole('button', { name: 'Today' }),
      screen.getByRole('button', { name: 'Next day' }),
      screen.getByLabelText('Select date'),
    ]
    for (const c of controls) expect(c.className).toContain('h-[var(--control-h)]')
  })
})

describe('MarTab — cross-domain links', () => {
  it('links a scheduled entry\'s participant name to their Medications tab', () => {
    mockUseMar.mockReturnValue({ data: { entries: [scheduledEntry()], prnMedications: [] }, isLoading: false })
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync: vi.fn() })

    renderTab()

    expect(screen.getByRole('link', { name: 'Priya Nair' })).toHaveAttribute(
      'href',
      '/participants/participant-1?tab=medications',
    )
  })

  it('links a PRN entry\'s participant name to their Medications tab', () => {
    mockUseMar.mockReturnValue({ data: { entries: [], prnMedications: [prnEntry()] }, isLoading: false })
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync: vi.fn() })

    renderTab()

    expect(screen.getByRole('link', { name: 'Noah Blake' })).toHaveAttribute(
      'href',
      '/participants/participant-2?tab=medications',
    )
  })
})

function administeredEntry(status: string, overrides: Record<string, unknown> = {}) {
  return scheduledEntry({
    administration: {
      id: 'admin-1', status, incidentId: null,
      administeredAt: '2026-09-13T08:05:00Z', administeredAtTimeZone: 'Australia/Brisbane', recordedByName: 'Alex Rivera',
      participantId: 'participant-1', participantName: 'Priya Nair', medicationName: 'Paracetamol', doseDescription: '1 tablet',
      reason: 'Participant declined', notes: null, tripInstanceId: null, scheduledAt: '2026-09-13T08:00:00Z',
      ...overrides,
    },
  })
}

describe('MarTab — connection map: incident link/file action on scheduled rows', () => {
  beforeEach(() => {
    permissionsOverride.canCreateIncidents = true
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync: vi.fn() })
    mockNavigate.mockReset()
  })

  it('shows "Incident filed" linking to the incident when a trigger-outcome row already has one', () => {
    mockUseMar.mockReturnValue({
      data: { entries: [administeredEntry('Refused', { incidentId: 'inc-9' })], prnMedications: [] },
      isLoading: false,
    })
    renderTab()

    expect(screen.getByRole('link', { name: 'Incident filed' })).toHaveAttribute('href', '/incidents/inc-9')
    expect(screen.queryByRole('button', { name: 'File incident' })).not.toBeInTheDocument()
  })

  it('shows a "File incident" action, navigating with the built MAR prefill, when no incident is linked yet', async () => {
    const user = userEvent.setup()
    mockUseMar.mockReturnValue({
      data: { entries: [administeredEntry('Missed')], prnMedications: [] },
      isLoading: false,
    })
    renderTab()

    await user.click(screen.getByRole('button', { name: 'File incident' }))

    expect(mockNavigate).toHaveBeenCalledWith('/incidents/new', {
      state: expect.objectContaining({
        source: 'mar-administration',
        outcome: 'Missed',
        medicationAdministrationId: 'admin-1',
        strength: '500mg',
      }),
    })
  })

  it('shows neither link nor action for an Administered row', () => {
    mockUseMar.mockReturnValue({
      data: { entries: [administeredEntry('Administered')], prnMedications: [] },
      isLoading: false,
    })
    renderTab()

    expect(screen.queryByRole('link', { name: 'Incident filed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'File incident' })).not.toBeInTheDocument()
  })

  it('hides the "File incident" action for a role without incident access', () => {
    permissionsOverride.canCreateIncidents = false
    mockUseMar.mockReturnValue({
      data: { entries: [administeredEntry('Missed')], prnMedications: [] },
      isLoading: false,
    })
    renderTab()

    expect(screen.queryByRole('button', { name: 'File incident' })).not.toBeInTheDocument()
  })
})

describe('MarTab — Last dose', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the last dose in running text: never, just now, minutes, hours, days (formatRelative, long)', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-30T12:00:00Z'))
    mockUseMar.mockReturnValue({
      data: {
        entries: [],
        prnMedications: [
          prnEntry({ medicationId: 'm1', name: 'Alpha', lastDoseAt: null }),
          prnEntry({ medicationId: 'm2', name: 'Bravo', lastDoseAt: '2026-09-30T11:59:50Z' }),
          prnEntry({ medicationId: 'm3', name: 'Charlie', lastDoseAt: '2026-09-30T11:54:20Z' }),
          prnEntry({ medicationId: 'm4', name: 'Delta', lastDoseAt: '2026-09-30T10:30:00Z' }),
          prnEntry({ medicationId: 'm5', name: 'Echo', lastDoseAt: '2026-09-27T12:00:00Z' }),
        ],
      },
      isLoading: false,
    })
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync: vi.fn() })

    renderTab()

    for (const text of ['Last dose never', 'Last dose just now', 'Last dose 5 min ago', 'Last dose 1 hr ago', 'Last dose 3 days ago']) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })
})

describe('MarTab — PRN outcome context', () => {
  beforeEach(() => {
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  })

  it('shows the selected participant and medicine, and only shows dose timing for the exact pending administration', async () => {
    const user = userEvent.setup()
    mockUseMar.mockReturnValue({
      data: {
        entries: [administeredEntry('Administered', { administration: undefined })],
        prnMedications: [prnEntry({ outcomePendingAdministrationId: 'admin-1', lastDoseAt: '2026-09-13T02:00:00Z' })],
      },
      isLoading: false,
    })
    // Keep a different participant with the same medicine in the loaded list; it must not supply the context.
    mockUseMar.mockReturnValue({
      data: {
        entries: [scheduledEntry({ participantId: 'participant-other', participantName: 'Other person', medicationName: 'Ibuprofen', administration: { id: 'admin-other', administeredAt: '2026-09-13T01:00:00Z', administeredAtTimeZone: 'Australia/Brisbane', doseDescription: '2 tablets' } })],
        prnMedications: [prnEntry({ outcomePendingAdministrationId: 'admin-1', lastDoseAt: '2026-09-13T02:00:00Z' })],
      },
      isLoading: false,
    })
    renderTab()
    await user.click(screen.getByRole('button', { name: 'Record outcome' }))

    expect(screen.getByText('Noah Blake · Ibuprofen 200mg')).toBeInTheDocument()
    expect(screen.queryByText(/Given/)).not.toBeInTheDocument()
    expect(screen.queryByText('2 tablets')).not.toBeInTheDocument()
  })
})

describe('MarTab — recording a PRN outcome the server refuses', () => {
  const recorded = { response: { status: 409, data: { success: false, code: 'PRN_OUTCOME_ALREADY_RECORDED', errors: ['An outcome is already recorded for this dose.'] } } }
  const busy = { response: { status: 409, data: { success: false, code: 'ADMINISTRATION_SLOT_BUSY', errors: ['Another person is saving this dose right now. Check the dose, then try again.'] } } }
  const pendingMar = () => ({ data: { entries: [], prnMedications: [prnEntry({ outcomePendingAdministrationId: 'admin-9' })] }, isLoading: false })

  async function openAndSave(user: ReturnType<typeof userEvent.setup>, text = 'Settled within 30 minutes') {
    await user.click(screen.getByRole('button', { name: /record outcome/i }))
    await user.type(screen.getByRole('textbox', { name: /outcome/i }), text)
    await user.click(screen.getByRole('button', { name: 'Save outcome' }))
  }

  it('says the outcome was not saved, keeps the text and switches Save off so a retry cannot repeat the 409', async () => {
    const mutateAsync = vi.fn().mockRejectedValueOnce(recorded)
    mockUseMar.mockReturnValue(pendingMar())
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync, isPending: false })
    const user = userEvent.setup()

    const view = renderTab()
    await openAndSave(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('An outcome is already recorded for this dose.')
    expect(alert).toHaveTextContent('Your outcome was not saved.')
    expect(alert).toHaveTextContent('ask a coordinator')
    expect(mutateAsync).toHaveBeenCalledWith({ id: 'admin-9', prnOutcome: 'Settled within 30 minutes' })
    expect(screen.getByRole('textbox', { name: /outcome/i })).toHaveValue('Settled within 30 minutes')
    expect(screen.getByRole('button', { name: 'Save outcome' })).toBeDisabled()

    // The page refetches behind the modal: the dose no longer offers "Record outcome", and closing the window clears everything.
    mockUseMar.mockReturnValue({ data: { entries: [], prnMedications: [prnEntry({ outcomePendingAdministrationId: null })] }, isLoading: false })
    view.rerender(<MemoryRouter><MarTab /></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: /record outcome/i })).not.toBeInTheDocument()
    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('keeps Save on after a busy answer, and the refusal clears on the next success', async () => {
    const mutateAsync = vi.fn().mockRejectedValueOnce(busy).mockResolvedValueOnce({ success: true })
    mockUseMar.mockReturnValue(pendingMar())
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync, isPending: false })
    const user = userEvent.setup()

    renderTab()
    await openAndSave(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Another person is saving this dose right now. Check the dose, then try again. Your outcome was not saved.')
    expect(screen.getByRole('button', { name: 'Save outcome' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Save outcome' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /outcome/i })).not.toBeInTheDocument())
    expect(mutateAsync).toHaveBeenCalledTimes(2)
    await user.click(screen.getByRole('button', { name: /record outcome/i }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /outcome/i })).toHaveValue('')
  })

  it.each([
    ['a missing record', { response: { status: 404, data: { success: false, errors: ['Administration record not found'] } } }, 'This dose record is no longer available. Your outcome was not saved. Close this window and refresh the page.', true],
    ['a dose that is not PRN', { response: { status: 400, data: { success: false, errors: ['Outcomes can only be recorded on PRN doses.'] } } }, 'Outcomes can only be recorded on PRN doses. Your outcome was not saved. Close this window.', true],
    ['no answer from the server', new Error('Network Error'), 'Could not save the outcome. What you typed is still here. Check your connection and try again.', false],
  ])('explains %s in plain words', async (_name, failure, message, final) => {
    mockUseMar.mockReturnValue(pendingMar())
    mockUseParticipants.mockReturnValue({ data: [] })
    mockUseRecordPrnOutcome.mockReturnValue({ mutateAsync: vi.fn().mockRejectedValueOnce(failure), isPending: false })
    const user = userEvent.setup()

    renderTab()
    await openAndSave(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('textbox', { name: /outcome/i })).toHaveValue('Settled within 30 minutes')
    expect(screen.getByRole('button', { name: 'Save outcome' }).hasAttribute('disabled')).toBe(final)
  })
})
