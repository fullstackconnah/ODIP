import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import IncidentDetailPage from './IncidentDetailPage'
import type { IncidentDetailDto } from '@/api/types/incidents'

const { mockUseIncident, mockUpdate, mockRefetch, mockUseRestrictivePractices } = vi.hoisted(() => ({
  mockUseIncident: vi.fn(),
  mockUpdate: vi.fn(),
  mockRefetch: vi.fn(),
  mockUseRestrictivePractices: vi.fn(),
}))

// Only the API layer is mocked: the page, its view cards and the wizard's own step components are real.
vi.mock('@/api/hooks', async () => {
  const { useState } = await import('react')
  return {
    useIncident: mockUseIncident,
    useIncidentStatusHistory: () => ({ data: [], isLoading: false, isError: false }),
    useRecordIncidentReview: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, isError: false }),
    // Keeps the error in state like the real mutation, so the page shows it.
    useUpdateIncident: () => {
      const [error, setError] = useState<unknown>(null)
      return {
        mutateAsync: async (v: unknown) => { setError(null); try { return await mockUpdate(v) } catch (e) { setError(e); throw e } },
        isPending: false, isError: error !== null, error,
      }
    },
    useStaff: () => ({ data: [{ id: 'staff-4', fullName: 'Mei Zhang' }, { id: 'staff-2', fullName: 'Sam Okafor' }] }),
    useTrips: () => ({ data: [] }),
    useParticipants: () => ({ data: [{ id: 'participant-4', firstName: 'Grace', lastName: 'Palmer-Hughes', fullName: 'Grace Palmer-Hughes' }] }),
    useRestrictivePractices: mockUseRestrictivePractices,
    useBulkCreateRestrictivePractices: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useParticipantMedications: () => ({ data: [] }),
  }
})

const UPDATED_AT = '2026-10-05T01:02:03.4567890Z'

function incident(overrides: Partial<IncidentDetailDto> = {}): IncidentDetailDto {
  return {
    id: 'inc-1', serviceType: 'None', tripInstanceId: null, tripName: null, incidentType: 'PropertyDamage', otherTypeSpecify: null,
    severity: 'Low', status: 'Open', title: 'Broken window', incidentDateTime: '2026-10-03T08:00:00', location: 'Home',
    reportedByName: 'Mei Zhang', involvedParticipantId: 'participant-4', involvedParticipantName: 'Grace Palmer-Hughes', qscReportingStatus: 'NotRequired', isOverdue24h: false,
    createdAt: '2026-10-03T09:00:00Z', medicationAdministrationId: 'med-1', shiftId: 'shift-1', shiftNoteId: 'note-1',
    participantBookingId: null, involvedStaffId: null, involvedStaffName: null, reportedByStaffId: 'staff-4',
    restrictivePracticeType: null, restrictivePracticeId: null, restrictivePracticeDescription: null, restrictivePracticeReviewDate: null,
    unapprovedRestrictivePracticeDetails: null, isRestrictivePracticeAuthorised: null,
    description: 'A ball went through the window.', immediateActionsTaken: 'Cleared the glass.', wereEmergencyServicesCalled: false, emergencyServicesDetails: null, emergencyServices: 'None',
    policeOfficerName: null, policeReference: null, ambulanceOfficerName: null, ambulanceReference: null, fireOfficerName: null, fireReference: null,
    witnessNames: null, witnessStatements: null, injuries: [],
    witnesses: [
      { id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Sam Okafor', isStaffWitness: true, witnessStatus: 'Approved', witnessRequestedAt: '2026-10-03T10:00:00Z', witnessRespondedAt: '2026-10-03T11:00:00Z', statementText: 'I saw it.' },
    ],
    qscReportedAt: null, qscReferenceNumber: null, awareAt: '2026-10-03T09:05:00Z', reportableClass: 'None', reportableClassReason: null,
    notifyDueAt: null, detailedReportDueAt: null, dueCountedWithoutHolidays: false,
    commissionDetailedReportedAt: null, commissionFinalReportRequested: false, commissionFinalReportedAt: null, timeZoneId: 'Australia/Sydney',
    reviewedByStaffId: null, reviewedByName: null, reviewedAt: null, reviewNotes: null, correctiveActions: null, resolvedAt: null,
    familyNotified: false, familyNotifiedAt: null, supportCoordinatorNotified: false, supportCoordinatorNotifiedAt: null,
    updatedAt: UPDATED_AT, medicationContext: null, shiftContext: null, shiftNoteContext: null,
    ...overrides,
  } as IncidentDetailDto
}

// useUnsavedChangesWarning uses react-router 7's useBlocker, which needs a data router.
function renderPage(data: IncidentDetailDto = incident()) {
  mockUseIncident.mockReturnValue({ data, isLoading: false, isFetching: false, refetch: mockRefetch })
  const router = createMemoryRouter(
    [{ path: '/incidents/:id', element: <IncidentDetailPage /> }, { path: '/incidents', element: <div>Incidents list</div> }],
    { initialEntries: ['/incidents/inc-1'] },
  )
  return render(<RouterProvider router={router} />)
}

const editButton = (name: string) => screen.getByRole('button', { name: `Edit ${name}` })
const openGroups = () => [...document.querySelectorAll('[data-editing][data-group]')].map((e) => e.getAttribute('data-group'))
const save = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Save' }))

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  mockUpdate.mockReset()
  mockUpdate.mockResolvedValue({ success: true, data: { id: 'inc-1' } })
  mockRefetch.mockReset()
  mockUseRestrictivePractices.mockReturnValue({ data: [] })
})
afterEach(() => localStorage.clear())

