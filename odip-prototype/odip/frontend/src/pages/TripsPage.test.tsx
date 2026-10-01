import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import TripsPage from './TripsPage'
import type { TripListDto } from '@/api/types'
import { TAP_AREA } from '@/components/tapArea'
import { TONE } from '@/lib/tone'

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

// Density verdict, narrow desktops: the table is the default from 1280, and every row must still be
// exactly --row-h there. Cells never wrap (DataTable), so the page decides what gives when the
// window is narrow: caps that cut text with an ellipsis, and columns that drop by breakpoint.
describe('TripsPage — narrow-desktop table', () => {
  it('cuts a long trip name at a responsive cap and keeps the name and code in its tooltip', () => {
    renderPage()

    const name = screen.getByText('Beach Weekend')
    // Three ranges that never overlap (below 1536, 1536-1791, 1792+): the built CSS emits the
    // arbitrary `min-[1792px]` variant before the named breakpoints, so a stacked `md:` / `2xl:`
    // cap would win over it at 1920.
    expect(name).toHaveClass('truncate', 'md:max-2xl:max-w-[14rem]', '2xl:max-[1792px]:max-w-[18rem]', 'min-[1792px]:max-w-[22rem]')
    expect(name.className).not.toMatch(/(^|\s)(md|2xl):max-w-/)
    expect(name).toHaveAttribute('title', 'Beach Weekend (BW-2610)')
  })

  it('titles a trip without a code with just its name', () => {
    mockUseTrips.mockReturnValue({ data: [trip({ tripCode: null })], isLoading: false })
    renderPage()

    expect(screen.getByText('Beach Weekend')).toHaveAttribute('title', 'Beach Weekend')
  })

  it('drops the trip code below 1366px (it is in the name\'s tooltip) and shows it from there up', () => {
    renderPage()

    const code = screen.getByText('BW-2610')
    expect(code).toHaveClass('md:max-[1366px]:hidden')
    // Hidden only on the desktop table; the mobile card view keeps it.
    expect(code.className).not.toMatch(/(^|\s)hidden(\s|$)/)
  })

  it('cuts the destination and region at a cap that grows with the room, full text in the title', () => {
    mockUseTrips.mockReturnValue({
      data: [trip({ destination: 'Mount Tamborine QLD', region: 'Gold Coast Hinterland' })],
      isLoading: false,
    })
    renderPage()

    const destination = screen.getByText('Mount Tamborine QLD · Gold Coast Hinterland')
    // Three non-overlapping ranges (below 1366, 1366-1791, 1792+), so none depends on CSS source order:
    // 12rem keeps 1280 (the tightest width) 53px clear, 13.5rem returns at 1366, 22rem at 1792.
    expect(destination).toHaveClass(
      'block', 'md:truncate',
      'md:max-[1366px]:max-w-[12rem]', 'min-[1366px]:max-[1792px]:max-w-[13.5rem]', 'min-[1792px]:max-w-[22rem]',
    )
    expect(destination.className).not.toMatch(/(^|\s)(md|2xl):max-w-/)
    expect(destination).toHaveAttribute('title', 'Mount Tamborine QLD · Gold Coast Hinterland')
  })

  it('drops the Lead column below 2xl, header and cell together, and the duration until 1792px', () => {
    renderPage()

    expect(screen.getByRole('columnheader', { name: 'Lead' })).toHaveClass('md:max-2xl:hidden')
    const lead = screen.getByText('Alex Rivera')
    expect(lead).toHaveAttribute('title', 'Alex Rivera')
    expect(lead.closest('td')).toHaveClass('md:max-2xl:hidden')
    // "(4d)" is 13px secondary text that costs 30px of the Dates column: it returns with the room, at 1792.
    expect(screen.getByText('(4d)')).toHaveClass('text-[13px]', 'md:max-[1792px]:hidden')
    // Every other column stays at 1280.
    for (const label of ['Trip', 'Destination', 'Dates', 'Status', 'Pax']) {
      expect(screen.getByRole('columnheader', { name: label }).className, label).not.toMatch(/max-(xl|2xl)/)
    }
  })

  it('keeps the status pill on one line, in a column wide enough for "Open For Bookings" plus its caret', () => {
    mockUseTrips.mockReturnValue({ data: [trip({ status: 'OpenForBookings' })], isLoading: false })
    renderPage()

    const pill = screen.getByRole('button', { name: 'Open For Bookings' })
    expect(pill).toHaveClass('whitespace-nowrap', 'h-[var(--control-h-sm)]')
    const header = screen.getByRole('columnheader', { name: 'Status' })
    const cell = pill.closest('td') as HTMLElement
    for (const el of [header, cell]) {
      expect(el).toHaveClass('md:min-w-[var(--col-min)]')
      expect(el.getAttribute('style')).toContain('--col-min: 10.25rem')
    }
    // 10.25rem = 164px. The pill is 10px left padding + 104.3px of 12px/500 text + 24px right padding
    // (room for the caret) = 138.3px, and the cell adds 2 x 12px: 162.3px. It fits with 1.7px to spare.
    expect(10.25 * 16).toBeGreaterThanOrEqual(10 + 104.3 + 24 + 2 * 12)
  })
})

