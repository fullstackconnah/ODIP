import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PortalShiftsPage from './PortalShiftsPage'
import type { PortalShiftsResponseDto, PortalShiftSummaryDto } from '@/api/types'

const { mockUseMyShifts, mockUsePendingWitnessRequests, mockUsePortalShiftDetail } = vi.hoisted(() => ({
  mockUseMyShifts: vi.fn(),
  mockUsePortalShiftDetail: vi.fn(),
  mockUsePendingWitnessRequests: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useIntakeVisits: () => ({ data: [], isLoading: false, isError: false, refetch: vi.fn() }),
  useConvertParticipantInquiry: () => ({ mutate: vi.fn(), isPending: false }),
  useMyShifts: mockUseMyShifts,
  usePendingWitnessRequests: mockUsePendingWitnessRequests,
  usePortalShiftDetail: mockUsePortalShiftDetail,
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <PortalShiftsPage />
    </MemoryRouter>,
  )
}

function makeShiftsResponse(overrides: Partial<PortalShiftsResponseDto> = {}): PortalShiftsResponseDto {
  return {
    shifts: [
      {
        id: 'shift-1',
        participantId: 'participant-1',
        participantName: 'Mia Chen',
        serviceDate: '2026-08-17',
        startTime: '09:00:00',
        endTime: '17:00:00',
        endsNextDay: false,
        durationHours: 8,
        ratio: 'OneToOne',
        nightType: 'None',
        status: 'Published',
        notes: null,
        returnCount: 0,
      },
    ],
    tripAssignments: [],
    timeZoneId: 'Australia/Brisbane',
    ...overrides,
  }
}

beforeEach(() => {
  mockUseMyShifts.mockReset()
  mockUsePendingWitnessRequests.mockReset().mockReturnValue({ data: [], isLoading: false })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-19T10:00:00+10:00'))   // 10 am in the fixture's provider zone, whatever the runner's zone
  mockUsePortalShiftDetail.mockReset().mockReturnValue({ data: undefined })
  sessionStorage.clear()
})

afterEach(() => vi.useRealTimers())

describe('PortalShiftsPage', () => {
  it('announces a loading state instead of rendering a blank page while shifts are fetching', () => {
    mockUseMyShifts.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderPage()

    expect(screen.getByText(/loading your shifts/i).closest('[role="status"]')).not.toBeNull()
    expect(screen.queryByText(/nothing rostered this week/i)).not.toBeInTheDocument()
  })

  it('renders the caller\'s own shifts, grouped by day, as links to the shift detail route', () => {
    mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse(), isLoading: false })
    renderPage()

    expect(screen.getByText('Mia Chen')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Mia Chen/i })
    expect(link).toHaveAttribute('href', '/portal/shifts/shift-1')
  })

  it('shows an empty state when linked but nothing is rostered', () => {
    mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse({ shifts: [] }), isLoading: false })
    renderPage()

    expect(screen.getByText(/nothing rostered this week/i)).toBeInTheDocument()
  })

  it('shows an error state with a retry action when the shifts request fails, not the empty-week message', () => {
    const refetch = vi.fn()
    mockUseMyShifts.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch })
    renderPage()

    expect(screen.getByText(/couldn't load your shifts/i)).toBeInTheDocument()
    expect(screen.queryByText(/nothing rostered this week/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })

  it('renders trip assignments alongside shifts', () => {
    mockUseMyShifts.mockReturnValue({
      data: makeShiftsResponse({
        tripAssignments: [
          {
            id: 'assign-1',
            tripInstanceId: 'trip-1',
            tripCode: 'TRIP-001',
            tripName: 'Beach Getaway',
            assignmentStart: '2026-08-18',
            assignmentEnd: '2026-08-20',
            isDriver: true,
            status: 'Confirmed',
            destination: null,
            role: null,
          },
        ],
      }),
      isLoading: false,
    })
    renderPage()

    expect(screen.getByText('Beach Getaway')).toBeInTheDocument()
    expect(screen.getByText(/driver/i)).toBeInTheDocument()
  })

  describe('trip assignment location and role', () => {
    const trip = {
      id: 'assign-1', tripInstanceId: 'trip-1', tripCode: 'TRIP-001', tripName: 'Beach Getaway',
      assignmentStart: '2026-08-18', assignmentEnd: '2026-08-20', isDriver: false, status: 'Confirmed' as const,
    }
    const show = (a: object) => {
      mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse({ tripAssignments: [a as never] }), isLoading: false })
      renderPage()
    }

    it('shows the destination and the role with screen-reader labels', () => {
      show({ ...trip, destination: 'Surfers Paradise, Gold Coast', role: 'Support Worker' })
      expect(screen.getByText('Surfers Paradise, Gold Coast')).toHaveAttribute('title', 'Surfers Paradise, Gold Coast')
      expect(screen.getByText(/location:/i)).toBeInTheDocument()
      expect(screen.getByText('Support Worker')).toBeInTheDocument()
      expect(screen.getByText(/your role:/i)).toBeInTheDocument()
    })

    it('renders neither row when both are null', () => {
      show({ ...trip, destination: null, role: null })
      expect(screen.queryByText(/location:/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/your role:/i)).not.toBeInTheDocument()
    })

    it('renders neither row when the keys are missing (week saved before the deploy)', () => {
      show(trip)
      expect(screen.queryByText(/location:/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/your role:/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/undefined/i)).not.toBeInTheDocument()
    })

    it('treats blank text as absent', () => {
      show({ ...trip, destination: '   ', role: ' ' })
      expect(screen.queryByText(/location:/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/your role:/i)).not.toBeInTheDocument()
    })

    it('says driver once when the role already says driver', () => {
      show({ ...trip, isDriver: true, destination: null, role: 'Senior Support / Driver' })
      expect(screen.getAllByText(/driver/i)).toHaveLength(1)
    })

    it('keeps the Driver label when the role does not say driver', () => {
      show({ ...trip, isDriver: true, destination: null, role: 'Support Worker' })
      expect(screen.getAllByText(/driver/i)).toHaveLength(1)
      expect(screen.getByText('Driver')).toBeInTheDocument()
    })
  })

  it('links to the leave portal page', () => {
    mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse(), isLoading: false })
    renderPage()
    expect(screen.getByRole('link', { name: /my leave/i })).toHaveAttribute('href', '/portal/leave')
  })
})

