import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import TripDetailPage from './TripDetailPage'
import type { TripDetailDto } from '@/api/types/trips'

const baseTrip: TripDetailDto = {
  id: 'trip-1', tripName: 'Beach Getaway 2026', status: 'Confirmed', startDate: '2026-10-01', endDate: '2026-10-05', durationDays: 5,
} as unknown as TripDetailDto

// The header tests below vary the trip, the loading flag and the write permission; the mock factories read these at
// call time, so a test only has to assign before it renders.
let trip: TripDetailDto | undefined = baseTrip
let tripLoading = false
let tripFailure: { error?: unknown } | null = null
const tripRefetch = vi.fn()
let canWrite = true
let isAdmin = false
let isSuperAdmin = false
// Pages a test denies (canAccessPage returns false for them); cleared before each test.
const deniedPages = new Set<string>()
// Tab lists a test makes fail (their query is in error with nothing loaded); cleared before each test.
const failedLists = new Set<string>()
const listRefetch = vi.fn()
const tabList = (tab: string) => (failedLists.has(tab) ? { data: undefined, isError: true, refetch: listRefetch } : { data: [] })

const { mockUseTripSchedule, mockUseTripClaims, mockUseTripIncidents } = vi.hoisted(() => ({
  mockUseTripSchedule: vi.fn((): { data?: unknown[]; isError?: boolean } => ({ data: [] })),
  mockUseTripClaims: vi.fn((): { data?: unknown[]; isError?: boolean } => ({ data: [] })),
  mockUseTripIncidents: vi.fn((): { data?: { id: string }[]; isError?: boolean } => ({ data: [] })),
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite, isAdmin, isSuperAdmin, canAccessPage: (page: string) => !deniedPages.has(page) }),
}))

vi.mock('@/api/hooks', () => ({
  useTrip: () => ({ data: trip, isLoading: tripLoading, isError: tripFailure !== null, error: tripFailure?.error, refetch: tripRefetch }),
  useTripBookings: () => tabList('bookings'),
  useTripAccommodation: () => tabList('accommodation'),
  useTripVehicles: () => tabList('vehicles'),
  useTripStaff: () => tabList('staff'),
  useTripTasks: () => tabList('tasks'),
  useTripSchedule: mockUseTripSchedule,
  useTripClaims: mockUseTripClaims,
  useTripIncidents: mockUseTripIncidents,
  useParticipants: () => ({ data: [] }),
}))

vi.mock('@/components/AuditHistoryTab', () => ({ default: () => <div>History panel</div> }))

vi.mock('./trip-detail', () => ({
  OverviewTab: () => <div>Overview panel</div>,
  BookingsTab: () => <div>Bookings panel</div>,
  AccommodationTab: () => <div>Accommodation panel</div>,
  VehiclesTab: () => <div>Vehicles panel</div>,
  StaffTab: () => <div>Staff panel</div>,
  TasksTab: () => <div>Tasks panel</div>,
  ActivitiesTab: () => <div>Activities panel</div>,
  ClaimsTab: () => <div>Claims panel</div>,
  IncidentsTab: () => <div>Incidents panel</div>,
  EditTripModal: () => null,
}))

