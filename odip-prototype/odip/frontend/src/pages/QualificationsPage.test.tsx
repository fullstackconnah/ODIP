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
  useModuleVisibility: () => ({ data: { hiddenAccommodation: false, hiddenVehicles: false, hiddenTrips: false }, isError: false }),
  useStaff: mockUseStaff,
  useUnclaimedShifts: () => ({ count: 0, participants: 0, loading: false, error: false }),
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

// A mixed one: a soon credential and a missing screening, so "none" must outrank "soon".
const MAX = person('s6', 'Max Mixed', { isFirstAidQualified: true, firstAidExpiryDate: '2026-10-05', workerScreeningNumber: 'WWC-6', workerScreeningExpiryDate: null })

function renderList(entry = '/') {
  return render(<MemoryRouter initialEntries={[entry]}><QualificationsPage /></MemoryRouter>)
}

const staffNav = () => screen.getByRole('navigation', { name: 'Staff' })
const row = (name: string) => within(staffNav()).getByRole('link', { name: new RegExp(`^${name}`) })
const current = () => within(staffNav()).getAllByRole('link').filter(l => l.getAttribute('aria-current') === 'page')

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
  mockUseSettings.mockReturnValue({ data: { qualificationWarningDays: 30 } })
  mockUseStaff.mockReturnValue({ data: STAFF, isLoading: false })
  pinToday()
  window.scrollTo = vi.fn() // jsdom has none; a phone-width step scrolls to the top
})

afterEach(() => {
  vi.useRealTimers()
  restoreZone()
  localStorage.clear()
})

