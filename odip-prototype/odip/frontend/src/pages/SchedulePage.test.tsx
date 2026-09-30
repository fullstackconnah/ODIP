import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SchedulePage from './SchedulePage'
import type { ScheduleOverviewDto, ScheduleStaffDto, ScheduleTripDto, ScheduleVehicleDto } from '@/api/types'

vi.mock('@/lib/permissions', () => ({
  usePermissions: () => ({ canWrite: true }),
}))

const overview: ScheduleOverviewDto = {
  trips: [{
    id: 'trip-1', tripName: 'Gold Coast Beach Break', tripCode: null, destination: null, region: null,
    startDate: '2026-09-10', endDate: '2026-09-12', durationDays: 3, status: 'Confirmed',
    maxParticipants: null, currentParticipantCount: 0, minStaffRequired: null, staffRequired: 1,
    staffAssignedCount: 0, vehicleAssignedCount: 0, leadCoordinatorName: null, preferenceMatchCount: 0,
  }],
  staff: [{
    id: 'staff-1', firstName: 'Alex', lastName: 'Rivera', fullName: 'Alex Rivera', role: 'SupportWorker',
    region: null, isDriverEligible: true, isFirstAidQualified: true, isMedicationCompetent: true,
    isManualHandlingCompetent: true, isOvernightEligible: true,
    tripStatuses: [{ tripId: 'trip-1', status: 'Tentative', assignmentRole: null, assignmentStatus: null, assignmentId: null }],
    availability: [], preferredForTrips: [],
  }],
  vehicles: [],
}

// The hook mock reads this at render time, so a test can swap the data the page sees.
let currentOverview: ScheduleOverviewDto = overview
let currentError: unknown = null

vi.mock('@/api/hooks', () => ({
  useScheduleOverview: () => ({ data: currentError ? undefined : currentOverview, isLoading: false, error: currentError }),
  useCreateStaffAssignment: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useCreateVehicleAssignment: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useDeleteStaffAssignment: () => ({ mutate: vi.fn(), isPending: false }),
}))

function renderPage() {
  const qc = new QueryClient()
  return render(<QueryClientProvider client={qc}><SchedulePage /></QueryClientProvider>)
}

function makeTrip(id: string, tripName: string, overrides: Partial<ScheduleTripDto> = {}): ScheduleTripDto {
  return {
    ...overview.trips[0], id, tripName, ...overrides,
  }
}

function makeStaff(id: string, fullName: string, tripStatuses: ScheduleStaffDto['tripStatuses'], overrides: Partial<ScheduleStaffDto> = {}): ScheduleStaffDto {
  return {
    ...overview.staff[0],
    id, fullName, firstName: fullName.split(' ')[0], lastName: fullName.split(' ')[1] ?? '',
    isDriverEligible: false, isFirstAidQualified: false, isMedicationCompetent: false,
    isManualHandlingCompetent: false, isOvernightEligible: false,
    tripStatuses, ...overrides,
  }
}

const vehicle: ScheduleVehicleDto = {
  id: 'veh-1', vehicleName: 'Toyota HiAce', registration: 'ABC123', vehicleType: 'MiniBus', totalSeats: 12,
  wheelchairPositions: 2, isInternal: true,
  tripStatuses: [
    { tripId: 'trip-1', status: 'Assigned', assignmentStatus: 'Confirmed' },
    { tripId: 'trip-2', status: 'Available', assignmentStatus: null },
  ],
}

/** Two trips; one staff member assigned to trip 1, one in conflict on trip 1; the one vehicle assigned. */
const richOverview: ScheduleOverviewDto = {
  trips: [makeTrip('trip-1', 'Gold Coast Beach Break'), makeTrip('trip-2', 'Byron Bay Weekend', { preferenceMatchCount: 2 })],
  staff: [
    makeStaff('staff-1', 'Alex Rivera', [
      { tripId: 'trip-1', status: 'Assigned', assignmentRole: 'Support Worker', assignmentStatus: 'Confirmed', assignmentId: 'asg-1' },
      { tripId: 'trip-2', status: 'Available', assignmentRole: null, assignmentStatus: null, assignmentId: null },
    ]),
    makeStaff('staff-2', 'Mei Zhang', [
      { tripId: 'trip-1', status: 'Conflict', assignmentRole: null, assignmentStatus: null, assignmentId: null },
      { tripId: 'trip-2', status: 'Available', assignmentRole: null, assignmentStatus: null, assignmentId: null },
    ]),
  ],
  vehicles: [vehicle],
}

beforeEach(() => {
  currentOverview = overview
  currentError = null
})

describe('SchedulePage — Tentative badge for pending leave', () => {
  it('renders a Tentative badge for a staff/trip cell with pending leave', () => {
    renderPage()
    expect(screen.getByText('Tentative')).toBeInTheDocument()
  })
})

