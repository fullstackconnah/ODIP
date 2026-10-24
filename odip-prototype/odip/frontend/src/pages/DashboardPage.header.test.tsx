import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, fireEvent, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import { restoreZone, setZone } from '@/test/timeZone'
import { mockUseDashboard, mockUseStaff, mockUseParticipantAlertsAggregate } from './dashboard/dashboardHookMocks'
import { installDashboardDefaults, renderPage, summaryData, asRole, tileFor, clearRow } from './dashboard/dashboardTestKit'

vi.mock('@/api/hooks', async () => (await import('./dashboard/dashboardHookMocks')).hooks)
vi.mock('./dashboard/useDecisionGroups', async () => ({ useDecisionGroups: (await import('./dashboard/dashboardHookMocks')).mockUseDecisionGroups }))

installDashboardDefaults()

describe('DashboardPage — header (a greeting, the date and the summary line)', () => {
  // Pins "now" without stopping the timers (the clock is the only thing these tests move).
  const pinTo = (when: Date) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(when)
  }
  const heading = () => screen.getByRole('heading', { level: 1 })

  afterEach(() => {
    vi.useRealTimers()
    restoreZone()
    document.title = ''
  })

  it('greets the signed-in user by first name and time of day with today\'s date after it, all in the one h1 at the display step', () => {
    pinTo(new Date(2026, 9, 2, 9, 30))
    asRole('Coordinator', 'Sarah Mitchell')
    renderPage()

    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('Good morning, Sarah Friday 2 October')
    // The display step (28px, Plus Jakarta Sans 800), not the default 20px page title.
    expect(h1s[0]).toHaveClass('text-display')
    expect(h1s[0]).not.toHaveClass('text-xl')
    // The old title is gone from the page; it names the tab instead.
    expect(screen.queryByText('Management Dashboard')).not.toBeInTheDocument()
  })

  it.each([
    [0, 5, 'Good morning'],
    [11, 59, 'Good morning'],
    [12, 0, 'Good afternoon'],
    [17, 59, 'Good afternoon'],
    [18, 0, 'Good evening'],
    [23, 59, 'Good evening'],
  ])('says "%s:%s" is "%s"', (hour, minute, expected) => {
    pinTo(new Date(2026, 9, 2, hour, minute))
    asRole('Coordinator', 'Sarah Mitchell')
    renderPage()

    expect(heading()).toHaveTextContent(`${expected}, Sarah`)
  })

  it('uses the first name only: the rest of the full name is not in the heading', () => {
    pinTo(new Date(2026, 9, 2, 14, 0))
    asRole('Admin', 'Callum Radford')
    renderPage()

    expect(heading()).toHaveTextContent('Good afternoon, Callum Friday 2 October')
    expect(heading()).not.toHaveTextContent('Radford')
  })

  it('greets without a comma or an invented name when the sign-in carries none', () => {
    pinTo(new Date(2026, 9, 2, 9, 30))
    asRole('Coordinator')
    renderPage()

    expect(heading()).toHaveTextContent('Good morning Friday 2 October')
    expect(heading().textContent).not.toMatch(/,/)
  })

  // 2026-10-01 23:30 UTC is Friday 9:30 am in Sydney (UTC+10) and still Thursday evening in UTC: the heading follows the wall clock the viewer is looking at,
  // the greeting and the date together, never the UTC date (still yesterday until 10:00 or 11:00 in Sydney).
  it('reads the greeting and the date from the viewer\'s wall clock, never the UTC date', () => {
    pinTo(new Date('2026-10-01T23:30:00Z'))
    asRole('Coordinator', 'Sarah Mitchell')

    if (!setZone('Australia/Sydney')) return // this runtime cannot switch zones
    const sydney = renderPage()
    expect(heading()).toHaveTextContent('Good morning, Sarah Friday 2 October')
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-10-02')
    sydney.unmount()

    setZone('UTC')
    renderPage()
    expect(heading()).toHaveTextContent('Good evening, Sarah Thursday 1 October')
    expect(document.querySelector('time')).toHaveAttribute('datetime', '2026-10-01')
  })

  it('holds the date across the Sydney clock change (Sunday 4 October, 02:00 becomes 03:00)', () => {
    if (!setZone('Australia/Sydney')) return
    asRole('Coordinator', 'Sarah Mitchell')

    pinTo(new Date('2026-10-03T15:59:00Z')) // 01:59 AEST
    const before = renderPage()
    expect(heading()).toHaveTextContent('Good morning, Sarah Sunday 4 October')
    before.unmount()

    pinTo(new Date('2026-10-03T16:30:00Z')) // 03:30 AEDT, the same morning
    renderPage()
    expect(heading()).toHaveTextContent('Good morning, Sarah Sunday 4 October')
  })

  it('sets the date in a time element in the muted ink at the same size, after the greeting', () => {
    pinTo(new Date(2026, 9, 2, 9, 30))
    asRole('Coordinator', 'Sarah Mitchell')
    renderPage()

    const time = document.querySelector('time') as HTMLElement
    expect(time).toHaveTextContent('Friday 2 October')
    expect(time).toHaveAttribute('datetime', '2026-10-02')
    expect(heading()).toContainElement(time)
    expect(time.parentElement).toHaveClass('text-[var(--color-muted-foreground)]')
    expect(time.parentElement!.className).not.toMatch(/\btext-(?:xs|sm|base|lg|xl|[2-9]xl|display)\b/)
    expect(screen.getByText('Good morning, Sarah').compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the tab named "Management Dashboard" while the heading is the greeting', () => {
    pinTo(new Date(2026, 9, 2, 9, 30))
    asRole('Coordinator', 'Sarah Mitchell')
    renderPage()

    expect(document.title).toBe('Bunya Support · Management Dashboard')
    expect(heading()).toHaveTextContent('Good morning, Sarah')
  })

  it('moves on with the clock: a page left open since the morning says good afternoon without a reload, and the tab name does not move', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 2, 11, 59, 30))
    asRole('Coordinator', 'Sarah Mitchell')
    renderPage()
    expect(heading()).toHaveTextContent('Good morning, Sarah Friday 2 October')

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(heading()).toHaveTextContent('Good afternoon, Sarah Friday 2 October')
    expect(document.title).toBe('Bunya Support · Management Dashboard')

    act(() => {
      vi.advanceTimersByTime(12 * 60 * 60_000) // past midnight
    })
    expect(heading()).toHaveTextContent('Good morning, Sarah Saturday 3 October')
  })

  it('replaces the generic subtitle with one quiet line of the everyday counts, in the meta row, joined by middots', () => {
    mockUseDashboard.mockReturnValue(summaryData({ upcomingTripCount: 3, activeParticipantCount: 5, outstandingTaskCount: 4 }))
    renderPage()

    expect(screen.queryByText(/Centralized overview/)).not.toBeInTheDocument()
    const items = ['3 upcoming trips', '5 active participants', '4 outstanding tasks'].map((text) => screen.getByText(text))
    // Tabular figures, so the line does not jitter as the counts change.
    for (const item of items) expect(item).toHaveClass('tabular-nums')
    const row = items[0].parentElement!.parentElement as HTMLElement
    expect(row).toHaveTextContent('3 upcoming trips·5 active participants·4 outstanding tasks')
    // The meta row sits under the title, in the same header block.
    expect(row.parentElement).toHaveClass('text-[13px]', 'text-[var(--color-muted-foreground)]')
    expect(row.parentElement!.parentElement).toContainElement(screen.getByRole('heading', { level: 1 }))
  })

  it.each([
    [1, 1, 1, ['1 upcoming trip', '1 active participant', '1 outstanding task']],
    [0, 0, 0, ['0 upcoming trips', '0 active participants', '0 outstanding tasks']],
    [2, 12, 101, ['2 upcoming trips', '12 active participants', '101 outstanding tasks']],
  ])('agrees the noun with the count (%i, %i, %i)', (trips, participants, tasks, expected) => {
    mockUseDashboard.mockReturnValue(summaryData({ upcomingTripCount: trips, activeParticipantCount: participants, outstandingTaskCount: tasks }))
    renderPage()

    for (const text of expected) expect(screen.getByText(text)).toBeInTheDocument()
  })

  it('no longer gives the everyday counts a tile each: they are context, not something to act on', () => {
    mockUseDashboard.mockReturnValue(summaryData({ upcomingTripCount: 3, activeParticipantCount: 5, outstandingTaskCount: 4 }))
    renderPage()

    // "Upcoming trips" is now only the section heading; the other two labels are gone.
    expect(screen.getAllByRole('heading', { level: 2, name: 'Upcoming trips' })).toHaveLength(1)
    expect(screen.queryByText('Active Participants')).not.toBeInTheDocument()
    expect(screen.queryByText('Outstanding Tasks')).not.toBeInTheDocument()
  })
})