describe('QualificationsPage: the staff list', () => {
  it('lists every active staff member A to Z, with the worst state and the issue count under each name', () => {
    renderList()

    const links = within(staffNav()).getAllByRole('link')
    expect(links.map(l => l.textContent)).toEqual([
      'Dana ExpiredExpired · 5 issues',
      'Eli SoonExpiring soon · 4 issues',
      'Flo FineAll current',
      'Gus NoDateNo date set · 3 issues',
      'Ivy OneIssueNo date set · 1 issue',
    ])
  })

  it('dots each row by its worst state: expired > no date > due today > soon, and none when current', () => {
    mockUseStaff.mockReturnValue({ data: [...STAFF, MAX], isLoading: false })
    renderList()

    const dot = (name: string) => row(name).querySelector('[data-dot]')!.getAttribute('data-dot')
    expect(dot('Dana')).toBe('overdue')
    expect(dot('Eli')).toBe('soon')
    expect(dot('Flo')).toBe('ok')
    expect(dot('Gus')).toBe('none')
    expect(dot('Max')).toBe('none') // a missing screening outranks a credential that is merely expiring
    expect(row('Max').querySelector('[data-dot]')).toHaveAttribute('aria-hidden', 'true')
  })

  it('counts issues against staff in the header', () => {
    renderList()
    expect(screen.getByText('13 issues across 4 of 5 active staff')).toBeInTheDocument()
  })

  it('shows the first person without a staff param and marks exactly one row current', () => {
    renderList()
    expect(current().map(l => l.textContent)).toEqual(['Dana ExpiredExpired · 5 issues'])
    expect(screen.getByRole('heading', { level: 2, name: 'Dana Expired' })).toBeInTheDocument()
  })

  it('shows the person named in ?staff= with the status badges in the compact form', () => {
    renderList('/?staff=s2')

    expect(screen.getByRole('heading', { level: 2, name: 'Eli Soon' })).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument() // Eli's 1 Nov screening
    for (const text of ['2 days', '4 days', '10 days', '30 days']) expect(screen.getByText(text)).toBeInTheDocument()
    expect(screen.queryByText(/^Expires in/)).not.toBeInTheDocument()
  })

  it('offers an Add date for a missing date and names the credential and the person in each button', () => {
    renderList('/?staff=s4')
    expect(screen.getAllByRole('button', { name: /^Add date: .+, Gus NoDate$/ })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Add date: Worker Screening, Gus NoDate' })).toBeInTheDocument()
  })

  it('says which credentials are not held, and where to change that', () => {
    renderList('/?staff=s5')
    const line = screen.getByText(/^Not held: First Aid, CPR, Driver Licence, Manual Handling\./)
    expect(line).toHaveTextContent('Change this on the staff record.')
    expect(within(line).getByRole('link', { name: 'staff record' })).toHaveAttribute('href', '/staff/s5/edit')
  })

  it('filters by search and says so when nothing matches', () => {
    renderList()
    fireEvent.change(screen.getByLabelText('Search staff'), { target: { value: 'gus' } })
    expect(within(staffNav()).getAllByRole('link')).toHaveLength(1)

    fireEvent.change(screen.getByLabelText('Search staff'), { target: { value: 'zzz' } })
    expect(screen.getByText('No staff match “zzz”.')).toBeInTheDocument()
  })

  it('reads "10 days" for a date 10 days away, even when the clocks go forward in between (Sydney, 4 Oct)', () => {
    // In Sydney 1 Oct 00:00 to 11 Oct 00:00 is 239 hours, which the old floor(ms / 86 400 000) read as 9 days.
    if (!setZone('Australia/Sydney')) return // this runtime cannot switch zones
    pinToday()
    renderList('/?staff=s2')

    expect(screen.getByText('10 days')).toBeInTheDocument()
    expect(screen.getByText('30 days')).toBeInTheDocument() // 31 Oct
    expect(screen.getByText('Current')).toBeInTheDocument() // 1 Nov, 31 days
  })
})

describe('QualificationsPage: Needs attention', () => {
  it('counts both views and lists only people with an issue under Needs attention', () => {
    renderList()
    expect(screen.getByRole('radio', { name: 'All staff (5)' })).toBeChecked()

    fireEvent.click(screen.getByRole('radio', { name: 'Needs attention (4)' }))
    expect(within(staffNav()).getAllByRole('link')).toHaveLength(4)
    expect(within(staffNav()).queryByText('Flo Fine')).not.toBeInTheDocument()
  })

  it('opens on Needs attention for ?show=attention (the Dashboard link)', () => {
    renderList('/?show=attention')
    expect(screen.getByRole('radio', { name: 'Needs attention (4)' })).toBeChecked()
    expect(within(staffNav()).queryByText('Flo Fine')).not.toBeInTheDocument()
  })

  it('keeps the selected person in the list even when they have no issue left', () => {
    renderList('/?staff=s3&show=attention')
    expect(row('Flo')).toHaveAttribute('aria-current', 'page')
  })

  it('says all is current when nobody needs attention', () => {
    mockUseStaff.mockReturnValue({ data: [STAFF[2]], isLoading: false })
    renderList('/?show=attention')
    expect(screen.getByText('All qualifications are current')).toBeInTheDocument()
    expect(screen.getByText('No issues found within the 30-day warning window')).toBeInTheDocument()
  })
})

describe('QualificationsPage: Previous and Next', () => {
  it('steps to the next person, moves focus to their name and stops at the start', () => {
    renderList('/?staff=s1')
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    expect(screen.getByText('1 of 5')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next: Eli Soon' }))
    expect(screen.getByRole('heading', { level: 2, name: 'Eli Soon' })).toHaveFocus()
    expect(row('Eli')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('2 of 5')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Previous/ }))
    expect(screen.getByRole('heading', { level: 2, name: 'Dana Expired' })).toBeInTheDocument()
  })

  it('does not wrap: at the last person Next is disabled and reads "Next"', () => {
    renderList('/?staff=s5')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByText('5 of 5')).toBeInTheDocument()
  })

  it('steps through the filtered list', () => {
    renderList('/?staff=s2&show=attention')
    fireEvent.click(screen.getByRole('button', { name: 'Next: Gus NoDate' })) // Flo has no issue, so Next skips her
    expect(screen.getByRole('heading', { level: 2, name: 'Gus NoDate' })).toBeInTheDocument()
  })
})

describe('QualificationsPage: keyboard', () => {
  it('moves focus down the list with ArrowDown without selecting', () => {
    renderList()
    row('Dana').focus()
    fireEvent.keyDown(staffNav().querySelector('ul')!, { key: 'ArrowDown' })
    expect(row('Eli')).toHaveFocus()
    expect(row('Dana')).toHaveAttribute('aria-current', 'page')
  })
})

