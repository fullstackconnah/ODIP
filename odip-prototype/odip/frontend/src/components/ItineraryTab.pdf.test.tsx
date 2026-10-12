import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ItineraryTab from './ItineraryTab'

const { loaded, generate } = vi.hoisted(() => ({ loaded: vi.fn(), generate: vi.fn() }))

// The factory runs when ./ItineraryPdf is first imported, so `loaded` shows when the PDF library is pulled in.
vi.mock('./ItineraryPdf', () => { loaded(); return { generateItineraryPdf: generate } })
vi.mock('@/api/hooks', () => ({
  useTripItinerary: () => ({ data: { tripName: 'T', startDate: '2026-11-01', endDate: '2026-11-02', days: [], participants: [], staff: [], vehicles: [], accommodation: [] }, isLoading: false, isError: false }),
}))

describe('ItineraryTab — the PDF library', () => {
  it('is loaded when a PDF is asked for, not with the tab', async () => {
    const user = userEvent.setup()
    render(<ItineraryTab tripId="t1" />)
    expect(loaded).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Export Trip Package/ }))
    await user.click(await screen.findByText('Staff Version'))
    expect(loaded).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledWith(expect.anything(), 'staff')
  })
})
