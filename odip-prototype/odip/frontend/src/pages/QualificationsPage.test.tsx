import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import QualificationsPage from './QualificationsPage'
import DashboardPage from './DashboardPage'
import { restoreZone, setZone } from '@/test/timeZone'

const { mockUseStaff, mockUseSettings } = vi.hoisted(() => ({
  mockUseStaff: vi.fn(),
  mockUseSettings: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useStaff: mockUseStaff,
  useSettings: mockUseSettings,
  useUpdateStaff: () => ({ mutate: vi.fn(), isPending: false }),
  useDashboard: () => ({ data: undefined, isLoading: false, isError: false }),
  useParticipantAlertsAggregate: () => ({ data: [], isLoading: false }),
  usePendingLeaveCount: () => 0,
}))

// Today is Thu 1 Oct 2026, 03:40 on the wall clock of whatever zone is set. The dates below are offsets from it.
function pinToday() {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 1, 3, 40))
}

const person = (id: string, fullName: string, o: Record<string, unknown> = {}) => ({
  id, fullName, isFirstAidQualified: false, isDriverEligible: false, isManualHandlingCompetent: false, isMedicationCompetent: false,
  firstAidExpiryDate: null, driverLicenceExpiryDate: null, manualHandlingExpiryDate: null, medicationCompetencyExpiryDate: null,
  workerScreeningNumber: null, workerScreeningExpiryDate: null, ...o,
})

// 12 issues in all: Dana 5, Eli 4, Gus 2 (his worker screening number has no date, so it is not a credential), Ivy 1. Flo is fine.
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
  person('s4', 'Gus NoDate', { isFirstAidQualified: true, isMedicationCompetent: true, workerScreeningNumber: 'WWC-9' }),
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
    expect(badges).toEqual(['5 issues', '4 issues', '2 issues', '1 issue'])
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
    expect(screen.getAllByText('Current')).toHaveLength(1)
    expect(screen.getAllByText('No date set')).toHaveLength(3)
  })

  it('counts a credential due today under Expiring Soon, and the last day of the window as soon', () => {
    renderList()

    const tabs = screen.getAllByRole('tab').map(t => t.textContent)
    expect(tabs).toEqual(['All Issues (4)', 'Expired (1)', 'Expiring Soon (2)', 'No Date Set (2)'])
  })

  it('filters to the staff with a credential in that state', () => {
    renderList()

    fireEvent.click(screen.getByRole('tab', { name: /No Date Set/ }))
    expect(screen.getByText('Gus NoDate')).toBeInTheDocument()
    expect(screen.getByText('Ivy OneIssue')).toBeInTheDocument()
    expect(screen.queryByText('Dana Expired')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /Expiring Soon/ }))
    expect(screen.getByText('Dana Expired')).toBeInTheDocument() // due today and in 1 day
    expect(screen.getByText('Eli Soon')).toBeInTheDocument()
    expect(screen.queryByText('Gus NoDate')).not.toBeInTheDocument()
  })

  it('does not treat a worker screening number with no expiry date as a credential', () => {
    renderList()
    expandAll()

    const gus = screen.getByText('Gus NoDate').closest('div.overflow-hidden') as HTMLElement
    expect(within(gus).getByText('First Aid')).toBeInTheDocument()
    expect(within(gus).getByText('Medication Competency')).toBeInTheDocument()
    expect(within(gus).queryByText('Worker Screening')).not.toBeInTheDocument()
  })

  it('reads "10 days" for a date 10 days away, even when the clocks go forward in between (Sydney, 4 Oct)', () => {
    // In Sydney 1 Oct 00:00 to 11 Oct 00:00 is 239 hours, which the old floor(ms / 86 400 000) read as 9 days.
    if (!setZone('Australia/Sydney')) return // this runtime cannot switch zones
    pinToday() // the local parts of "today" are built in Sydney, so the local day is the 1st there
    renderList()
    expandAll()

    expect(screen.getByText('10 days')).toBeInTheDocument()
    expect(screen.getByText('30 days')).toBeInTheDocument() // 31 Oct
    expect(screen.getByText('Current')).toBeInTheDocument() // 1 Nov, 31 days: it was "30 days" when the day count lost an hour
  })
})

describe('QualificationsPage and the Dashboard agree', () => {
  it('the Dashboard\'s Qualification Issues figure is the sum of the list\'s issue counts', () => {
    const { unmount } = renderList()
    const listTotal = screen.getAllByText(/^\d+ issues?$/).reduce((sum, el) => sum + Number.parseInt(el.textContent!, 10), 0)
    unmount()

    render(<MemoryRouter><DashboardPage /></MemoryRouter>)
    const band = screen.getByRole('region', { name: 'Needs attention' })
    const tile = [...band.firstElementChild!.children].find(el => el.querySelector('span')?.textContent === 'Qualification Issues') as HTMLElement

    expect(listTotal).toBe(12)
    expect(tile.querySelector('.text-display')!.textContent).toBe(String(listTotal))
  })
})