// STAFF-3 / STAFF-9 / CORE-6: ReadOnly is refused Settings and every staff write, so it is offered neither the Warning window link nor an edit.
describe('QualificationsPage: controls by role', () => {
  it('offers ReadOnly the list and the detail, with no Warning window link, Edit staff record, Edit or Add date', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'ReadOnly' }))
    renderList('/?staff=s5')

    expect(screen.getByText('13 issues across 4 of 5 active staff')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Previous/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Warning window/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Edit staff record/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Edit|Add date)/ })).not.toBeInTheDocument()
    expect(screen.getByText(/^Not held:/)).not.toHaveTextContent('Change this')
  })

  it.each(['Admin', 'Coordinator'])('offers %s the Warning window link, Edit staff record and inline Edit', role => {
    localStorage.setItem('odip_user', JSON.stringify({ role }))
    renderList()

    expect(screen.getByRole('link', { name: /Warning window/ })).toHaveAttribute('href', '/settings?section=alerts')
    expect(screen.getByRole('link', { name: 'Edit staff record' })).toHaveAttribute('href', '/staff/s1/edit')
    expect(screen.getAllByRole('button', { name: /^Edit: .+, Dana Expired$/ }).length).toBeGreaterThan(0)
  })
})

// The PUT rewrites the whole staff record and this page has no Active control, so the flag is read at save: a deactivation made since the page
// loaded is not undone by an expiry edit.
describe('QualificationsPage: the inline save keeps the active flag it does not show', () => {
  const openIvyEdit = () => {
    renderList('/?staff=s5')
    fireEvent.click(screen.getByRole('button', { name: /^Add date: Medication Competency, Ivy OneIssue$/ }))
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

  it('sends nothing for the person left when you move on while their record is re-read', async () => {
    let release: (v: unknown) => void = () => {}
    mockApiGet.mockReturnValue(new Promise(r => { release = r }))
    openIvyEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    fireEvent.click(row('Dana')) // a list click while the re-read is out

    release({ ...STAFF[4], isActive: false })
    await Promise.resolve()
    await new Promise(r => setTimeout(r, 0))
    expect(mockMutate).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Expiry date')).not.toBeInTheDocument()
  })

  async function holdIvyPut() {
    mockApiGet.mockResolvedValue({ ...STAFF[4] })
    openIvyEdit()
    mockPending.current = true // the mutation reports its PUT in flight from the moment Save is pressed
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1))
    return mockMutate.mock.calls[0][1]
  }

  it('holds Previous, Next and every other Edit while a save is in flight, and shows a failure under the open editor', async () => {
    const sent = await holdIvyPut()

    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    for (const b of screen.getAllByRole('button', { name: /^Edit: |^Add date: / })) expect(b).toBeDisabled()

    mockPending.current = false
    act(() => { sent.onError(); sent.onSettled() })
    expect(screen.getByLabelText('Expiry date')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save. Please try again.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
  })

  it('shows a page error, never silence, when a save fails after you moved to another person', async () => {
    const sent = await holdIvyPut()

    fireEvent.click(row('Dana')) // list clicks are allowed during a PUT
    mockPending.current = false
    act(() => { sent.onError(); sent.onSettled() })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save Medication Competency for Ivy OneIssue. Please try again.")
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('closes the editor and enables the buttons again once the PUT succeeds', async () => {
    const sent = await holdIvyPut()

    mockPending.current = false
    act(() => { sent.onSuccess(); sent.onSettled() })
    expect(screen.queryByLabelText('Expiry date')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Previous/ })).toBeEnabled()
  })

  it('falls back to the record loaded with the page when the re-read fails', async () => {
    mockApiGet.mockRejectedValue(new Error('offline'))
    openIvyEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1))
    expect(mockMutate.mock.calls[0][0].data).toEqual(expect.objectContaining({ isActive: true, medicationCompetencyExpiryDate: '2027-01-02' }))
  })

  it('saves on Enter and cancels on Escape', async () => {
    mockApiGet.mockResolvedValue({ ...STAFF[4] })
    openIvyEdit()
    fireEvent.keyDown(screen.getByLabelText('Expiry date'), { key: 'Escape' })
    expect(screen.queryByLabelText('Expiry date')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Add date: Medication Competency, Ivy OneIssue$/ }))
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2027-01-02' } })
    fireEvent.keyDown(screen.getByLabelText('Expiry date'), { key: 'Enter' })
    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1))
  })

  it('discards an unsaved typed date when you change person', () => {
    openIvyEdit()
    fireEvent.click(row('Dana'))
    expect(screen.queryByLabelText('Expiry date')).not.toBeInTheDocument()
    fireEvent.click(row('Ivy'))
    expect(screen.queryByLabelText('Expiry date')).not.toBeInTheDocument()
  })
})