// The page says what day it is (the title's date rolls at midnight), so its day-dependent figure must roll with it: a credential whose warning window opens today is
// counted today, not whenever the staff list happens to change.
describe('DashboardPage — the qualification count follows the day', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('recounts when the day turns over with no new staff data: a window that opens at midnight is counted at midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 30, 23, 59, 30)) // 30 Sep 2026, 23:59:30 on the wall clock, whatever the zone
    asRole('SuperAdmin', 'Sarah Mitchell')
    // First Aid expires on 31 Oct: 31 days away on 30 Sep (outside the 30-day window), 30 days away from 1 Oct (inside it, so an issue).
    const staff = { data: [{ isFirstAidQualified: true, firstAidExpiryDate: '2026-10-31' }] }
    mockUseStaff.mockReturnValue(staff) // the same object, so the same array, on every render: only the day can change the count
    renderPage()

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Wednesday 30 September')
    expect(screen.queryByRole('group', { name: /Qualification issues/ })).not.toBeInTheDocument()
    expect(screen.getByText('All clear. Nothing needs you right now.')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60_000) // 00:00:30 on 1 Oct
    })

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Thursday 1 October')
    expect(screen.getByRole('group', { name: 'Qualification issues 1' })).toBeInTheDocument()
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
  })

  it('does not recount on an ordinary minute: the staff list is walked once a day, not once a minute', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 30, 10, 0, 30))
    asRole('SuperAdmin', 'Sarah Mitchell')
    const staff = { data: [{ isFirstAidQualified: true, firstAidExpiryDate: '2026-10-31' }] }
    mockUseStaff.mockReturnValue(staff)
    renderPage()
    expect(screen.queryByRole('group', { name: /Qualification issues/ })).not.toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(5 * 60_000)
    })

    expect(screen.queryByRole('group', { name: /Qualification issues/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Wednesday 30 September')
  })
})