describe('IncidentDetailPage — editing one part', () => {
  it('Edit on Who opens Who and What and focuses the first field, and Cancel returns focus to the Edit', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(editButton('who'))
    expect(openGroups()).toEqual(['basics'])
    expect(document.querySelector('[data-group=basics]')).toContainElement(document.activeElement as HTMLElement)
    expect(screen.getByPlaceholderText('Brief incident summary')).toHaveValue('Broken window')
    // The other parts stay as they were, read only.
    expect(screen.getByRole('heading', { name: 'Witnesses' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(openGroups()).toEqual([])
    await waitFor(() => expect(editButton('who')).toHaveFocus())
  })

  it('switches straight away from a part with no changes, and asks before leaving one with changes', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(editButton('who'))
    await user.click(editButton('witnesses'))
    expect(openGroups()).toEqual(['witnesses'])
    expect(screen.queryByText('Discard your changes?')).not.toBeInTheDocument()

    await user.click(editButton('who'))
    await user.type(screen.getByPlaceholderText('Brief incident summary'), ' again')
    await user.click(editButton('compliance'))
    expect(screen.getByText('Discard your changes?')).toBeInTheDocument()
    expect(screen.getByText("Your changes to who and what haven't been saved.")).toBeInTheDocument()
    expect(openGroups()).toEqual(['basics'])

    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(openGroups()).toEqual(['basics'])
    expect(screen.getByPlaceholderText('Brief incident summary')).toHaveValue('Broken window again')

    await user.click(editButton('compliance'))
    await user.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(openGroups()).toEqual(['compliance'])
  })

  it('Save sends the full incident with the loaded updatedAt and the change, then announces it', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(editButton('who'))
    const title = screen.getByPlaceholderText('Brief incident summary')
    await user.clear(title)
    await user.type(title, 'Broken kitchen window')
    await save(user)

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate.mock.calls[0][0]).toMatchObject({
      id: 'inc-1',
      data: { title: 'Broken kitchen window', expectedUpdatedAt: UPDATED_AT, description: 'A ball went through the window.', medicationAdministrationId: 'med-1', shiftId: 'shift-1', shiftNoteId: 'note-1' },
    })
    expect(openGroups()).toEqual([])
    expect(screen.getByRole('status')).toHaveTextContent('Who and what saved.')
  })

  it('a 409 shows the server message, keeps what was typed and fetches the incident again', async () => {
    const message = 'Someone else changed this incident after you opened it. Cancel, then edit it again to see their changes.'
    mockUpdate.mockRejectedValue({ response: { status: 409, data: { message } } })
    const user = userEvent.setup()
    renderPage()

    await user.click(editButton('who'))
    const title = screen.getByPlaceholderText('Brief incident summary')
    await user.clear(title)
    await user.type(title, 'My title')
    await save(user)

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Brief incident summary')).toHaveValue('My title')
    expect(mockRefetch).toHaveBeenCalledTimes(1)
    expect(openGroups()).toEqual(['basics'])
  })

  it('an invalid field outside the open part does not block Save', async () => {
    const user = userEvent.setup()
    renderPage(incident({ description: '' }))

    await user.click(editButton('who'))
    await save(user)

    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('blocks Save on an invalid field inside the open part', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(editButton('who'))
    await user.clear(screen.getByPlaceholderText('Brief incident summary'))
    await save(user)

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(openGroups()).toEqual(['basics'])
  })
})

