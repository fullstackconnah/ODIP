import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { AvailabilityRecordFormModal, type AvailabilityRecordFormModalProps } from './AvailabilityRecordFormModal'

function noop() {}

// useUnsavedChangesWarning needs a data router — same reason as LeaveRequestFormModal.test.tsx.
function renderModal(props: AvailabilityRecordFormModalProps) {
  const router = createMemoryRouter(
    [{ path: '/', element: <AvailabilityRecordFormModal {...props} /> }],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

const staffOptions = [{ value: 'staff-1', label: 'Alex Rivera' }]

describe('AvailabilityRecordFormModal', () => {
  it('requires a staff selection and submits a CreateStaffAvailabilityDto with isRecurring: false', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderModal({ open: true, onClose: noop, onSubmit, submitting: false, staffOptions })

    await user.click(screen.getByRole('combobox', { name: /staff member/i }))
    await user.click(screen.getByRole('option', { name: 'Alex Rivera' }))
    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      staffId: 'staff-1',
      startDateTime: '2026-09-14T00:00:00',
      endDateTime: '2026-09-18T23:59:59',
      availabilityType: 'Available',
      isRecurring: false,
      notes: undefined,
    })
  })

  it('offers Available/Unavailable/Training/Preferred/Tentative but not Leave as record types', async () => {
    const user = userEvent.setup()
    renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: false, staffOptions })

    await user.click(screen.getByRole('button', { name: /type/i }))
    const options = screen.getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['Available', 'Unavailable', 'Training', 'Preferred', 'Tentative'])
  })

  it('disables the submit button while submitting', () => {
    renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: true, staffOptions })
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })

  it('surfaces an errorMessage prop', () => {
    renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: false, staffOptions, errorMessage: 'Could not save this record.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save this record.')
  })

  describe('edit mode', () => {
    const initialValues = { availabilityType: 'Training' as const, startDate: '2026-09-14', endDate: '2026-09-18', notes: 'Fire warden refresher.' }

    it('titles itself "Edit availability record", labels the submit button "Save changes", and hides the staff picker', () => {
      renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: false, mode: 'edit', initialValues, staffOptions })

      expect(screen.getByText('Edit availability record')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^save changes$/i })).toBeInTheDocument()
      expect(screen.queryByRole('combobox', { name: /staff member/i })).not.toBeInTheDocument()
    })

    it('pre-fills the form from initialValues and submits the edited values with no staffId', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn(async () => {})
      renderModal({ open: true, onClose: noop, onSubmit, submitting: false, mode: 'edit', initialValues })

      expect(screen.getByLabelText(/start date/i)).toHaveValue('2026-09-14')
      expect(screen.getByLabelText(/end date/i)).toHaveValue('2026-09-18')

      await user.click(screen.getByRole('button', { name: /^save changes$/i }))

      expect(onSubmit).toHaveBeenCalledWith({
        staffId: '',
        startDateTime: '2026-09-14T00:00:00',
        endDateTime: '2026-09-18T23:59:59',
        availabilityType: 'Training',
        isRecurring: false,
        notes: 'Fire warden refresher.',
      })
    })
  })
})
