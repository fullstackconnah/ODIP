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
      startTime: '09:00',
      endTime: '12:00',
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
      startTime: '09:00',
      endTime: '12:00',
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
})