describe('IncidentDetailPage — editing the witnesses', () => {
  it('asks before removing a witness who has approved, and Keep witness keeps them', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(editButton('witnesses'))
    await user.click(screen.getByRole('button', { name: 'Remove witness' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Remove Sam Okafor?')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Keep witness' }))

    await save(user)
    expect(mockUpdate.mock.calls[0][0].data.witnesses).toEqual([{ id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Sam Okafor' }])
  })

  it('an unchanged save echoes the witness id, the stored links, and no legacy witness text', async () => {
    const user = userEvent.setup()
    renderPage(incident({ witnessNames: 'Mei Zhang', witnessStatements: 'slip' }))

    await user.click(editButton('witnesses'))
    expect(screen.getByText('I saw it.')).toBeInTheDocument()
    expect(screen.queryByText(/will be asked to approve/i)).not.toBeInTheDocument()
    await save(user)

    const { data } = mockUpdate.mock.calls[0][0]
    expect(data).toMatchObject({ medicationAdministrationId: 'med-1', shiftId: 'shift-1', shiftNoteId: 'note-1' })
    expect(data).not.toHaveProperty('witnessNames')
    expect(data).not.toHaveProperty('witnessStatements')
  })

  it('names a witness added in edit as asked after the save', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(editButton('witnesses'))
    await user.click(screen.getByRole('radio', { name: 'Someone else' }))
    await user.type(screen.getByLabelText('Name'), 'Pat Visitor')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await save(user)

    expect(mockUpdate.mock.calls[0][0].data.witnesses).toEqual([
      { id: 'w-1', witnessUserId: 'staff-2', witnessName: 'Sam Okafor' },
      { id: undefined, witnessUserId: null, witnessName: 'Pat Visitor' },
    ])
  })
})

describe('IncidentDetailPage — editing the compliance part', () => {
  it('shows the aware time in the provider zone and sends it back with the stored class on an unchanged save', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(editButton('compliance'))
    expect(screen.getByLabelText('When you became aware')).toHaveValue('2026-10-03T19:05')
    await save(user)

    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ awareAtLocal: '2026-10-03T19:05', reportableClass: 'None' })
  })

  it('asks for a reason only once the class is moved off its default, and blocks the save without one', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(editButton('compliance'))
    expect(screen.queryByLabelText(/^Reason for the change/)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Reporting deadline'))
    await user.click(screen.getByRole('option', { name: 'Within 24 hours' }))
    expect(screen.getByLabelText(/^Reason for the change/)).toHaveAttribute('aria-required', 'true')

    await save(user)
    expect(mockUpdate).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText(/^Reason for the change/), 'Family raised it as serious.')
    await save(user)
    expect(mockUpdate.mock.calls[0][0].data).toMatchObject({ reportableClass: 'Within24h', reportableClassReason: 'Family raised it as serious.' })
  })
})

