import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { LeaveRequestFormModal, type LeaveRequestFormModalProps } from './LeaveRequestFormModal'

function noop() {}

// useUnsavedChangesWarning (wired into the modal in Step 4) calls react-router 7's useBlocker,
// which throws under a plain declarative <MemoryRouter>/<Routes> — a data router is required.
// Mirrors VehicleCreatePage.test.tsx:3,13-20, the existing precedent for testing a page/component
// that uses this hook.
function renderModal(props: LeaveRequestFormModalProps) {
  const router = createMemoryRouter(
    [{ path: '/', element: <LeaveRequestFormModal {...props} /> }],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

describe('LeaveRequestFormModal', () => {
  it('submits leaveType/startDate/endDate/reason with no userId in self-service mode', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    renderModal({ open: true, onClose: noop, onSubmit, submitting: false })

    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /submit request/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      leaveType: 'Annual',
      startDate: '2026-09-14',
      endDate: '2026-09-18',
      reason: null,
    })
  })

  it('does not render a staff picker in self-service mode', () => {
    renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: false })
    expect(screen.queryByRole('combobox', { name: /staff member/i })).not.toBeInTheDocument()
  })

  it('renders a required staff picker in "enter on behalf" mode and includes userId in the submitted payload', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => {})
    const staffOptions = [{ value: 'staff-1', label: 'Alex Rivera' }]
    renderModal({ open: true, onClose: noop, onSubmit, submitting: false, staffOptions })

    await user.click(screen.getByRole('combobox', { name: /staff member/i }))
    await user.click(screen.getByRole('option', { name: 'Alex Rivera' }))
    await user.type(screen.getByLabelText(/start date/i), '2026-09-14')
    await user.type(screen.getByLabelText(/end date/i), '2026-09-18')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      leaveType: 'Annual',
      startDate: '2026-09-14',
      endDate: '2026-09-18',
      reason: null,
      userId: 'staff-1',
    })
  })

  it('disables the submit button while submitting', () => {
    renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: true })
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })

  it('does not render at all when closed', () => {
    renderModal({ open: false, onClose: noop, onSubmit: vi.fn(), submitting: false })
    expect(screen.queryByText('Request leave')).not.toBeInTheDocument()
  })

  it('surfaces an errorMessage prop', () => {
    renderModal({ open: true, onClose: noop, onSubmit: vi.fn(), submitting: false, errorMessage: 'An identical request already exists.' })
    expect(screen.getByRole('alert')).toHaveTextContent('An identical request already exists.')
  })
})
