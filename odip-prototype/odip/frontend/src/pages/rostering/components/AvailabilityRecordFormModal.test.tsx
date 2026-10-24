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

    describe('the record being edited', () => {
      // What GET /staff-availability returns: the form shows only some of it, but the PUT replaces all of it.
      const record = {
        id: 'rec-1', staffId: 'staff-1', startDateTime: '2026-09-14T09:00:00', endDateTime: '2026-09-18T17:30:00',
        availabilityType: 'Training' as const, isRecurring: true, recurrenceNotes: 'Every Tue', notes: 'Fire warden refresher.',
      }
      const values = { staffId: 'staff-1', availabilityType: 'Training' as const, startDate: '2026-09-14', endDate: '2026-09-18', notes: 'Fire warden refresher.' }

      it("sends the record's recurrence unchanged when only the notes change", async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn(async () => {})
        renderModal({ open: true, onClose: noop, onSubmit, submitting: false, mode: 'edit', initialValues: values, record })

        await user.clear(screen.getByLabelText(/notes/i))
        await user.type(screen.getByLabelText(/notes/i), 'New notes')
        await user.click(screen.getByRole('button', { name: /^save changes$/i }))

        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ isRecurring: true, recurrenceNotes: 'Every Tue', notes: 'New notes' }))
      })

      it('keeps the time of day of each end while its date is unchanged, and uses the whole day for a date that moved', async () => {
        const user = userEvent.setup()
        const onSubmit = vi.fn(async () => {})
        renderModal({ open: true, onClose: noop, onSubmit, submitting: false, mode: 'edit', initialValues: values, record })

        await user.click(screen.getByRole('button', { name: /^save changes$/i }))
        expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ startDateTime: '2026-09-14T09:00:00', endDateTime: '2026-09-18T17:30:00' }))

        await user.clear(screen.getByLabelText(/end date/i))
        await user.type(screen.getByLabelText(/end date/i), '2026-09-19')
        await user.click(screen.getByRole('button', { name: /^save changes$/i }))
        expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ startDateTime: '2026-09-14T09:00:00', endDateTime: '2026-09-19T23:59:59' }))
      })
    })

    it('submits initialValues.staffId even though no staff picker is rendered', async () => {
      const user = userEvent.setup()
      const onSubmit = vi.fn(async () => {})
      renderModal({
        open: true, onClose: noop, onSubmit, submitting: false, mode: 'edit',
        initialValues: { ...initialValues, staffId: 'staff-1' },
      })

      expect(screen.queryByRole('combobox', { name: /staff member/i })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: /^save changes$/i }))

      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ staffId: 'staff-1' }))
    })
  })
})

describe('AvailabilityRecordFormModal footer buttons', () => {
  it('draws Cancel and Save as Buttons at --control-h, not hand-rolled rounded-lg buttons', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ open: true, onClose, onSubmit: vi.fn(), submitting: false, staffOptions })

    for (const name of ['Cancel', 'Save']) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveClass('h-[var(--control-h)]', 'rounded-[var(--radius-sm)]')
      expect(button.className).not.toMatch(/rounded-lg|py-2/)
    }

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
