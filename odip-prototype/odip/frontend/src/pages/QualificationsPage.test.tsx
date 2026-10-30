import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import QualificationsPage from './QualificationsPage'
import DashboardPage from './DashboardPage'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseStaff, mockUseSettings, providerSettings, mockMutate, mockApiGet, mockPending } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockPending: { current: false }, // what the page-wide mutation reports while any PUT is in flight
  mockApiGet: vi.fn(),
  mockUseStaff: vi.fn(),
  mockUseSettings: vi.fn(),
  providerSettings: { current: undefined as { employmentHeroConnected?: boolean } | undefined },
}))

vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet: mockApiGet }))
vi.mock('./dashboard/useDecisionGroups', () => ({ useDecisionGroups: () => [] }))
vi.mock('@/api/hooks', () => ({
  useModuleVisibility: () => ({ data: { hiddenAccommodation: false, hiddenVehicles: false }, isError: false }),
  useStaff: mockUseStaff,
  useSettings: mockUseSettings,
  useUpdateStaff: () => ({ mutate: mockMutate, isPending: mockPending.current }),
  useProviderSettings: () => ({ data: providerSettings.current }),
  // A finished organisation long ago: the Dashboard shows no setup card, whatever the role.
  useSetupStatus: () => ({
    data: { staffCount: 20, participantCount: 40, participantsWithPlanCount: 40, firstPublishedWeekStart: '2020-01-06', hasInvoice: true, employmentHeroAvailable: false },
    isPending: false, isError: false, isFetching: false, fetchStatus: 'idle', errorUpdateCount: 0,
  }),
  // The dashboard's own request, answered with a real summary of zeros (the page no longer makes one up).
  useDashboard: () => ({
    data: {
      upcomingTripCount: 0, activeParticipantCount: 0, outstandingTaskCount: 0, overdueTaskCount: 0, conflictCount: 0,
      tripsMissingAccommodation: 0, tripsMissingVehicles: 0, tripsMissingStaff: 0, openIncidentCount: 0, qscOverdueCount: 0,
      upcomingTrips: [],
    },
    isPending: false, isLoading: false, isError: false,
  }),
  useParticipantAlertsAggregate: () => ({ data: [], isLoading: false }),
  usePendingLeaveQueue: () => ({ count: 0, loading: false, error: false }),
  usePendingCompletionQueue: () => ({ count: 0, loading: false, error: false }),
}))

// Today is Thu 1 Oct 2026, 03:40 on the wall clock of whatever zone is set. The dates below are offsets from it.
function pinToday() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 1, 3, 40))
}

const person = (id: string, fullName: string, o: Record<string, unknown> = {}) => ({
  id, fullName, isActive: true, isFirstAidQualified: false, isDriverEligible: false, isManualHandlingCompetent: false, isMedicationCompetent: false,
  firstAidExpiryDate: null, driverLicenceExpiryDate: null, manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null,
  workerScreeningNumber: null, workerScreeningExpiryDate: '2099-01-01', ...o, // current by default: a missing screening is its own issue
})

