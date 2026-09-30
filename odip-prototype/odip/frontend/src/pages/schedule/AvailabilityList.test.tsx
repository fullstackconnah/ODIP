import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AvailabilityList from './AvailabilityList'
import type { ScheduleAvailabilityItemDto } from '@/api/types'
import { TAP_AREA } from '@/components/tapArea'

function makeItem(overrides: Partial<ScheduleAvailabilityItemDto> = {}): ScheduleAvailabilityItemDto {
  return {
    id: 'avail-1',
    kind: 'Legacy',
    status: null,
    leaveType: null,
    availabilityType: 'Unavailable',
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    dayOfWeek: null,
    startTime: null,
    endTime: null,
    notes: null,
    ...overrides,
  }
}

function renderList(availability: ScheduleAvailabilityItemDto[] = []) {
  render(
    <MemoryRouter>
      <AvailabilityList staffId="staff-1" availability={availability} />
    </MemoryRouter>,
  )
}

describe('AvailabilityList — header + manage link', () => {
  it('renders the "Availability" header', () => {
    renderList([makeItem()])
    expect(screen.getByText('Availability')).toBeInTheDocument()
  })

  it('links to the leave page for this staff member', () => {
    renderList([makeItem()])
    const link = screen.getByRole('link', { name: /manage on leave page/i })
    expect(link).toHaveAttribute('href', '/rostering/leave?userId=staff-1')
  })
})

describe('AvailabilityList — empty state', () => {
  it('shows the empty message and manage link when there are no records', () => {
    renderList([])
    expect(screen.getByText(/no leave, unavailability or availability records in this schedule window/i)).toBeInTheDocument()
    for (const link of screen.getAllByRole('link', { name: /manage on leave page/i })) {
      expect(link).toHaveAttribute('href', '/rostering/leave?userId=staff-1')
    }
  })
})

describe('AvailabilityList — Leave rows', () => {
  it('renders a Leave row with its type label, window and status badge', () => {
    renderList([makeItem({
      kind: 'Leave', status: 'Approved', leaveType: 'Annual', availabilityType: null,
      startDate: '2026-09-01', endDate: '2026-09-05',
    })])
    expect(screen.getByText('Leave — Annual')).toBeInTheDocument()
    expect(screen.getByText('1 Sep 2026 – 5 Sep 2026')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
  })
})

describe('AvailabilityList — RecurringRule rows', () => {
  it('renders a regular unavailability row with day/time window and status', () => {
    renderList([makeItem({
      kind: 'RecurringRule', status: 'Pending', leaveType: null, availabilityType: null,
      dayOfWeek: 'Monday', startTime: '09:00:00', endTime: '17:00:00',
      startDate: '2026-09-01', endDate: '2026-09-30',
    })])
    expect(screen.getByText('Regular unavailability')).toBeInTheDocument()
    expect(screen.getByText('Monday 09:00–17:00, 1 Sep 2026 – 30 Sep 2026')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('shows an open-ended range via formatEffectiveRange when endDate is null', () => {
    renderList([makeItem({
      kind: 'RecurringRule', status: 'Approved', leaveType: null, availabilityType: null,
      dayOfWeek: 'Friday', startTime: '13:00:00', endTime: '15:30:00',
      startDate: '2026-09-01', endDate: null,
    })])
    expect(screen.getByText('Friday 13:00–15:30, 1 Sep 2026 – ongoing')).toBeInTheDocument()
  })
})

describe('AvailabilityList — Legacy rows', () => {
  it('renders a legacy row with its availabilityType label, window, and no status badge', () => {
    renderList([makeItem({
      kind: 'Legacy', status: null, availabilityType: 'Training',
      startDate: '2026-09-01', endDate: '2026-09-05',
    })])
    expect(screen.getByText('Training')).toBeInTheDocument()
    expect(screen.getByText('1 Sep 2026 – 5 Sep 2026')).toBeInTheDocument()
    expect(screen.queryByText('Approved')).not.toBeInTheDocument()
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()
  })

  it('renders notes when present', () => {
    renderList([makeItem({ notes: 'Back-to-back training block' })])
    expect(screen.getByText('Back-to-back training block')).toBeInTheDocument()
  })

  it('does not render notes text when absent', () => {
    renderList([makeItem({ notes: null })])
    expect(screen.queryByText('Back-to-back training block')).not.toBeInTheDocument()
  })
})

// Density verdict, touch: the card-header link is 19.5px tall, so under `pointer: coarse` it carries the TAP_AREA
// pad (a 44px hit area centred on it) instead of growing. The link inside the empty-state sentence is inline prose
// and stays as it is.
describe('AvailabilityList — 44px coarse-pointer hit area', () => {
  const pad = TAP_AREA.split(' ')

  it('pads the header "Manage on Leave page" link without touching its text size or colour', () => {
    renderList([makeItem()])
    const link = screen.getByRole('link', { name: /manage on leave page/i })
    expect(link).toHaveClass(...pad, 'text-[13px]', 'text-[var(--color-primary)]', 'hover:underline')
  })

  it('leaves the inline link inside the empty-state sentence unpadded (a pad there would overlap the prose)', () => {
    renderList([])
    const [header, inline] = screen.getAllByRole('link', { name: /manage on leave page/i })
    expect(header).toHaveClass(...pad)
    expect(inline.className).not.toContain('before:')
    expect(inline).not.toHaveClass('relative')
  })
})