// SHAPE-PR3 8 (B10): the card says how long the shift is, and the two header actions no longer compete with the shift titles.
describe('PortalShiftsPage — the shift card and header actions', () => {
  it('puts the duration after the time range, before the ratio', () => {
    const base = makeShiftsResponse().shifts[0]
    mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse({ shifts: [{ ...base, durationHours: 8, ratio: 'TwoToOne' }] }), isLoading: false })
    renderPage()
    const meta = screen.getByText(/9am–5pm/)
    expect(meta.textContent).toMatch(/^9am–5pm · 8 h/)
    expect(meta.textContent).toMatch(/8 h.*2:1/)
  })

  it('keeps Leave and Witness approvals as ghost buttons', () => {
    mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse(), isLoading: false })
    renderPage()
    for (const name of [/my leave/i, /witness approvals/i]) {
      const link = screen.getByRole('link', { name })
      expect(link.className).toContain('text-[var(--color-muted-foreground)]')
      expect(link.className).not.toContain('bg-[var(--color-primary)]')
    }
  })
})

// V2-C: the week controls are one group that never wraps (prev, the range, next, This week), built from Button; My leave and Witness approvals are header actions, not part of it.
describe('PortalShiftsPage — the week controls', () => {
  it('keep prev, the range, next and This week in one non-wrapping group of Buttons', () => {
    mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse(), isLoading: false })
    renderPage()
    const week = screen.getByRole('group', { name: 'Week' })
    expect(week).toHaveClass('flex-nowrap')
    for (const name of ['Previous week', 'Next week', 'This week']) {
      expect(within(week).getByRole('button', { name })).toHaveClass('h-[var(--control-h)]')
    }
    expect(within(week).queryByRole('link', { name: /my leave|witness approvals/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /witness approvals/i })).toHaveAttribute('href', '/portal/witness-approvals')
  })
})