// 13 issues in all: Dana 5, Eli 4, Gus 3 (his worker screening has a number but no date, so it is missing), Ivy 1. Flo is fine.
const STAFF = [
  person('s1', 'Dana Expired', {
    isFirstAidQualified: true, firstAidExpiryDate: '2026-08-22', // expired
    isDriverEligible: true, driverLicenceExpiryDate: '2026-09-30', // expired yesterday
    isManualHandlingCompetent: true, manualHandlingExpiryDate: '2026-10-01', // today
    isMedicationCompetent: true, medicationCompetencyExpiryDate: '2026-10-02', // 1 day
    workerScreeningNumber: 'WWC-1', workerScreeningExpiryDate: '2026-09-21', // expired
  }),
  person('s2', 'Eli Soon', {
    isFirstAidQualified: true, firstAidExpiryDate: '2026-10-03', // 2 days
    isDriverEligible: true, driverLicenceExpiryDate: '2026-10-05', // 4 days
    isManualHandlingCompetent: true, manualHandlingExpiryDate: '2026-10-11', // 10 days
    isMedicationCompetent: true, medicationCompetencyExpiryDate: '2026-10-31', // 30 days: the last day of the window
    workerScreeningNumber: 'WWC-2', workerScreeningExpiryDate: '2026-11-01', // 31 days: current
  }),
  person('s3', 'Flo Fine', { isFirstAidQualified: true, firstAidExpiryDate: '2028-01-01' }),
  person('s4', 'Gus NoDate', { isFirstAidQualified: true, isMedicationCompetent: true, workerScreeningNumber: 'WWC-9', workerScreeningExpiryDate: null }),
  person('s5', 'Ivy OneIssue', { isMedicationCompetent: true }),
]

function renderList() {
  return render(<MemoryRouter><QualificationsPage /></MemoryRouter>)
}

function expandAll() {
  for (const name of ['Dana Expired', 'Eli Soon', 'Gus NoDate', 'Ivy OneIssue']) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }))
  }
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  mockUseSettings.mockReturnValue({ data: { qualificationWarningDays: 30 } })
  mockUseStaff.mockReturnValue({ data: STAFF, isLoading: false })
  pinToday()
})

afterEach(() => {
  vi.useRealTimers()
  restoreZone()
  localStorage.clear()
})

describe('QualificationsPage: the list', () => {
  it('lists each staff member with an issue, most issues first, with a count that agrees with its noun', () => {
    renderList()

    const badges = screen.getAllByText(/^\d+ issues?$/).map(el => el.textContent)
    expect(badges).toEqual(['5 issues', '4 issues', '3 issues', '1 issue'])
    expect(screen.queryByText('Flo Fine')).not.toBeInTheDocument()
  })

  // The status cell is the compact form (a narrow table cell; each row is a wrapping card on a phone): "10 days", with "Expires in" left to the
  // Credentials tab, which has the room.
  it('spells every status in words and in sentence case, in the compact form', () => {
    renderList()
    expandAll()

    expect(screen.getAllByText('Expired')).toHaveLength(3)
    expect(screen.queryByText('EXPIRED')).not.toBeInTheDocument()
    expect(screen.getAllByText('Expires today')).toHaveLength(1)
    for (const text of ['1 day', '2 days', '4 days', '10 days', '30 days']) {
      expect(screen.getAllByText(text)).toHaveLength(1)
    }
    expect(screen.queryByText(/^Expires in/)).not.toBeInTheDocument()
    expect(screen.getAllByText('Current')).toHaveLength(2) // Eli's 1 Nov screening and Ivy's default current one
    expect(screen.getAllByText('No date set')).toHaveLength(4)
  })

  it('counts a credential due today under Expiring within 30 days, and the last day of the window as soon', () => {
    renderList()

    const tabs = screen.getAllByRole('tab').map(t => t.textContent)
    expect(tabs).toEqual(['All issues (4)', 'Expired (1)', 'Expiring within 30 days (2)', 'No date set (2)'])
  })

  it('filters to the staff with a credential in that state', () => {
    renderList()

    fireEvent.click(screen.getByRole('tab', { name: /No date set/ }))
    expect(screen.getByText('Gus NoDate')).toBeInTheDocument()
    expect(screen.getByText('Ivy OneIssue')).toBeInTheDocument()
    expect(screen.queryByText('Dana Expired')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Expiring within/ }))
    expect(screen.getByText('Dana Expired')).toBeInTheDocument() // due today and in 1 day
    expect(screen.getByText('Eli Soon')).toBeInTheDocument()
    expect(screen.queryByText('Gus NoDate')).not.toBeInTheDocument()
  })

  it('counts an active person with a screening number but no expiry date as missing a screening', () => {
    renderList()
    expandAll()

    const gus = screen.getByText('Gus NoDate').closest('div.overflow-hidden') as HTMLElement
    expect(within(gus).getByText('First Aid')).toBeInTheDocument()
    expect(within(gus).getByText('Medication Competency')).toBeInTheDocument()
    expect(within(gus).getByText('Worker Screening')).toBeInTheDocument()
  })

  it('reads "10 days" for a date 10 days away, even when the clocks go forward in between (Sydney, 4 Oct)', () => {
    // In Sydney 1 Oct 00:00 to 11 Oct 00:00 is 239 hours, which the old floor(ms / 86 400 000) read as 9 days.
    if (!setZone('Australia/Sydney')) return // this runtime cannot switch zones
    pinToday() // the local parts of "today" are built in Sydney, so the local day is the 1st there
    renderList()
    expandAll()

    expect(screen.getByText('10 days')).toBeInTheDocument()
    expect(screen.getByText('30 days')).toBeInTheDocument() // 31 Oct
    expect(screen.getAllByText('Current').length).toBeGreaterThan(0) // 1 Nov, 31 days: it was "30 days" when the day count lost an hour
  })
})