// INC-04: the determination is frozen at creation — editing the practice must never silently re-run it against today's register.
describe('IncidentDetailPage — the restrictive practice determination stays frozen', () => {
  const AUTHORISED = { authorisedBy: 'Dr Chen', authorisationDate: '2026-09-01', isAuthorised: true }
  const entry = { id: 'rp-1', type: 'Seclusion', description: 'Seclusion room, acute crisis.', reviewDate: '2026-12-01', isActive: true }
  const rpIncident = (overrides: Partial<IncidentDetailDto> = {}) => incident({
    incidentType: 'RestrictivePracticeUse', restrictivePracticeType: 'Seclusion', restrictivePracticeId: 'rp-1',
    restrictivePracticeDescription: 'Seclusion room, acute crisis.', restrictivePracticeReviewDate: '2026-12-01', isRestrictivePracticeAuthorised: false,
    ...overrides,
  })
  const open = (user: ReturnType<typeof userEvent.setup>) => user.click(editButton('restrictive practice details'))

  it('shows the frozen unauthorised banner from the record, even though the register now has a matching active practice', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [{ ...entry, ...AUTHORISED }] })
    const user = userEvent.setup()
    renderPage(rpIncident())

    await open(user)

    expect(await screen.findByText(/not authorised — this may be a reportable incident/i)).toBeInTheDocument()
    expect(screen.getByText(/determined when this incident was created/i)).toBeInTheDocument()
  })

  it('ticks "This use was not authorised" for a linked incident stored unauthorised, without locking it', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [{ ...entry, authorisedBy: null, authorisationDate: null, isAuthorised: false }] })
    const user = userEvent.setup()
    renderPage(rpIncident())

    await open(user)

    const box = await screen.findByRole('checkbox', { name: 'This use was not authorised' })
    expect(box).toBeChecked()
    expect(box).toBeEnabled()
  })

  // The varied question is hidden on edit, so nothing on the step may clear its stored answer.
  it('keeps the stored varied answer when the tick is ticked and unticked, so Save still goes through', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [{ ...entry, ...AUTHORISED }] })
    const user = userEvent.setup()
    renderPage(rpIncident({ isRestrictivePracticeAuthorised: true, restrictivePracticeUseVaried: false }))

    await open(user)
    const box = await screen.findByRole('checkbox', { name: 'This use was not authorised' })
    await user.click(box)
    await user.click(box)
    await save(user)

    expect(mockUpdate).toHaveBeenCalledTimes(1)
  })

  it('shows the lowered state in the banner once "This use was not authorised" is ticked', async () => {
    mockUseRestrictivePractices.mockReturnValue({ data: [{ ...entry, ...AUTHORISED }] })
    const user = userEvent.setup()
    renderPage(rpIncident({ isRestrictivePracticeAuthorised: true }))

    await open(user)
    expect(await screen.findByText('Authorised at the time this was reported.')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'This use was not authorised' }))

    expect(screen.getByText(/not authorised — this may be a reportable incident/i)).toBeInTheDocument()
    expect(screen.getByText('Saving records this use as not authorised.')).toBeInTheDocument()
    expect(screen.queryByText('Authorised at the time this was reported.')).not.toBeInTheDocument()
  })

  // The API leaves a null flag out of the JSON, so "not determined" arrives as a missing key.
  it('shows "no determination on record" when the flag is missing from the payload', async () => {
    const { isRestrictivePracticeAuthorised: _omitted, ...withoutFlag } = rpIncident()
    void _omitted
    const user = userEvent.setup()
    renderPage(withoutFlag as IncidentDetailDto)

    await open(user)

    expect(await screen.findByText('No authorisation determination on record for this incident.')).toBeInTheDocument()
  })
})

describe('IncidentDetailPage — no edit rights', () => {
  it('a support worker sees every part and no Edit button', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    renderPage()

    expect(screen.getByRole('heading', { name: 'Witnesses' })).toBeInTheDocument()
    expect(screen.getByText('I saw it.')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /^Edit / })).toHaveLength(0)
  })
})