// Density verdict, touch: every control on this page reaches a 44px hit area under `pointer: coarse` (spec §1)
// without changing its box. jsdom has no layout or media queries, so the tests pin the class contract; the mouse
// classes are asserted too, because the desktop look must not move.
describe('TripsPage — 44px hit areas on a touch screen', () => {
  const pad = TAP_AREA.split(' ')

  it('pads the "All Statuses" filter pill and every card status pill (24px pills, 44px targets)', () => {
    localStorage.setItem('odip.trips.view', 'cards')
    renderPage()

    expect(screen.getByRole('button', { name: 'All Statuses' })).toHaveClass(...pad)
    expect(screen.getByRole('button', { name: 'Confirmed' })).toHaveClass(...pad)
  })

  it('pads the status pill in the table view too', () => {
    renderPage()

    const row = screen.getByText('Beach Weekend').closest('tr') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Confirmed' })).toHaveClass(...pad)
  })

  it('pads the table edit pencil (Button iconOnly) so the 36px square is a 44px target', () => {
    renderPage()

    expect(screen.getByRole('button', { name: 'Edit Beach Weekend' })).toHaveClass(...pad)
  })

  it('shows the card pencil on a touch screen (no hover there) with a 44px hit area and room around it', () => {
    localStorage.setItem('odip.trips.view', 'cards')
    renderPage()

    const pencil = screen.getByRole('button', { name: 'Edit trip' })
    // 26px visual (p-1.5 + a 14px icon), padded to 44px by the pseudo-element.
    expect(pencil).toHaveClass(...pad, 'p-1.5', 'pointer-coarse:opacity-100')
    // Its wrapper stops collapsing and clipping under coarse: max-w-0 would hide it, overflow-hidden would cut the pad.
    const wrapper = pencil.parentElement as HTMLElement
    expect(wrapper).toHaveClass('pointer-coarse:max-w-none', 'pointer-coarse:overflow-visible')
    // The gap to the status pill opens past the pencil's 9px reach so the pill keeps its own taps.
    expect(wrapper.parentElement).toHaveClass('gap-1', 'pointer-coarse:gap-3')
    // The pencil's width comes out of the footer: under coarse the footer wraps its two halves as units, so the
    // participant info drops to its own line rather than a "1 waitlist" chip breaking in two.
    expect(wrapper.parentElement?.parentElement).toHaveClass('flex', 'justify-between', 'pointer-coarse:flex-wrap', 'pointer-coarse:gap-y-2')
  })

  it('keeps the card pencil hover-revealed on a mouse: collapsed and transparent until the card is hovered or focused', () => {
    localStorage.setItem('odip.trips.view', 'cards')
    renderPage()

    const pencil = screen.getByRole('button', { name: 'Edit trip' })
    expect(pencil).toHaveClass('opacity-0', 'group-hover:opacity-100', 'focus-within:opacity-100')
    const wrapper = pencil.parentElement as HTMLElement
    expect(wrapper).toHaveClass('max-w-0', 'overflow-hidden', 'group-hover:max-w-[2rem]', 'focus-within:max-w-[2rem]')
  })

  it('still opens the edit modal from the card pencil', async () => {
    const user = userEvent.setup()
    localStorage.setItem('odip.trips.view', 'cards')
    mockUseTrip.mockReturnValue({ data: { id: 't1' } })
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Edit trip' }))

    expect(screen.getByRole('dialog', { name: 'Edit trip' })).toBeInTheDocument()
    expect(screen.queryByText('Trip detail page')).not.toBeInTheDocument()
  })
})

