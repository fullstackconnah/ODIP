import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { UnavailabilityFormModal, type UnavailabilityFormModalProps } from './UnavailabilityFormModal'

function noop() {}

// Same reason as LeaveRequestFormModal.test.tsx's renderModal helper: useUnsavedChangesWarning
// (wired in Step 8) needs a data router.
function renderModal(props: UnavailabilityFormModalProps) {
  const router = createMemoryRouter(
    [{ path: '/', element: <UnavailabilityFormModal {...props} /> }],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

describe('UnavailabilityFormModal', () => {
  it('submits dayOfWeek/startTime/endTime/effectiveFrom with no userId in self-service mode', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderModal({ open: true, onClose: noop, onSubmit, submitting: false })

    await user.type(screen.getByLabelText(/start time/i), '09:00')
    await user.type(screen.getByLabelText(/end time/i), '12:00')
    await user.type(screen.getByLabelText(/effective from/i), '2026-09-07')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      dayOfWeek: 'Monday',
      startTime: '09:00:00',
      endTime: '12:00:00',
      effectiveFrom: '2026-09-07',
      effectiveTo: null,
      notes: null,
    })
  })

  it('renders a required staff picker in "enter on behalf" mode and includes userId in the submitted payload', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    const staffOptions = [{ value: 'staff-1', label: 'Alex Rivera' }]
    renderModal({ open: true, onClose: noop, onSubmit, submitting: false, staffOptions })

    await user.click(screen.getByRole('combobox', { name: /staff member/i }))
    await user.click(screen.getByRole('option', { name: 'Alex Rivera' }))
    await user.type(screen.getByLabelText(/start time/i), '09:00')
    await user.type(screen.getByLabelText(/end time/i), '12:00')
    await user.type(screen.getByLabelText(/effective from/i), '2026-09-07')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      dayOfWeek: 'Monday',
      startTime: '09:00:00',
      endTime: '12:00:00',
      effectiveFrom: '2026-09-07',
      effectiveTo: null,
      notes: null,
      userId: 'staff-1',
    })
  })

  it('sends an explicit effectiveTo when provided', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderModal({ open: true, onClose: noop, onSubmit, submitting: false })

    await user.type(screen.getByLabelText(/start time/i), '09:00')
    await user.type(screen.getByLabelText(/end time/i), '12:00')
    await user.type(screen.getByLabelText(/effective from/i), '2026-09-07')
    await user.type(screen.getByLabelText(/effective to/i), '2026-12-31')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ effectiveTo: '2026-12-31' }))
  })

  it('disables the submit button while submitting', () => {
    renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: true })
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })

  describe('edit mode', () => {
    const initialValues = {
      dayOfWeek: 'Tuesday', startTime: '10:00', endTime: '13:00',
      effectiveFrom: '2026-09-07', effectiveTo: '2026-12-31', notes: 'Physio appointment.',
    }

    it('titles itself "Edit regular unavailability", labels the submit button "Save changes", and hides the staff picker', () => {
      renderModal({
        open: true, onClose: noop, onSubmit: vi.fn(), submitting: false, mode: 'edit', initialValues,
        staffOptions: [{ value: 'staff-1', label: 'Alex Rivera' }],
      })

      expect(screen.getByText('Edit regular unavailability')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^save changes$/i })).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /staff member/i })).not.toBeInTheDocument()
    })

    it('pre-fills the form from initialValues and submits the edited values with no userId', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn(async () => {})
      renderModal({ open: true, onClose: noop, onSubmit, submitting: false, mode: 'edit', initialValues })

      expect(screen.getByLabelText(/start time/i)).toHaveValue('10:00')
      expect(screen.getByLabelText(/effective from/i)).toHaveValue('2026-09-07')

      await user.click(screen.getByRole('button', { name: /^save changes$/i }))

      expect(onSubmit).toHaveBeenCalledWith({
        dayOfWeek: 'Tuesday', startTime: '10:00:00', endTime: '13:00:00',
        effectiveFrom: '2026-09-07', effectiveTo: '2026-12-31', notes: 'Physio appointment.',
      })
    })
  })
})
