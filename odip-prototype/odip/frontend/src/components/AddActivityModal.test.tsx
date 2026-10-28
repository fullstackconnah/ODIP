import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('AddActivityModal — Notes fold stays open once it has opened', () => {
  const notesFold = () => screen.getByText('Notes').closest('details') as HTMLDetailsElement
  const editing = { id: 'a1', tripDayId: 'd1', title: 'Zoo', accessibilityNotes: 'Ramp', notes: 'Bring water' } as unknown as ScheduledActivityDto

  it('opens when a note is typed and does not snap shut when the note is cleared', async () => {
    render(<AddActivityModal tripDayId="d1" onClose={() => {}} />)
    expect(notesFold().open).toBe(false)
    await userEvent.type(screen.getByLabelText('General Notes'), 'x')
    expect(notesFold().open).toBe(true)
    await userEvent.clear(screen.getByLabelText('General Notes'))
    expect(notesFold().open).toBe(true)
  })

  it('is open when editing an activity with notes and stays open when both are cleared', async () => {
    render(<AddActivityModal tripDayId="d1" editingActivity={editing} onClose={() => {}} />)
    expect(notesFold().open).toBe(true)
    await userEvent.clear(screen.getByLabelText('Accessibility Notes'))
    await userEvent.clear(screen.getByLabelText('General Notes'))
    expect(notesFold().open).toBe(true)
  })

  it('starts closed on a blank add', () => {
    render(<AddActivityModal tripDayId="d1" onClose={() => {}} />)
    expect(notesFold().open).toBe(false)
  })
})

describe('AddActivityModal — footer and end-time error', () => {
  it('pins the footer so the buttons stay in view while the body scrolls', () => {
    render(<AddActivityModal tripDayId="d1" onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Cancel' }).parentElement).toHaveClass('sticky', 'bottom-0')
  })

  it('shows the end-before-start error inside the End Time field, and still blocks the save', async () => {
    const user = userEvent.setup()
    render(<AddActivityModal tripDayId="d1" onClose={() => {}} />)
    await user.type(screen.getByLabelText(/^Title/), 'Zoo')
    await user.type(screen.getByLabelText('Start Time'), '10:00')
    await user.type(screen.getByLabelText('End Time'), '09:00')
    await user.click(screen.getByRole('button', { name: 'Add Activity' }))
    const end = screen.getByLabelText('End Time')
    const alert = screen.getByText('End time must be after start time')
    expect(end.parentElement).toContainElement(alert)
    expect(end).toHaveAttribute('aria-invalid', 'true')
    expect(end).toHaveAccessibleDescription('End time must be after start time')
  })
})