describe('PortalShiftsPage: the current shift leads (SHAPE §2)', () => {
  const today = '2026-08-19'
  const row = (over: Partial<PortalShiftSummaryDto>): PortalShiftSummaryDto => ({ ...makeShiftsResponse().shifts[0], ...over })
  function answer(week: PortalShiftSummaryDto[]) {
    mockUseMyShifts.mockReturnValue({ data: { shifts: week, tripAssignments: [], timeZoneId: 'Australia/Brisbane' }, isLoading: false })
  }

  it('leads with the shift in progress, with one Continue shift link, and does not list it again', () => {
    const now = row({ id: 'shift-2', serviceDate: today, status: 'InProgress', participantName: 'Sienna Whitfield' })
    answer([now])
    renderPage()

    // No eyebrow (finish review fix 5): the name is the card's heading and the state line says it.
    expect(screen.getByRole('heading', { level: 2, name: 'Sienna Whitfield' })).toBeInTheDocument()
    expect(screen.getByText(/^On shift now/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue shift' })).toHaveAttribute('href', '/portal/shifts/shift-2')
    expect(screen.getAllByText('Sienna Whitfield')).toHaveLength(1)
  })

  it('shows its state once the detail loads: when it started, overdue doses and a handover to read', () => {
    const now = row({ id: 'shift-2', serviceDate: today, status: 'InProgress' })
    answer([now])
    mockUsePortalShiftDetail.mockReturnValue({
      data: {
        timeZoneId: 'Australia/Brisbane', breaks: [], completion: { actualStart: '2026-08-18T23:02:00Z' },
        medicationsDue: [{ state: 'Overdue', outcome: null }, { state: 'Overdue', outcome: null }, { state: 'Due', outcome: null }],
        handover: { requiresAcknowledgement: true, isRead: false },
      } as never,
    })
    renderPage()

    expect(screen.getByText(/^On shift now · Started 9:02\s?am · .+ on shift$/i)).toBeInTheDocument()
    expect(screen.getByText('2 doses overdue')).toBeInTheDocument()
    expect(screen.getByText('Handover to read')).toBeInTheDocument()
  })


  it('says "1 dose overdue" for a single overdue dose', () => {
    const now = row({ id: 'shift-2', serviceDate: today, status: 'InProgress' })
    answer([now])
    mockUsePortalShiftDetail.mockReturnValue({
      data: { timeZoneId: 'Australia/Brisbane', breaks: [], completion: { actualStart: '2026-08-18T23:02:00Z' }, medicationsDue: [{ state: 'Overdue', outcome: null }, { state: 'Due', outcome: null }], handover: { requiresAcknowledgement: false, isRead: true } } as never,
    })
    renderPage()
    expect(screen.getByText('1 dose overdue')).toBeInTheDocument()
  })

  it("shows today's Rostered shift as Today with Open shift, and Continue finishing once a finish is under way", () => {
    const later = row({ id: 'shift-3', serviceDate: today, startTime: '15:00:00', endTime: '20:00:00' })
    answer([later])
    const { unmount } = renderPage()
    expect(screen.getByText(/^Today/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open shift' })).toHaveAttribute('href', '/portal/shifts/shift-3')
    unmount()

    const now = row({ id: 'shift-2', serviceDate: today, status: 'InProgress' })
    answer([now])
    sessionStorage.setItem('odip-shift-end-draft:shift-2', JSON.stringify({ step: 'times' }))
    renderPage()
    expect(screen.getByRole('link', { name: 'Continue finishing' })).toBeInTheDocument()
  })

  it('shows no card on another week', () => {
    const now = row({ id: 'shift-2', serviceDate: today, status: 'InProgress' })
    answer([now])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))

    expect(screen.queryByText(/^On shift now/)).not.toBeInTheDocument()
  })

  it('splits the week into Coming up and Earlier (newest first), in worker words, with no badge on a plain Rostered shift', () => {
    answer([
      row({ id: 'a', serviceDate: '2026-08-17', status: 'Completed', participantName: 'Ava Done' }),
      row({ id: 'b', serviceDate: '2026-08-18', status: 'PendingReview', participantName: 'Ben Sent' }),
      row({ id: 'c', serviceDate: '2026-08-20', returnCount: 1, participantName: 'Cara Back' }),
      row({ id: 'd', serviceDate: '2026-08-21', participantName: 'Dan Later' }),
    ])
    renderPage()

    const coming = screen.getByRole('region', { name: 'Coming up' })
    expect(within(coming).getByText('Returned')).toBeInTheDocument()
    expect(within(coming).getByText('Dan Later')).toBeInTheDocument()
    expect(within(coming).queryByText('Rostered')).not.toBeInTheDocument()
    const earlier = screen.getByRole('region', { name: 'Earlier' })
    expect(within(earlier).getAllByRole('link').map(a => a.textContent)).toEqual([expect.stringContaining('Ben Sent'), expect.stringContaining('Ava Done')])
    expect(within(earlier).getByText('Submitted')).toBeInTheDocument()
    expect(within(earlier).getByText('Approved')).toBeInTheDocument()
  })

  it('lists a returned shift whose end has passed under Coming up, oldest first, and leaves a plain past shift in Earlier', () => {
    answer([
      row({ id: 'r', serviceDate: '2026-08-18', returnCount: 1, participantName: 'Rae Returned' }),
      row({ id: 'p', serviceDate: '2026-08-18', startTime: '10:00:00', participantName: 'Pat Plain' }),
      row({ id: 'f', serviceDate: '2026-08-21', participantName: 'Fay Future' }),
    ])
    renderPage()

    const coming = screen.getByRole('region', { name: 'Coming up' })
    expect(within(coming).getAllByRole('link').map(a => a.textContent)).toEqual([expect.stringContaining('Rae Returned'), expect.stringContaining('Fay Future')])
    expect(within(coming).getByText('Returned')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Earlier' })).getByText('Pat Plain')).toBeInTheDocument()
  })
})

describe('PortalShiftsPage: a response with no provider zone (review deep nit)', () => {
  it('still splits the week, reading the device zone instead of throwing', () => {
    const noZone: Partial<PortalShiftsResponseDto> = makeShiftsResponse()
    delete noZone.timeZoneId
    mockUseMyShifts.mockReturnValue({ data: noZone, isLoading: false })
    renderPage()

    expect(screen.getByRole('region', { name: 'Earlier' })).toBeInTheDocument()
  })
})

describe('PortalShiftsPage offline (SHAPE 3b)', () => {
  const saved = (part: string) => localStorage.setItem(`odip_offline:u1:${part}`, JSON.stringify({ savedAt: new Date('2026-08-19T08:05:00+10:00').getTime(), data: {} }))
  beforeEach(() => {
    localStorage.setItem('odip_user', JSON.stringify({ id: 'u1' }))
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false })
  })
  afterEach(() => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true })
    localStorage.clear()
  })

  it('shows the saved week with a notice; a card with no saved detail is not a link and says why', () => {
    saved('shifts:2026-08-16:2026-08-24')
    mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse(), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText(/These are your shifts as saved at .*Only today.s shifts can be opened until you.re back online\./)).toBeInTheDocument()
    expect(screen.getByText('Mia Chen')).toBeInTheDocument()
    expect(screen.getByText('Needs a connection to open')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Mia Chen/ })).not.toBeInTheDocument()
  })

  it('a card whose detail is saved on the phone still opens', () => {
    saved('shifts:2026-08-16:2026-08-24')
    saved('detail:shift-1')
    mockUseMyShifts.mockReturnValue({ data: makeShiftsResponse(), isLoading: false, isError: false, refetch: vi.fn() })
    renderPage()

    expect(screen.getByRole('link', { name: /Mia Chen/ })).toHaveAttribute('href', '/portal/shifts/shift-1')
    expect(screen.queryByText('Needs a connection to open')).not.toBeInTheDocument()
  })

  it('a week that was never saved says so and offers the way back', () => {
    mockUseMyShifts.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch: vi.fn() })
    renderPage()

    expect(screen.getByText("This week isn't saved on this phone.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to this week' })).toBeInTheDocument()
  })
})