function renderPage(initialEntry = '/trips/trip-1') {
  const router = createMemoryRouter(
    [{ path: '/trips/:id', element: <TripDetailPage /> }],
    { initialEntries: [initialEntry] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

beforeEach(() => {
  deniedPages.clear()
  trip = baseTrip
  tripLoading = false
  tripFailure = null
  tripRefetch.mockClear()
  canWrite = true
  isAdmin = false
  isSuperAdmin = false
  localStorage.clear()
  mockUseTripSchedule.mockClear()
  mockUseTripClaims.mockClear()
  mockUseTripIncidents.mockClear()
  failedLists.clear()
  listRefetch.mockClear()
  mockUseTripSchedule.mockImplementation(() => tabList('activities'))
  mockUseTripClaims.mockImplementation(() => tabList('claims'))
  mockUseTripIncidents.mockImplementation(() => tabList('incidents'))
})

// Platform review Q4b follow-up: a tab whose list failed to load said "none" (its empty state). It says the load failed, with a retry.
describe('TripDetailPage — a tab list that fails to load', () => {
  it.each([
    ['bookings', 'booking list'], ['staff', 'staff list'],
    ['tasks', 'task list'], ['activities', 'activity schedule'], ['claims', 'claim list'], ['incidents', 'incident list'],
  ])(
    '%s shows the error and a retry, not the tab body',
    async (tab, noun) => {
      failedLists.add(tab)
      const user = userEvent.setup()
      renderPage(`/trips/trip-1?tab=${tab}`)

      const panel = screen.getByRole('tabpanel')
      expect(within(panel).getByText(`Couldn't load this ${noun}. Check your connection and try again.`)).toBeInTheDocument()
      expect(within(panel).queryByText(/ panel$/)).not.toBeInTheDocument()
      await user.click(within(panel).getByRole('button', { name: 'Try again' }))
      expect(listRefetch).toHaveBeenCalledTimes(1)
    },
  )

  it('leaves the other tabs alone', () => {
    failedLists.add('bookings')
    renderPage('/trips/trip-1?tab=stay')
    expect(screen.getByText('Vehicles panel')).toBeInTheDocument()
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument()
  })
})

// Stay and transport holds two lists, so each section decides alone (the page-level rule is for single-list tabs).
describe('TripDetailPage — Stay and transport sections', () => {
  it('stacks Accommodation and Vehicles under an h2 each', () => {
    renderPage('/trips/trip-1?tab=stay')
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Accommodation', 'Vehicles'])
    expect(within(panel).getByText('Accommodation panel')).toBeInTheDocument()
    expect(within(panel).getByText('Vehicles panel')).toBeInTheDocument()
  })

  it.each([
    ['accommodation', 'accommodation list', 'Vehicles panel', 'Accommodation panel'],
    ['vehicles', 'vehicle list', 'Accommodation panel', 'Vehicles panel'],
  ])('a failed %s list shows its own error and retry; the other section still renders', async (failed, noun, stillThere, gone) => {
    failedLists.add(failed)
    const user = userEvent.setup()
    renderPage('/trips/trip-1?tab=stay')
    const panel = screen.getByRole('tabpanel')

    expect(within(panel).getByText(`Couldn't load this ${noun}. Check your connection and try again.`)).toBeInTheDocument()
    expect(within(panel).getByText(stillThere)).toBeInTheDocument()
    expect(within(panel).queryByText(gone)).not.toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Try again' }))
    expect(listRefetch).toHaveBeenCalledTimes(1)
  })

  it('carries no count badge', () => {
    renderPage()
    expect(screen.getByRole('tab', { name: 'Stay and transport' })).toHaveTextContent(/^Stay and transport$/)
  })
})

describe('TripDetailPage — PP-60 URL-synced tabs', () => {
  it('writes the clicked tab into the ?tab= query param', async () => {
    const user = userEvent.setup()
    const { router } = renderPage()

    expect(screen.getByText('Overview panel')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /claims/i }))

    expect(screen.getByText('Claims panel')).toBeInTheDocument()
    expect(router.state.location.search).toContain('tab=claims')
  })

  it('reads the initial tab from the URL on load', () => {
    renderPage('/trips/trip-1?tab=stay')

    expect(screen.getByText('Vehicles panel')).toBeInTheDocument()
  })

  // Old links: Accommodation and Vehicles became Stay and transport. The key is rewritten with replace, other params kept.
  it.each(['vehicles', 'accommodation'])('opens Stay and transport from the old ?tab=%s and rewrites the URL', (old) => {
    const { router } = renderPage(`/trips/trip-1?tab=${old}&x=1`)

    expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(/^Stay and transport/)
    expect(screen.getByText('Vehicles panel')).toBeInTheDocument()
    expect(router.state.location.search).toBe('?tab=stay&x=1')
  })
})

describe('TripDetailPage — History tab by role (L5-05)', () => {
  it('shows the History tab to an Admin', () => {
    isAdmin = true
    renderPage()
    expect(screen.getByRole('tab', { name: /history/i })).toBeInTheDocument()
  })

  it('shows the History tab to a SuperAdmin and opens it from ?tab=history', () => {
    isSuperAdmin = true
    renderPage('/trips/trip-1?tab=history')
    expect(screen.getByRole('tab', { name: /history/i })).toBeInTheDocument()
    expect(screen.getByText('History panel')).toBeInTheDocument()
  })

  it('hides the History tab from other roles and falls back to Overview', () => {
    renderPage('/trips/trip-1?tab=history')
    expect(screen.queryByRole('tab', { name: /history/i })).not.toBeInTheDocument()
    expect(screen.getByText('Overview panel')).toBeInTheDocument()
  })
})

describe('TripDetailPage — PP-61 sub-resource fetches', () => {
  // Follow-up to the initial PP-61 fix: schedule/claims are NOT gated by activeTab, because
  // schedule.reduce(...) and claims.length feed the tab-label count badges, which render
  // outside their own tabpanel (visible before that tab is ever opened). Gating them made those
  // badges misleadingly read 0 until visited, so both fetch unconditionally like every other
  // sub-resource on this page.
  it('fetches schedule and claims unconditionally, not gated by the active tab', () => {
    renderPage()

    expect(mockUseTripSchedule).toHaveBeenCalledWith('trip-1')
    expect(mockUseTripClaims).toHaveBeenCalledWith('trip-1', { enabled: true })
  })

  it('still fetches schedule and claims the same way after switching tabs', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: /claims/i }))

    expect(mockUseTripSchedule).toHaveBeenCalledWith('trip-1')
    expect(mockUseTripClaims).toHaveBeenCalledWith('trip-1', { enabled: true })
  })
})