describe('SchedulePage — density (spec §7)', () => {
  it('replaces the hero tile and Resource Health card with one strip carrying the same numbers', () => {
    currentOverview = richOverview
    renderPage()

    const strip = screen.getByRole('group', { name: 'Resource health' })
    const value = (label: string) => within(strip).getByText(label).nextElementSibling?.textContent
    expect(value('Active Trips')).toBe('2')
    expect(value('Staff')).toBe('1/2')
    expect(value('Vehicles')).toBe('1/1')
    expect(value('Conflicts')).toBe('01')
    expect(value('Utilization')).toBe('67%')

    // The old hero tile / card headings are gone, and the strip is one line, not a tall block.
    expect(screen.queryByText('Resource Health')).not.toBeInTheDocument()
    expect(strip.firstElementChild).toHaveClass('min-h-[var(--row-h)]')
  })

  it('tints a non-zero Conflicts count with the conflict token', () => {
    currentOverview = richOverview
    renderPage()

    const strip = screen.getByRole('group', { name: 'Resource health' })
    expect(within(strip).getByText('01')).toHaveClass('text-[var(--color-conflict)]')
  })

  it('puts the subtitle inline with the heading via PageHeader instead of on its own line', () => {
    renderPage()

    const h1 = screen.getByRole('heading', { level: 1, name: 'Schedule Overview' })
    expect(h1.parentElement).toHaveTextContent('Staff and vehicle assignment across active trips · Click Available to assign')
  })

  it('sets the cell font size at the source: the table itself is text-sm (14px), not the inherited 16px', () => {
    renderPage()

    const table = screen.getByRole('table')
    expect(table).toHaveClass('text-sm')
    expect(table).toHaveClass('table-fixed')
  })

  it('pins the header row and the resource column, and scrolls inside a capped frame from md up', () => {
    renderPage()

    expect(screen.getByRole('columnheader', { name: 'Resources' })).toHaveClass('sticky', 'left-0', 'top-0')
    expect(screen.getByRole('columnheader', { name: /Gold Coast Beach Break/ })).toHaveClass('sticky', 'top-0')
    const frame = screen.getByRole('table').parentElement as HTMLElement
    expect(frame).toHaveClass('overflow-auto')
    expect(frame.className).toMatch(/md:max-h-/)
    expect(screen.getByRole('button', { name: /^Alex Rivera/ }).closest('td')).toHaveClass('sticky', 'left-0')
  })

  it('locks staff and vehicle rows to --row-h (34px, 48px on coarse pointers) from md up', () => {
    currentOverview = richOverview
    renderPage()

    expect(screen.getByRole('button', { name: /^Alex Rivera/ }).closest('tr')).toHaveClass('md:h-[var(--row-h)]')
    expect(screen.getByText('Toyota HiAce').closest('tr')).toHaveClass('md:h-[var(--row-h)]')
  })

  it('collapses name, role and qualification chips onto one line, summarising overflow as "+N" with the full list', () => {
    renderPage()

    // Alex holds all five qualifications: three chips plus "+2", full list on the tooltip.
    const row = screen.getByRole('button', { name: /^Alex Rivera/ }).closest('td') as HTMLElement
    expect(within(row).getByText('Alex Rivera')).toBeInTheDocument()
    expect(within(row).getByText('Support Worker')).toBeInTheDocument()
    expect(within(row).getByTitle('Driver Eligible')).toBeInTheDocument()
    expect(within(row).queryByTitle('Overnight')).not.toBeInTheDocument()
    expect(within(row).getByText('+2').closest('[title]')).toHaveAttribute(
      'title',
      'Driver Eligible, First Aid, Medication, Manual Handling, Overnight',
    )
    // One flex line on md+, not the old stacked block.
    expect(row.firstElementChild).toHaveClass('md:flex-row')
  })

  it('renders the assignment chip at row-h less 6px (28px) with 14px text', () => {
    renderPage()

    const chip = screen.getByText('Tentative').parentElement as HTMLElement
    expect(chip).toHaveClass('h-[calc(var(--row-h)_-_6px)]', 'text-sm')
  })

  it('keeps a trip preference as a chip in the header and a star beside the assignment cell', () => {
    currentOverview = {
      ...richOverview,
      staff: [makeStaff('staff-1', 'Alex Rivera', richOverview.staff[0].tripStatuses, {
        preferredForTrips: [{ tripId: 'trip-2', participantCount: 2 }],
      })],
    }
    renderPage()

    expect(screen.getByText('★ 2 preferred')).toBeInTheDocument()
    expect(screen.getByTitle('2 participants prefer this staff member')).toHaveTextContent('★ 2')
  })

  it('keeps the page heading when the overview fails to load', () => {
    currentError = new Error('boom')
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Schedule Overview' })).toBeInTheDocument()
    expect(screen.getByText('Failed to load schedule overview.')).toBeInTheDocument()
  })

  it('shows the empty state, with the summary strip still present, when there are no trips', () => {
    currentOverview = { trips: [], staff: [], vehicles: [] }
    renderPage()

    expect(screen.getByText('No trips scheduled')).toBeInTheDocument()
    expect(screen.getByText('Create a trip first to see the schedule overview.')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Resource health' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