// A half-typed date reads back as '' from the input, so it must never reach the PUT as a "clear".
describe('QualificationsPage: what the date field saves', () => {
  beforeEach(() => { mockMutate.mockReset(); mockApiGet.mockReset(); mockPending.current = false })

  it('disables Save and says "Enter a full date." while the date is half typed, and sends nothing', () => {
    renderList('/?staff=s5')
    fireEvent.click(screen.getByRole('button', { name: /^Add date: Medication Competency/ }))
    const input = screen.getByLabelText('Expiry date')
    fireEvent.change(input, { target: { value: '2027-01-02' } }) // then the field is cleared part-way, which the input reports as ''
    Object.defineProperty(input, 'validity', { value: { badInput: true }, configurable: true })
    fireEvent.change(input, { target: { value: '' } })

    expect(screen.getByText('Enter a full date.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockApiGet).not.toHaveBeenCalled()
    expect(mockMutate).not.toHaveBeenCalled()
  })

  // OPEN-3: a blank Save clears the date. The client sends the field absent (JSON drops it), and the server's PUT assigns every expiry field from
  // the body without a null check (VehiclesStaffController.Update), so an absent date is stored as null.
  it('sends a blank date as absent, so the stored date is cleared', async () => {
    const cleo = person('s9', 'Cleo Pulse', { isCprQualified: true, cprExpiryDate: '2026-08-22' })
    mockUseStaff.mockReturnValue({ data: [cleo], isLoading: false })
    mockApiGet.mockResolvedValue(cleo)
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Edit: CPR, Cleo Pulse' }))
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1))
    const data = mockMutate.mock.calls[0][0].data
    expect(Object.keys(data)).toContain('cprExpiryDate')
    expect(data.cprExpiryDate).toBeUndefined()
    expect(JSON.parse(JSON.stringify(data))).not.toHaveProperty('cprExpiryDate')
  })
})

describe('QualificationsPage and the Dashboard agree', () => {
  it('the Dashboard\'s Qualification issues figure is the sum of the list\'s issue counts', () => {
    const { unmount } = renderList()
    const listTotal = within(staffNav()).getAllByRole('link').reduce((sum, el) => sum + Number.parseInt(el.textContent!.split(' · ')[1] ?? '0', 10), 0)
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

describe('QualificationsPage: CPR', () => {
  beforeEach(() => { mockMutate.mockReset(); mockApiGet.mockReset(); mockPending.current = false })

  it('shows an expired CPR as its own row, and its Edit saves cprExpiryDate', async () => {
    const cleo = person('s9', 'Cleo Pulse', { isCprQualified: true, cprExpiryDate: '2026-08-22' })
    mockUseStaff.mockReturnValue({ data: [cleo], isLoading: false })
    mockApiGet.mockResolvedValue(cleo)
    renderList()

    fireEvent.click(screen.getByRole('button', { name: 'Edit: CPR, Cleo Pulse' }))
    fireEvent.change(screen.getByLabelText('Expiry date'), { target: { value: '2027-08-22' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mockMutate).toHaveBeenCalledTimes(1))
    expect(mockMutate.mock.calls[0][0]).toEqual({ id: 's9', data: expect.objectContaining({ isCprQualified: true, cprExpiryDate: '2027-08-22' }) })
  })
})