// TRIPS-4: ClaimsController admits only SuperAdmin, Admin and Coordinator, so a role refused the claims page gets no Claims tab and no claims request.
describe('TripDetailPage — Claims tab by role', () => {
  it('hides the tab from a role refused claims, sends no request, and reads ?tab=claims as Overview', () => {
    deniedPages.add('claims')
    renderPage('/trips/trip-1?tab=claims')

    expect(screen.queryByRole('tab', { name: /claims/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Claims panel')).not.toBeInTheDocument()
    expect(screen.getByText('Overview panel')).toBeInTheDocument()
    expect(mockUseTripClaims).toHaveBeenCalledWith('trip-1', { enabled: false })
  })

  it('shows the tab to a role allowed claims', () => {
    renderPage('/trips/trip-1?tab=claims')
    expect(screen.getByRole('tab', { name: /claims/i })).toBeInTheDocument()
    expect(screen.getByText('Claims panel')).toBeInTheDocument()
  })
})

describe('TripDetailPage — fact bar category icons', () => {
  it('gives each of the four facts its category icon (people, badge, shield, checklist)', () => {
    trip = withTrip({ maxParticipants: 6, staffRequired: 4 })
    renderPage()

    const facts: Array<[label: string, glyph: string]> = [
      ['Places booked', 'groups'],
      ['Staff assigned', 'badge'],
      ['Insurance confirmed', 'health_and_safety'],
      ['Open tasks', 'checklist'],
    ]
    for (const [label, glyph] of facts) expect(within(cellOf(label)).getByText(glyph)).toBeInTheDocument()
  })
})

// Every count that drives a chip and its tint. `attention` is a trip that needs a coordinator; `calm` is one that does not.
const attentionCounts = {
  currentParticipantCount: 5, maxParticipants: 6, staffAssignedCount: 3, staffRequired: 4, waitlistCount: 2, outstandingTaskCount: 2,
  highSupportCount: 2, overnightSupportCount: 2, wheelchairCount: 1, insuranceConfirmedCount: 4, insuranceOutstandingCount: 1,
}
const calmCounts = { ...attentionCounts, waitlistCount: 0, staffAssignedCount: 4, outstandingTaskCount: 0, insuranceConfirmedCount: 5, insuranceOutstandingCount: 0 }
const withTrip = (over: Record<string, unknown>) => ({ ...baseTrip, ...over }) as unknown as TripDetailDto

// label span -> label row -> the glance cell (the same walk the icon test above uses)
const cellOf = (label: string) => screen.getByText(label).closest('div')!.parentElement!

describe('TripDetailPage — detail header (the bolder header pattern)', () => {
  it('sets the trip name as the one h1, at the display step', () => {
    renderPage()

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Beach Getaway 2026')
    expect(headings[0]).toHaveClass('text-display')
    expect(headings[0].className).not.toMatch(/text-xl/)
  })

  it('groups the title with its meta row, so the meta is not a section-gap away from the title', () => {
    renderPage()

    const h1 = screen.getByRole('heading', { level: 1 })
    const group = h1.parentElement!.parentElement!.parentElement!
    expect(group).toHaveClass('flex', 'flex-col', 'gap-2')
    expect(within(group).getByText('Confirmed')).toBeInTheDocument()
  })

  it('leads the meta row with the status as a sure md pill, then destination, code, a compact dated range and the duration', () => {
    trip = withTrip({ tripCode: 'BGW-2610', destination: 'Caloundra QLD' })
    renderPage()

    const badge = screen.getByText('Confirmed')
    expect(badge).toHaveClass('rounded-full', 'font-semibold', 'text-[13px]')
    const row = badge.closest('span.inline-flex')!.parentElement!
    // Middots are aria-hidden punctuation, so strip them to read the facts in order.
    expect(row.textContent!.split('·')).toEqual(['Confirmed', 'Caloundra QLD', 'BGW-2610', '1–5 Oct 2026', '5 days'])
    expect(row.querySelectorAll('[aria-hidden="true"]')).toHaveLength(4)
    // The trip code is data, so it stays monospace.
    expect(screen.getByText('BGW-2610')).toHaveClass('font-mono')
  })

  it('keeps the year and every fact the old meta row showed, only presented differently', () => {
    trip = withTrip({ tripCode: 'BGW-2610', destination: 'Caloundra QLD', startDate: '2026-08-14', endDate: '2026-08-17', durationDays: 4 })
    renderPage()

    expect(screen.getByText('14–17 Aug 2026')).toBeInTheDocument()
    expect(screen.getByText('4 days')).toBeInTheDocument()
    // The old dd/mm/yyyy pair and "(4 days)" form are gone.
    expect(screen.queryByText(/14\/08\/2026/)).toBeNull()
    expect(screen.queryByText(/\(4 days\)/)).toBeNull()
  })

  it('names both months when the trip crosses a month, and both years across New Year', () => {
    trip = withTrip({ startDate: '2026-08-28', endDate: '2026-09-02', durationDays: 6 })
    const { unmount } = renderPage()
    expect(screen.getByText('28 Aug – 2 Sep 2026')).toBeInTheDocument()
    unmount()

    trip = withTrip({ startDate: '2026-12-30', endDate: '2027-01-02', durationDays: 4 })
    renderPage()
    expect(screen.getByText('30 Dec 2026 – 2 Jan 2027')).toBeInTheDocument()
  })

  it('reads "1 day", not "1 days", for a one-day trip', () => {
    trip = withTrip({ startDate: '2026-08-14', endDate: '2026-08-14', durationDays: 1 })
    renderPage()

    expect(screen.getByText('1 day')).toBeInTheDocument()
    expect(screen.getByText('14 Aug 2026')).toBeInTheDocument()
  })

  it('drops a missing destination and trip code without leaving a dangling separator', () => {
    // baseTrip has neither.
    renderPage()

    const row = screen.getByText('Confirmed').closest('span.inline-flex')!.parentElement!
    expect(row.textContent!.split('·')).toEqual(['Confirmed', '1–5 Oct 2026', '5 days'])
    expect(row.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2)
  })

  it('keeps the Back link, left of the title, and the Edit action', () => {
    renderPage()

    expect(screen.getByRole('link', { name: 'Back to trips' })).toHaveAttribute('href', '/trips')
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('still hides Edit from a read-only user', () => {
    canWrite = false
    renderPage()

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(screen.getByRole('link', { name: /back/i })).toBeInTheDocument()
  })

  it('leaves the tab strip and its panel exactly as they were', () => {
    renderPage()

    expect(screen.getByRole('tablist', { name: 'Trip detail sections' })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'trip-tabpanel-overview')
    expect(screen.getByText('Overview panel')).toBeInTheDocument()
  })
})

describe('TripDetailPage — glance strip', () => {
  it('is four buttons in the glance variant: a clipped grid of display-step tabular figures, one noun per figure', () => {
    trip = withTrip(attentionCounts)
    renderPage()

    const strip = cellOf('Places booked').parentElement!
    expect(strip).toHaveClass('grid', 'grid-cols-2', 'md:grid-flow-col', 'overflow-hidden')
    expect(strip.children).toHaveLength(4)
    for (const tile of Array.from(strip.children)) expect(tile.tagName).toBe('BUTTON')
    for (const figure of ['5 / 6', '3 / 4', '4 / 5', '2']) {
      expect(screen.getByText(figure)).toHaveClass('text-display', 'tabular-nums')
    }
    // No label mixes units, and the jargon is gone.
    for (const label of Array.from(strip.querySelectorAll('.order-2'))) expect(label.textContent).not.toContain('/')
    expect(screen.queryByText(/\bWC\b|Participants \/ Staff|High Support|Action Needed|Outstanding/)).not.toBeInTheDocument()
  })

  it('names each tile by label, figure and chip in source order', () => {
    trip = withTrip(attentionCounts)
    renderPage()

    expect(screen.getByRole('button', { name: /Staff assigned.*3 \/ 4.*1 short/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Places booked.*5 \/ 6.*2 on waitlist/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Insurance confirmed.*4 \/ 5.*1 to confirm/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open tasks.*2.*To do/ })).toBeInTheDocument()
  })

  it('spells every ratio the same way, " / " with a space each side, including two digits', () => {
    trip = withTrip({ ...attentionCounts, currentParticipantCount: 12, maxParticipants: 14, staffAssignedCount: 10, staffRequired: 12, insuranceConfirmedCount: 12, insuranceOutstandingCount: 2 })
    renderPage()

    const figures = Array.from(cellOf('Places booked').parentElement!.querySelectorAll('span.text-display')).map(f => f.textContent ?? '')
    expect(figures).toEqual(['12 / 14', '10 / 12', '12 / 14', '2'])
  })

  it('shows the count alone when there is no target: no maximum, no staff requirement, no insurance rows', () => {
    trip = withTrip({ ...attentionCounts, maxParticipants: null, staffRequired: null, insuranceConfirmedCount: 0, insuranceOutstandingCount: 0 })
    renderPage()

    expect(within(cellOf('Participants booked')).getByText('5')).toHaveClass('text-display')
    expect(within(cellOf('Staff assigned')).getByText('3')).toHaveClass('text-display')
    expect(within(cellOf('Staff assigned')).queryByText(/short/)).not.toBeInTheDocument()
    expect(within(cellOf('Insurance confirmed')).getByText('0')).toHaveClass('text-display')
    expect(screen.queryByText('Places booked')).not.toBeInTheDocument()
  })

  it('tints the tiles whose chip signals a gap: waitlist warning; short, to confirm and to do error', () => {
    trip = withTrip(attentionCounts)
    renderPage()

    const places = cellOf('Places booked')
    expect(places).toHaveAttribute('data-attention', 'warning')
    expect(places).toHaveClass('bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]')
    expect(within(places).getByText('2 on waitlist')).toBeInTheDocument()

    for (const [label, chip] of [['Staff assigned', '1 short'], ['Insurance confirmed', '1 to confirm'], ['Open tasks', 'To do']]) {
      const cell = cellOf(label)
      expect(cell, label).toHaveAttribute('data-attention', 'error')
      expect(cell, label).toHaveClass('bg-[var(--color-error-container)]', 'text-[var(--color-on-error-container)]')
      expect(within(cell).getByText(chip), label).toHaveClass('bg-[var(--color-card)]')
    }
  })

  it('leaves every tile plain when nothing is short: silence is the all-clear', () => {
    trip = withTrip(calmCounts)
    renderPage()

    for (const label of ['Places booked', 'Staff assigned', 'Insurance confirmed', 'Open tasks']) {
      const cell = cellOf(label)
      expect(cell, label).not.toHaveAttribute('data-attention')
      expect(cell.className, label).not.toMatch(/bg-\[var\(--color-(warning|error)/)
    }
    expect(screen.queryByText(/short|to confirm|waitlist|To do/)).not.toBeInTheDocument()
  })

  it('flips a tint away when the gap closes', () => {
    trip = withTrip({ ...attentionCounts, waitlistCount: 0, outstandingTaskCount: 0 })
    renderPage()

    expect(cellOf('Places booked')).not.toHaveAttribute('data-attention')
    expect(cellOf('Open tasks')).not.toHaveAttribute('data-attention')
    expect(cellOf('Insurance confirmed')).toHaveAttribute('data-attention', 'error')
  })

  it('reads a trip with no counts as quiet, not broken', () => {
    renderPage()

    expect(cellOf('Open tasks')).not.toHaveAttribute('data-attention')
    expect(cellOf('Insurance confirmed')).not.toHaveAttribute('data-attention')
    expect(screen.queryByText('Covered')).not.toBeInTheDocument()
  })

  it.each(['Cancelled', 'Archived'])('goes quiet on a %s trip: the figures stay, the chips and tints go', (status) => {
    trip = withTrip({ ...attentionCounts, status })
    renderPage()

    expect(screen.getByText('3 / 4')).toBeInTheDocument()
    expect(screen.queryByText(/short|to confirm|waitlist|To do/)).not.toBeInTheDocument()
    for (const label of ['Places booked', 'Staff assigned', 'Insurance confirmed', 'Open tasks']) expect(cellOf(label), label).not.toHaveAttribute('data-attention')
  })

  it('keeps the chips on a Completed trip: post-trip tasks are still live', () => {
    trip = withTrip({ ...attentionCounts, status: 'Completed' })
    renderPage()

    expect(screen.getByText('To do')).toBeInTheDocument()
  })

  it.each([
    ['Places booked', 'tab=bookings', 'Bookings panel'],
    ['Staff assigned', 'tab=staff', 'Staff panel'],
    ['Insurance confirmed', 'tab=bookings', 'Bookings panel'],
    ['Open tasks', 'tab=tasks', 'Tasks panel'],
  ])('the %s tile opens the tab that fixes it (%s)', async (label, query, panel) => {
    trip = withTrip(attentionCounts)
    const user = userEvent.setup()
    const { router } = renderPage()

    await user.click(within(cellOf(label).parentElement!).getByText(label))

    expect(router.state.location.search).toContain(query)
    expect(screen.getByText(panel)).toBeInTheDocument()
  })

  it('still opens tabs for a read-only user: reading is allowed', async () => {
    canWrite = false
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByText('Open tasks'))
    expect(screen.getByText('Tasks panel')).toBeInTheDocument()
  })
})

describe('TripDetailPage — loading and not-found states', () => {
  it('shows only the loading line, with no header, while the trip loads', () => {
    tripLoading = true
    trip = undefined
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('Loading trip…')
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.queryByText('Places booked')).toBeNull()
  })

  it('shows "Trip not found", with no header or strip, when the trip does not exist', () => {
    trip = undefined
    renderPage()

    expect(screen.getByText('Trip not found')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('offers a way out of "Trip not found": a Back link to the trip list', () => {
    trip = undefined
    renderPage()

    expect(screen.getByRole('link', { name: 'Back to trips' })).toHaveAttribute('href', '/trips')
  })

  it('shows a retryable error, not "Trip not found", when the request failed', async () => {
    const user = userEvent.setup()
    trip = undefined
    tripFailure = { error: { response: { status: 500 } } }
    renderPage()

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this trip")
    expect(screen.queryByText('Trip not found')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(tripRefetch).toHaveBeenCalledTimes(1)
  })

  it('treats a 404 as "no such trip", not as a failure to retry', () => {
    trip = undefined
    tripFailure = { error: { response: { status: 404 } } }
    renderPage()

    expect(screen.getByText('Trip not found')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('keeps the page when a background refetch fails over a trip that is already on screen', () => {
    tripFailure = { error: { response: { status: 500 } } }
    renderPage()

    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(screen.queryByText(/couldn't load this trip/i)).toBeNull()
  })
})

describe('TripDetailPage — Incidents tab', () => {
  it('shows an Incidents tab (gated by canAccessPage("incidents")) with a count badge and renders IncidentsTab on click', async () => {
    const user = userEvent.setup()
    mockUseTripIncidents.mockReturnValue({ data: [{ id: 'inc-1' }, { id: 'inc-2' }] })
    renderPage()

    const tab = screen.getByRole('tab', { name: /incidents/i })
    expect(tab).toHaveTextContent('2')

    await user.click(tab)
    expect(screen.getByText('Incidents panel')).toBeInTheDocument()
    expect(mockUseTripIncidents).toHaveBeenCalledWith('trip-1')
  })
})

// L5-05: a ?tab= the role cannot see matched the static key list but showed no tab: nothing selected, an empty body.
describe('TripDetailPage — a role-gated tab key in the URL', () => {
  const selectedTab = () => screen.getAllByRole('tab').filter(tab => tab.getAttribute('aria-selected') === 'true')

  it('reads ?tab=incidents as Overview for a role without incident access', () => {
    deniedPages.add('incidents')
    renderPage('/trips/trip-1?tab=incidents')

    expect(selectedTab().map(t => t.textContent)).toEqual([expect.stringMatching(/^Overview/)])
    expect(screen.queryByRole('tab', { name: /incidents/i })).not.toBeInTheDocument()
  })

  it('reads ?tab=history as Overview for a role that is not Admin', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'Coordinator' }))
    renderPage('/trips/trip-1?tab=history')

    expect(selectedTab().map(t => t.textContent)).toEqual([expect.stringMatching(/^Overview/)])
    localStorage.removeItem('odip_user')
  })
})

// L5-06: the page's own tabpanel pointed aria-labelledby at "trip-tab-<id>", an id the Tabs primitive stopped generating when it took over
// the buttons, so the panel had no accessible name and a screen-reader user entered an unnamed region.
describe('TripDetailPage — the tabpanel is named by its tab', () => {
  it('has an aria-labelledby that resolves to the selected tab, so the panel is named "Bookings"', () => {
    renderPage('/trips/trip-1?tab=bookings')

    const panel = screen.getByRole('tabpanel')
    const labelledBy = panel.getAttribute('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(document.getElementById(labelledBy as string)).toBe(screen.getByRole('tab', { selected: true }))
    expect(panel).toHaveAccessibleName(/^Bookings/)
  })

  it('points the selected tab aria-controls at the panel that is really there', () => {
    renderPage('/trips/trip-1?tab=stay')

    const selected = screen.getByRole('tab', { selected: true })
    expect(document.getElementById(selected.getAttribute('aria-controls') as string)).toBe(screen.getByRole('tabpanel'))
  })
})

// VD1 design review: a one-row scrolling strip hid History at 1440 with no cue on macOS or iPad (no drawn scrollbar). From md up the
// strip wraps, so every tab stays on screen; below md it is the default one scrolling row.
describe('TripDetailPage — every tab visible from md up', () => {
  it('renders the nine Admin tabs in ONE row: the strip scrolls with the house fade instead of wrapping', () => {
    isAdmin = true
    renderPage()
    expect(screen.getAllByRole('tab')).toHaveLength(9)
    const strip = screen.getByRole('tablist', { name: 'Trip detail sections' })
    expect(strip).not.toHaveClass('md:flex-wrap')
    expect(strip.className).toMatch(/mask-image/)
  })
})