// The app shell no longer has a "New Trip" shortcut (AppLayout's sidebar call to action and the mobile bottom-nav "+" are
// gone), so this header button is how a coordinator starts a trip from the nav. It stays, for everyone who can write.
describe('TripsPage — starting a new trip', () => {
  it('keeps the "New Trip" button in the page header, linking to /trips/new', () => {
    renderPage()

    expect(screen.getByRole('link', { name: /New Trip/ })).toHaveAttribute('href', '/trips/new')
  })

  it('hides the button from a role that cannot write', () => {
    localStorage.setItem('odip_user', JSON.stringify({ role: 'SupportWorker' }))
    renderPage()

    expect(screen.queryByRole('link', { name: /New Trip/ })).not.toBeInTheDocument()
  })
})

// A trip status is coloured one way everywhere (lib/tone.ts): these pills used `getStatusColor`, which had no entry for Planning,
// OpenForBookings or InProgress, so all three were amber (the warning signal) on this page and something else on the trip header.
describe('TripsPage — trip status pills use the shared tones', () => {
  it.each([
    ['Draft', 'neutral'],
    ['Planning', 'info'],
    ['OpenForBookings', 'success'],
    ['Confirmed', 'success'],
    ['InProgress', 'info'], // owner decision: in progress is information (blue)
  ] as const)('colours a %s trip with the %s tone in the table and in the cards', (status, tone) => {
    mockUseTrips.mockReturnValue({ data: [trip({ status })], isLoading: false })
    const label = status.replace(/([A-Z])/g, ' $1').trim()

    const table = renderPage()
    expect(screen.getByRole('button', { name: label })).toHaveClass(...TONE[tone].solid.split(' '))
    table.unmount()

    localStorage.setItem('odip.trips.view', 'cards')
    renderPage()
    expect(screen.getByRole('button', { name: label })).toHaveClass(...TONE[tone].solid.split(' '))
  })

  it('shows the waitlist count in the warning tone (table and cards), not the old badge-pending class', () => {
    const table = renderPage()
    expect(screen.getByText('2 wait')).toHaveClass('rounded-full', 'text-xs', ...TONE.warning.solid.split(' '))
    expect(screen.getByText('2 wait').className).not.toMatch(/badge-/)
    table.unmount()

    localStorage.setItem('odip.trips.view', 'cards')
    renderPage()
    expect(screen.getByText('2 waitlist')).toHaveClass('rounded-full', 'text-xs', ...TONE.warning.solid.split(' '))
  })
})

describe('TripsPage — Pax ratio', () => {
  it('spells the participant ratio "x / y" with a space each side of the slash', () => {
    mockUseTrips.mockReturnValue({ data: [trip(), trip({ id: 't2', tripName: 'No cap', currentParticipantCount: 3, maxParticipants: 0 })], isLoading: false })
    renderPage()

    expect(screen.getByText('6 / 8')).toBeInTheDocument()
    expect(screen.getByText('3 / —')).toBeInTheDocument()
  })
})