describe('DashboardPage — loading and error keep their behaviour', () => {
  // "The first thing you see when you log in": the greeting and the date need no data (the clock and the sign-in are enough), so they do not wait for the summary.
  it('shows the greeting and the date above the spinner while the summary loads: the personality arrives first, with no counts line and no band', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 2, 9, 30))
    asRole('Coordinator', 'Sarah Mitchell')
    mockUseDashboard.mockReturnValue({ data: undefined, isPending: true, isLoading: true, isError: false })
    const { container } = renderPage()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('Good morning, Sarah Friday 2 October')
    expect(h1s[0]).toHaveClass('text-display')
    expect(document.title).toBe('Bunya Support · Management Dashboard')
    // The counts are data: no line of them, and no band, until the summary arrives.
    expect(screen.queryByText(/upcoming trip/)).not.toBeInTheDocument()
    expect(screen.queryByText(/active participant/)).not.toBeInTheDocument()
    expect(screen.queryByText(/outstanding task/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Alerts' })).not.toBeInTheDocument()
    // The spinner sits UNDER the heading, in the page's own column.
    expect(h1s[0].compareDocumentPosition(container.querySelector('.animate-spin')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    vi.useRealTimers()
  })

  it('keeps the heading steady when the summary lands: the same greeting, now with the counts and the band', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 2, 9, 30))
    asRole('SuperAdmin', 'Sarah Mitchell')
    mockUseDashboard.mockReturnValue({ data: undefined, isPending: true, isLoading: true, isError: false })
    const { rerender } = renderPage()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good morning, Sarah Friday 2 October')

    mockUseDashboard.mockReturnValue(summaryData({ upcomingTripCount: 3, overdueTaskCount: 1 }))
    rerender(<MemoryRouter><DashboardPage /></MemoryRouter>)

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good morning, Sarah Friday 2 October')
    expect(screen.getByText('3 upcoming trips')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Alerts' })).toBeInTheDocument()
    expect(document.querySelector('.animate-spin')).toBeNull()
    vi.useRealTimers()
  })

  it('shows the house error in the Alerts slot with a working Try again, not a band of zeros, when the summary fails', () => {
    const refetch = vi.fn()
    mockUseDashboard.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    renderPage()

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this dashboard summary.")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
    expect(screen.queryByRole('region', { name: 'Alerts' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Alerts' }).compareDocumentPosition(screen.getByRole('alert')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

// TanStack Query PAUSES a request while the browser reports offline: the query is pending with a fetchStatus of "paused" and isLoading is false. The real hooks are
// exercised in DashboardPage.offline.test.tsx; here the page is given exactly what they return in that state.
describe('DashboardPage — a paused request is waiting, not a settled zero', () => {
  const paused = { data: undefined, isPending: true, isLoading: false, isError: false, fetchStatus: 'paused' }
  const disabled = { data: undefined, isPending: true, isLoading: false, isError: false, fetchStatus: 'idle' }

  it('shows the spinner under the greeting, and no band and no zeros, while the summary is paused', () => {
    asRole('Coordinator', 'Sarah Mitchell')
    mockUseDashboard.mockReturnValue(paused)
    const { container } = renderPage()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sarah')
    expect(screen.queryByRole('region', { name: 'Alerts' })).not.toBeInTheDocument()
    expect(screen.queryByText(/All clear/)).not.toBeInTheDocument()
  })

  it('shows the spinner, not a made-up summary of zeros, for a result that has no data and no reason', () => {
    mockUseDashboard.mockReturnValue({ data: undefined, isPending: false, isLoading: false, isError: false })
    const { container } = renderPage()

    expect(container.querySelector('.animate-spin')).not.toBeNull()
    expect(screen.queryByRole('region', { name: 'Alerts' })).not.toBeInTheDocument()
  })

  it('shows an en dash, busy, on Qualification issues and Critical participant alerts while their requests are paused, and never names them clear', () => {
    asRole('SuperAdmin')
    mockUseStaff.mockReturnValue(paused)
    mockUseParticipantAlertsAggregate.mockReturnValue(paused)
    renderPage()

    for (const label of ['Qualification issues', 'Critical participant alerts']) {
      const tile = tileFor(label)
      expect(tile, label).toHaveAttribute('aria-busy', 'true')
      expect(tile, label).not.toHaveAttribute('data-attention')
      expect(within(tile).getByText('–'), label).toBeInTheDocument()
      expect(within(tile).getByText('Loading'), label).toHaveClass('sr-only')
    }
    expect(screen.queryByText('All clear. Nothing needs you right now.')).not.toBeInTheDocument()
    expect(clearRow()).not.toHaveTextContent('qualification issues')
    expect(clearRow()).not.toHaveTextContent('critical participant alerts')
  })

  it('does not call a DISABLED query waiting: nobody asked it, so the role that cannot view alerts sees no placeholder', () => {
    asRole('ReadOnly')
    mockUseParticipantAlertsAggregate.mockReturnValue(disabled)
    renderPage()

    expect(screen.queryByText('–')).not.toBeInTheDocument()
    expect(document.querySelector('[aria-busy]')).toBeNull()
  })

  it('keeps a failed request a failure, whatever else is true of it', () => {
    asRole('SuperAdmin')
    mockUseStaff.mockReturnValue({ data: undefined, isPending: false, isLoading: false, isError: true, fetchStatus: 'idle' })
    renderPage()

    expect(tileFor('Qualification issues')).not.toHaveAttribute('aria-busy')
    expect(within(tileFor('Qualification issues')).getByText("Couldn't load")).toBeInTheDocument()
  })
})
