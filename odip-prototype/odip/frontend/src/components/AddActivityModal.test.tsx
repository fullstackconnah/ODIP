import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AddActivityModal from './AddActivityModal'

const { mutation } = vi.hoisted(() => ({ mutation: () => ({ mutate: () => undefined, isPending: false, isError: false }) }))

vi.mock('@/api/hooks', () => ({
  useActivities: () => ({ data: [] }),
  useCreateScheduledActivity: mutation,
  useUpdateScheduledActivity: mutation,
}))

describe('AddActivityModal — form labels', () => {
  it('names every field so its label finds the control, and marks Title and Status required', () => {
    render(<AddActivityModal tripDayId="d1" onClose={() => {}} />)
    expect(screen.getByLabelText(/^Title/)).toBeRequired()
    expect(screen.getByRole('button', { name: /^Status/ })).toHaveAttribute('aria-required', 'true')
    for (const label of ['Start Time', 'End Time', 'Location', 'Estimated Cost', 'Booking Reference', 'Activity Library']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })
})
