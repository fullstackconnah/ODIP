import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TripsPage from './TripsPage'
import type { TripListDto } from '@/api/types'

const { mockUseTrips, mockUseTrip, mockPatchMutate } = vi.hoisted(() => ({
  mockUseTrips: vi.fn(),
  mockUseTrip: vi.fn(),
  mockPatchMutate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useTrips: mockUseTrips,
  useTrip: mockUseTrip,
  usePatchTrip: () => ({ mutate: mockPatchMutate, isPending: false }),
}))

// The edit modal has its own suite; a stub is enough to prove the pencil opens it.
vi.mock('./trip-detail', () => ({
  EditTripModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="Edit trip">
      <button type="button" onClick={onClose}>Close edit</button>
    </div>
  ),
}))

function trip(overrides: Partial<TripListDto> = {}): TripListDto {
  return {
    id: 't1',
    tripName: 'Beach Weekend',
    tripCode: 'BW-2610',
    destination: 'Byron Bay',
    region: 'NSW',
    startDate: '2026-10-10',
    endDate: '2026-10-13',
    durationDays: 4,
    status: 'Confirmed',
    maxParticipants: 8,
    currentParticipantCount: 6,
    waitlistCount: 2,
    leadCoordinatorName: 'Alex Rivera',
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/trips']}>
      <Routes>
        <Route path="/trips" element={<TripsPage />} />
        <Route path="/trips/:id" element={<div>Trip detail page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.setItem('odip_user', JSON.stringify({ role: 'Admin' }))
  // The table view is the default on wide screens; jsdom has no matchMedia, so pin it.
  localStorage.setItem('odip.trips.view', 'table')
  mockUseTrips.mockReturnValue({ data: [trip()], isLoading: false })
  mockUseTrip.mockReturnValue({ data: undefined })
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('TripsPage — table view density', () => {
  it('puts the trip code inline after the name on ONE line, so the row can stay at --row-h', () => {
    renderPage()

    const name = screen.getByText('Beach Weekend')
    const code = screen.getByText('BW-2610')
    // Same flex row, both inline spans — the old cell stacked two <p> blocks (51px rows).
    expect(name.parentElement).toBe(code.parentElement)
    expect(name.parentElement).toHaveClass('flex', 'items-baseline')
    expect(name.tagName).toBe('SPAN')
    expect(code.tagName).toBe('SPAN')
    expect(name.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The code is secondary text, muted, and at the 13px floor rather than 12px micro type.
    expect(code).toHaveClass('text-[13px]', 'text-[var(--color-muted-foreground)]')
    expect(code).not.toHaveClass('text-xs')
  })

  it('renders no code element for a trip without a code', () => {
    mockUseTrips.mockReturnValue({ data: [trip({ tripCode: null })], isLoading: false })
    renderPage()

    expect(screen.getByText('Beach Weekend').parentElement?.children).toHaveLength(1)
  })

  it('keeps the status pill at the 24px --control-h-sm token and outside the hover-revealed actions', () => {
    renderPage()

    const row = screen.getByText('Beach Weekend').closest('tr') as HTMLElement
    const pill = within(row).getByRole('button', { name: 'Confirmed' })
    expect(pill).toHaveClass('h-[var(--control-h-sm)]')
    expect(pill.closest('[class*="group-hover/row:opacity-100"]')).toBeNull()
  })

  it('moves the edit pencil into a hover/focus-revealed cluster as a 24px icon square, with its label and title', () => {
    renderPage()

    const edit = screen.getByRole('button', { name: 'Edit Beach Weekend' })
    expect(edit).toHaveAttribute('title', 'Edit trip')
    expect(edit).toHaveClass('h-[var(--control-h-sm)]', 'w-[var(--control-h-sm)]', 'p-0')

    const cluster = edit.parentElement as HTMLElement
    expect(cluster).toHaveClass('opacity-0', 'group-hover/row:opacity-100', 'group-focus-within/row:opacity-100', '[@media(pointer:coarse)]:opacity-100')
    // Not in the Status cell any more.
    const statusCell = screen.getByRole('button', { name: 'Confirmed' }).closest('td') as HTMLElement
    expect(statusCell).not.toContainElement(edit)
  })

  it('hides the edit action (and its column) for a role that cannot write', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    renderPage()

    expect(screen.queryByRole('button', { name: 'Edit Beach Weekend' })).not.toBeInTheDocument()
    // Six data columns only — no empty trailing header for the missing actions.
    expect(screen.getAllByRole('columnheader')).toHaveLength(6)
  })

  it('opens the edit modal from the pencil without also opening the trip', async () => {
    const user = userEvent.setup()
    mockUseTrip.mockReturnValue({ data: { id: 't1' } })
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Edit Beach Weekend' }))

    expect(screen.getByRole('dialog', { name: 'Edit trip' })).toBeInTheDocument()
    expect(screen.queryByText('Trip detail page')).not.toBeInTheDocument()
  })

  it('opens the edit modal from the keyboard (Enter on the pencil) instead of navigating to the trip', async () => {
    const user = userEvent.setup()
    mockUseTrip.mockReturnValue({ data: { id: 't1' } })
    renderPage()

    screen.getByRole('button', { name: 'Edit Beach Weekend' }).focus()
    await user.keyboard('{Enter}')

    // The clickable row used to swallow the keydown and navigate away.
    expect(screen.getByRole('dialog', { name: 'Edit trip' })).toBeInTheDocument()
    expect(screen.queryByText('Trip detail page')).not.toBeInTheDocument()
  })

  it('still opens the trip when the row itself is clicked', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByText('Byron Bay · NSW'))

    expect(screen.getByText('Trip detail page')).toBeInTheDocument()
  })

  it('renders secondary text at the 13px floor and the waitlist badge at 12px, not 10px micro type', () => {
    renderPage()

    expect(screen.getByText('(4d)')).toHaveClass('text-[13px]')
    const waitlist = screen.getByText('2 wait')
    expect(waitlist).toHaveClass('text-xs')
    expect(waitlist).not.toHaveClass('text-[10px]')
  })

  it('keeps the title row and the filter row in one block-flow wrapper so the header is 72px, not gap-spaced', () => {
    renderPage()

    const h1 = screen.getByRole('heading', { level: 1, name: 'Trips' })
    const search = screen.getByPlaceholderText('Search trips...')
    const wrapper = h1.parentElement?.parentElement?.parentElement as HTMLElement
    expect(wrapper).toContainElement(search)
    expect(wrapper.tagName).toBe('DIV')
    expect(wrapper.className).toBe('')
  })
})
