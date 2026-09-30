import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import TripStatusBadge from './TripStatusBadge'
import { StatusBadge } from '@/components/StatusBadge'
import { TONE } from '@/lib/tone'
import { TRIP_STATUSES } from '@/api/types/enums'

// The schedule's trip status pill is coloured by StatusBadge's tones, like the trip header, the dashboard and the trips list.
describe('TripStatusBadge (schedule)', () => {
  it.each([
    ['Draft', 'neutral'],
    ['Planning', 'info'],
    ['OpenForBookings', 'success'],
    ['WaitlistOnly', 'warning'],
    ['Confirmed', 'success'],
    ['InProgress', 'accessible'],
    ['Completed', 'success'],
    ['Cancelled', 'danger'],
    ['Archived', 'neutral'],
  ] as const)('colours %s with the %s tone', (status, tone) => {
    render(<TripStatusBadge status={status} />)
    const pill = screen.getByText(status.replace(/([A-Z])/g, ' $1').trim())
    expect(pill).toHaveClass('shrink-0', 'whitespace-nowrap', 'text-xs', 'px-2', 'py-0.5', 'rounded-full', 'font-semibold', ...TONE[tone].solid.split(' '))
  })

  it('wears the same colours as StatusBadge for every trip status', () => {
    for (const status of TRIP_STATUSES) {
      const badge = render(<StatusBadge status={status} label="badge" />)
      const badgeColours = badge.container.firstElementChild!.className.split(' ').filter(c => /^(bg|text)-\[var/.test(c))
      badge.unmount()
      const pill = render(<TripStatusBadge status={status} />)
      const pillColours = pill.container.firstElementChild!.className.split(' ').filter(c => /^(bg|text)-\[var/.test(c))
      pill.unmount()
      expect(pillColours, status).toEqual(badgeColours)
    }
  })
})
