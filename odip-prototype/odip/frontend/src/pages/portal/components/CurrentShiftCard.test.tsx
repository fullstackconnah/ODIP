import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CurrentShiftCard } from './CurrentShiftCard'
import type { PortalShiftSummaryDto } from '@/api/types'

vi.mock('@/api/hooks', () => ({ usePortalShiftDetail: () => ({ data: undefined }) }))

const SHIFT: PortalShiftSummaryDto = {
  id: 'shift-1', participantId: 'p-1', participantName: 'Mia Chen', serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false,
  durationHours: 8, ratio: 'OneToOne', nightType: 'None', status: 'Published', notes: null, returnCount: 0,
}

const show = (overrides: Partial<PortalShiftSummaryDto> = {}) => render(<MemoryRouter><CurrentShiftCard shift={{ ...SHIFT, ...overrides }} /></MemoryRouter>)

describe('CurrentShiftCard location', () => {
  it('shows the typed location once, with a screen-reader label', () => {
    show({ location: 'Southside Library' })
    expect(screen.getAllByText(/location:/i)).toHaveLength(1)
    expect(screen.getByText('Southside Library')).toHaveAttribute('title', 'Southside Library')
  })

  it.each([[null], [undefined], ['   ']])('shows no row for %s', (location) => {
    show({ location })
    expect(screen.queryByText(/location:/i)).not.toBeInTheDocument()
    expect(document.querySelector('svg.lucide-map-pin')).toBeNull()
  })
})
