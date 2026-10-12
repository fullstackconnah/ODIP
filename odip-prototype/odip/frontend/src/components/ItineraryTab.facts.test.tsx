import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ItineraryTab from './ItineraryTab'

vi.mock('@/api/hooks', () => ({
  useTripItinerary: () => ({ data: { tripName: 'T', startDate: '2026-11-01', endDate: '2026-11-02', days: [], participants: [], staff: [], vehicles: [], accommodation: [] }, isLoading: false, isError: false }),
}))

// Platform review VISUAL-1 (Trip detail, phone): the facts stacked label over value below sm, so seven mostly empty facts took ~450px.
describe('ItineraryTab — Trip Details and Requirements facts', () => {
  it('keep label and value side by side at every width', () => {
    render(<ItineraryTab tripId="t1" trip={{ eventTemplateName: null, requiredBeds: 4 }} />)

    for (const label of ['Event Template', 'Required Beds']) {
      const grid = screen.getByText(label).parentElement as HTMLElement
      expect(grid, label).toHaveClass('grid', 'grid-cols-2')
      expect(grid.className, label).not.toMatch(/grid-cols-1/)
    }
  })
})