describe('QualificationsPage and the Dashboard agree', () => {
  it('the Dashboard\'s Qualification issues figure is the sum of the list\'s issue counts', () => {
    const { unmount } = renderList()
    const listTotal = screen.getAllByText(/^\d+ issues?$/).reduce((sum, el) => sum + Number.parseInt(el.textContent!, 10), 0)
    unmount()

    // A Coordinator now updates these in the Staff compliance group (the same sum); the tile is a SuperAdmin's with no organisation (SHAPE call 6).
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SuperAdmin' }))
    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    // With issues, Qualification issues is a tall tile: a named group ("Qualification issues 13") whose figure is the count.
    const tile = within(screen.getByRole('region', { name: 'Alerts' })).getByRole('group', { name: /^Qualification issues \d+$/ })

    expect(listTotal).toBe(13)
    expect(tile.querySelector('.text-display')!.textContent).toBe(String(listTotal))
  })
})

// STAFF-3 / STAFF-9 / CORE-6: ReadOnly is refused Settings and every staff write, so it is offered neither the Warning window link nor an edit.
describe('QualificationsPage: controls by role', () => {
  it('offers ReadOnly the list, with no Warning window link, pencil or inline Edit', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    renderList()
    expandAll()

    expect(screen.getByText('13 issues across 4 active staff')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Warning window/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Edit / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit/i })).not.toBeInTheDocument()
  })

  it.each(['Admin', 'Coordinator'])('offers %s the Warning window link, the pencil and inline Edit', role => {
    localStorage.setItem('odip_user', JSON.stringify({ role }))
    renderList()
    expandAll()

    expect(screen.getByRole('link', { name: /Warning window/ })).toHaveAttribute('href', '/settings?section=alerts')
    expect(screen.getByRole('link', { name: 'Edit Dana Expired' })).toBeInTheDocument()
    // Every row has an inline Edit, so its name carries the row's credential and person.
    expect(screen.getAllByRole('button', { name: /^Edit: .+, Dana Expired$/ }).length).toBeGreaterThan(0)
  })
})

