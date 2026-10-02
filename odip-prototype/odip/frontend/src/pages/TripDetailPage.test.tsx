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

const { mockUseTripSchedule, mockUseTripClaims, mockUseTripIncidents } = vi.hoisted(() => ({
  mockUseTripSchedule: vi.fn(() => ({ data: [] })),
  mockUseTripClaims: vi.fn(() => ({ data: [] })),
  mockUseTripIncidents: vi.fn(() => ({ data: [] as { id: string }[] })),
}))

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite, isAdmin, isSuperAdmin, canAccessPage: (page: string) => !deniedPages.has(page) }),
}))

vi.mock('@/api/hooks', () => ({
  useTrip: () => ({ data: trip, isLoading: tripLoading, isError: tripFailure !== null, error: tripFailure?.error, refetch: tripRefetch }),
  useTripBookings: () => ({ data: [] }),
  useTripAccommodation: () => ({ data: [] }),
  useTripVehicles: () => ({ data: [] }),
  useTripStaff: () => ({ data: [] }),
  useTripTasks: () => ({ data: [] }),
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
  mockUseTripIncidents.mockReturnValue({ data: [] })
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
    renderPage('/trips/trip-1?tab=vehicles')

    expect(screen.getByText('Vehicles panel')).toBeInTheDocument()
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
    expect(mockUseTripClaims).toHaveBeenCalledWith('trip-1')
  })

  it('still fetches schedule and claims the same way after switching tabs', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('tab', { name: /claims/i }))

    expect(mockUseTripSchedule).toHaveBeenCalledWith('trip-1')
    expect(mockUseTripClaims).toHaveBeenCalledWith('trip-1')
  })
})

describe('TripDetailPage — fact bar category icons', () => {
  it('gives each of the four facts its category icon (people, checklist, wheelchair, shield)', () => {
    renderPage()

    const facts: Array<[label: string, glyph: string]> = [
      ['Participants / Staff', 'groups'],
      ['Outstanding Tasks', 'checklist'],
      ['High Support / Overnight', 'accessible'],
      ['Insurance', 'health_and_safety'],
    ]
    for (const [label, glyph] of facts) {
      // label span -> label/value column -> segment
      const segment = screen.getByText(label).closest('div')!.parentElement!
      expect(within(segment).getByText(glyph)).toBeInTheDocument()
    }
  })
})

