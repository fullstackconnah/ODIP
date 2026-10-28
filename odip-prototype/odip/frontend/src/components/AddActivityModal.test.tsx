import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import AddActivityModal from './AddActivityModal'
import type { ScheduledActivityDto } from '@/api/types/activities'

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

describe('AddActivityModal — Notes fold motion', () => {
  const notesFold = () => screen.getByText('Notes').closest('details')
  const editing = { id: 'a1', tripDayId: 'd1', title: 'Zoo', accessibilityNotes: null, notes: 'Bring water' } as unknown as ScheduledActivityDto

  it('appears at once when editing an activity that already has notes', () => {
    render(<AddActivityModal tripDayId="d1" editingActivity={editing} onClose={() => {}} />)
    expect(notesFold()).toHaveAttribute('data-fold-static')
  })

  it('still fades when a new activity gets its Notes fold opened', () => {
    render(<AddActivityModal tripDayId="d1" onClose={() => {}} />)
    expect(notesFold()).not.toHaveAttribute('data-fold-static')
  })
})