// The PUT rewrites the whole staff record and this page has no Active control, so the flag is read at save: a deactivation made since the page
// loaded is not undone by an expiry edit.
describe('QualificationsPage: the inline save keeps the active flag it does not show', () => {
  const openIvyEdit = () => {
    renderList()
    expandAll()
    fireEvent.click(screen.getByRole('button', { name: /^Edit: Medication Competency, Ivy OneIssue$/ }))
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2027-01-02' } })
  }
  beforeEach(() => { mockMutate.mockReset(); mockApiGet.mockReset(); mockPending.current = false })

  it('disables Save with its pending label while the record is re-read, and sends no PUT until it answers', async () => {
    let release: (v: unknown) => void = () => {}
    mockApiGet.mockReturnValue(new Promise(r => { release = r }))
    openIvyEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(mockApiGet).toHaveBeenCalledWith('/staff/s5')
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(mockMutate).not.toHaveBeenCalled()

    release({ ...STAFF[4], isActive: false })
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1))
    expect(mockMutate.mock.calls[0][0]).toEqual({ id: 's5', data: expect.objectContaining({ isActive: false, medicationCompetencyExpiryDate: '2027-01-02' }) })
  })

  it('sends nothing when Cancel is pressed while the record is re-read', async () => {
    let release: (v: unknown) => void = () => {}
    mockApiGet.mockReturnValue(new Promise(r => { release = r }))
    openIvyEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Expiry date')).not.toBeInTheDocument()

    release({ ...STAFF[4], isActive: false })
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 0))
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('sends nothing for row A, and leaves the editor of row B open, when B is opened while A is re-read', async () => {
    let release: (v: unknown) => void = () => {}
    mockApiGet.mockReturnValue(new Promise(r => { release = r }))
    openIvyEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(screen.getAllByRole('button', { name: /^Edit: .+, (?!Ivy OneIssue$)/ })[0])
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled() // A's pending re-read does not hold B's Save

    release({ ...STAFF[4], isActive: false })
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 0))
    expect(mockMutate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Expiry date')).toBeInTheDocument()
  })

  // Row A's PUT is sent and held. Returns the callbacks A's PUT was sent with.
  async function holdIvyPut() {
    mockApiGet.mockResolvedValue({ ...STAFF[4] })
    openIvyEdit()
    mockPending.current = true // the mutation reports its PUT in flight from the moment Save is pressed
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled() // A's own row says so
    return mockMutate.mock.calls[0][1]
  }
  const otherRowEdit = () => screen.getAllByRole('button', { name: /^Edit: .+, (?!Ivy OneIssue$)/ })[0]

  it('holds the Edit of every other row while the PUT of row A is in flight, and shows its failure under the open editor of A', async () => {
    const sent = await holdIvyPut()
    expect(otherRowEdit()).toBeDisabled()
    fireEvent.click(otherRowEdit())
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeInTheDocument() // still A's editor: the click opened nothing

    mockPending.current = false
    act(() => { sent.onError(); sent.onSettled() })
    expect(screen.getByLabelText('Expiry date')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save. Please try again.')
  })

  it('disables Cancel on the row whose PUT is in flight, and shows its failure under that editor', async () => {
    const sent = await holdIvyPut()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    mockPending.current = false
    act(() => { sent.onError(); sent.onSettled() })
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save. Please try again.')
  })

  it('enables the Edit of other rows again once the PUT of row A succeeds', async () => {
    const sent = await holdIvyPut()
    mockPending.current = false
    act(() => { sent.onSuccess(); sent.onSettled() })
    expect(otherRowEdit()).toBeEnabled()
  })

  it('falls back to the record loaded with the page when the re-read fails', async () => {
    mockApiGet.mockRejectedValue(new Error('offline'))
    openIvyEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1))
    expect(mockMutate.mock.calls[0][0].data).toEqual(expect.objectContaining({ isActive: true, medicationCompetencyExpiryDate: '2027-01-02' }))
  })
})

describe('QualificationsPage — staff from Employment Hero', () => {
  afterEach(() => { providerSettings.current = undefined; localStorage.clear() })

  it('has no New staff member action on the empty page when staff come from Employment Hero', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
    providerSettings.current = { employmentHeroConnected: true }
    mockUseStaff.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() })
    mockUseSettings.mockReturnValue({ data: { qualificationWarningDays: 30 } })
    render(<MemoryRouter><QualificationsPage /></MemoryRouter>)
    expect(screen.getByText('No staff members yet')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'New staff member' })).toBeNull()
  })
})