// Every count that drives a chip and its tint. `attention` is a trip that needs a coordinator; `calm` is one that does not.
const attentionCounts = {
  currentParticipantCount: 5, staffAssignedCount: 3, waitlistCount: 2, outstandingTaskCount: 2,
  highSupportCount: 2, overnightSupportCount: 2, wheelchairCount: 1, insuranceConfirmedCount: 4, insuranceOutstandingCount: 1,
}
const calmCounts = { ...attentionCounts, waitlistCount: 0, outstandingTaskCount: 0, insuranceConfirmedCount: 5, insuranceOutstandingCount: 0 }
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

  it('keeps the Back link and the Edit Trip action', () => {
    renderPage()

    expect(screen.getByRole('link', { name: 'Back to trips' })).toHaveAttribute('href', '/trips')
    expect(screen.getByRole('button', { name: /edit trip/i })).toBeInTheDocument()
  })

  it('still hides Edit Trip from a read-only user', () => {
    canWrite = false
    renderPage()

    expect(screen.queryByRole('button', { name: /edit trip/i })).toBeNull()
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
  it('opts the four facts into the glance variant: a clipped grid of display-step tabular figures', () => {
    trip = withTrip(attentionCounts)
    renderPage()

    const strip = cellOf('Insurance').parentElement!
    expect(strip).toHaveClass('grid', 'grid-cols-2', 'md:grid-flow-col', 'overflow-hidden')
    expect(strip.children).toHaveLength(4)
    for (const figure of ['5 / 3', '2', '2 / 2', '4 / 5']) {
      expect(screen.getByText(figure)).toHaveClass('text-display', 'tabular-nums')
    }
  })

  it('spells every ratio figure the same way, " / " with a space each side, including a two-digit Insurance', () => {
    // 12 confirmed + 2 outstanding = "12 / 14". The strip once rendered this one as "12/14" beside "12 / 10".
    trip = withTrip({ ...attentionCounts, currentParticipantCount: 12, staffAssignedCount: 10, insuranceConfirmedCount: 12, insuranceOutstandingCount: 2 })
    renderPage()

    expect(screen.getByText('12 / 10')).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
    expect(screen.getByText('12 / 14')).toBeInTheDocument()

    // No figure anywhere in the strip is squeezed ("12/14") or otherwise off the "x / y" pattern.
    const strip = cellOf('Insurance').parentElement!
    const figures = Array.from(strip.querySelectorAll('span.text-display')).map(f => f.textContent ?? '')
    expect(figures).toHaveLength(4)
    for (const figure of figures.filter(f => f.includes('/'))) expect(figure).toMatch(/^\d+ \/ \d+$/)
    expect(figures).not.toContain('12/14')
  })

  it('keeps a zero insurance ratio in the same form, and the chip follows the outstanding count', () => {
    trip = withTrip({ ...attentionCounts, insuranceConfirmedCount: 0, insuranceOutstandingCount: 0 })
    renderPage()

    expect(screen.getByText('0 / 0')).toHaveClass('text-display')
    expect(within(cellOf('Insurance')).getByText('Covered')).toBeInTheDocument()
    expect(cellOf('Insurance')).not.toHaveAttribute('data-attention')
  })

  it('tints the segments whose badge signals attention: Waitlist warning, Action Needed and Outstanding error', () => {
    trip = withTrip(attentionCounts)
    renderPage()

    const participants = cellOf('Participants / Staff')
    expect(participants).toHaveAttribute('data-attention', 'warning')
    expect(participants).toHaveClass('bg-[var(--color-warning-container)]', 'text-[var(--color-on-warning-container)]')
    expect(within(participants).getByText('Waitlist')).toBeInTheDocument()

    const tasks = cellOf('Outstanding Tasks')
    expect(tasks).toHaveAttribute('data-attention', 'error')
    expect(tasks).toHaveClass('bg-[var(--color-error-container)]', 'text-[var(--color-on-error-container)]')
    expect(within(tasks).getByText('Action Needed')).toBeInTheDocument()

    const insurance = cellOf('Insurance')
    expect(insurance).toHaveAttribute('data-attention', 'error')
    expect(insurance).toHaveClass('bg-[var(--color-error-container)]')
    expect(within(insurance).getByText('Outstanding')).toBeInTheDocument()
  })

  it('keeps the High Support / Overnight segment quiet even when its neighbours are tinted (a wheelchair count is not a problem)', () => {
    trip = withTrip(attentionCounts)
    renderPage()

    const support = cellOf('High Support / Overnight')
    expect(support).not.toHaveAttribute('data-attention')
    expect(support.className).not.toMatch(/container/)
    expect(within(support).getByText('1 WC')).toHaveClass('bg-[var(--color-input)]')
  })

  it('leaves every segment plain when nothing needs attention: Active, On Track, Covered on the card fill', () => {
    trip = withTrip(calmCounts)
    renderPage()

    for (const label of ['Participants / Staff', 'Outstanding Tasks', 'High Support / Overnight', 'Insurance']) {
      const cell = cellOf(label)
      expect(cell).not.toHaveAttribute('data-attention')
      expect(cell.className).not.toMatch(/bg-\[/)
    }
    expect(screen.getByText('Active')).toHaveClass('bg-[var(--color-primary-fixed)]')
    expect(screen.getByText('On Track')).toHaveClass('bg-[var(--color-primary-fixed)]')
    expect(screen.getByText('Covered')).toHaveClass('bg-[var(--color-primary-fixed)]')
  })

  it('cannot tint a segment against its own badge: a tinted cell holds a white-pill chip, a quiet one its own tone', () => {
    trip = withTrip(attentionCounts)
    renderPage()

    expect(screen.getByText('Waitlist')).toHaveClass('bg-[var(--color-card)]', 'text-[var(--color-on-warning-container)]')
    expect(screen.getByText('Action Needed')).toHaveClass('bg-[var(--color-card)]', 'text-[var(--color-on-error-container)]')
    expect(screen.getByText('1 WC')).not.toHaveClass('bg-[var(--color-card)]')
  })

  it('flips a tint away when the count clears: no waitlist, no outstanding tasks', () => {
    trip = withTrip({ ...attentionCounts, waitlistCount: 0, outstandingTaskCount: 0 })
    renderPage()

    expect(cellOf('Participants / Staff')).not.toHaveAttribute('data-attention')
    expect(cellOf('Outstanding Tasks')).not.toHaveAttribute('data-attention')
    // Insurance is still outstanding, so it keeps its tint.
    expect(cellOf('Insurance')).toHaveAttribute('data-attention', 'error')
  })

  it('reads a trip with no counts as quiet, not broken (missing counts default to zero)', () => {
    // baseTrip has no counts at all.
    renderPage()

    expect(cellOf('Outstanding Tasks')).not.toHaveAttribute('data-attention')
    expect(cellOf('Insurance')).not.toHaveAttribute('data-attention')
    expect(screen.getByText('On Track')).toBeInTheDocument()
    expect(screen.getByText('Covered')).toBeInTheDocument()
  })
})

describe('TripDetailPage — loading and not-found states', () => {
  it('shows only the loading line, with no header, while the trip loads', () => {
    tripLoading = true
    trip = undefined
    renderPage()

    expect(screen.getByRole('status')).toHaveTextContent('Loading trip…')
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    expect(screen.queryByText('Participants / Staff')).toBeNull()
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
    renderPage('/trips/trip-1?tab=vehicles')

    const selected = screen.getByRole('tab', { selected: true })
    expect(document.getElementById(selected.getAttribute('aria-controls') as string)).toBe(screen.getByRole('tabpanel'))
  })
})
