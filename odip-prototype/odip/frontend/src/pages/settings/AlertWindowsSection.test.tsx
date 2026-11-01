import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import AlertWindowsSection from './AlertWindowsSection'

const { settingsData, mutate } = vi.hoisted(() => ({ settingsData: { qualificationWarningDays: 30, weeklyHoursWarning: 38, varianceReviewMinutes: 15, planExpiryWarningDays: 30 }, mutate: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useSettings: () => ({ data: settingsData, isError: false, refetch: vi.fn() }),
  useUpdateSettings: () => ({ mutate, isPending: false }),
}))

function renderSection(readOnly = false) {
  const element = <AlertWindowsSection title='Alert windows' description='How early we warn.' readOnly={readOnly} focusOnMount={false} />
  render(<RouterProvider router={createMemoryRouter([{ path: '/settings', element }], { initialEntries: ['/settings?section=alerts'] })} />)
}

async function pick(user: ReturnType<typeof userEvent.setup>, days: number) {
  // FormField names the dropdown by its label; its text is the value.
  await user.click(screen.getByRole('button', { name: /Staff qualifications/ }))
  await user.click(await screen.findByRole('option', { name: `${days} days` }))
}

beforeEach(() => { mutate.mockReset() })

describe('Alert windows', () => {
  it('saves the qualification window from the foot, then says Saved', async () => {
    const user = userEvent.setup()
    mutate.mockImplementation((_body, opts) => opts.onSuccess())
    renderSection()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    await pick(user, 60)
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mutate.mock.calls[0][0]).toEqual({ qualificationWarningDays: 60, planExpiryWarningDays: 30 })
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('says why a refused save was refused, and keeps the window that was picked', async () => {
    const user = userEvent.setup()
    mutate.mockImplementation((_body, opts) => opts.onError({ response: { status: 403, data: {} } }))
    renderSection()

    await pick(user, 14)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Not saved. Only an Admin can change these.')
    expect(screen.getByRole('button', { name: /Staff qualifications/ })).toHaveTextContent('14 days')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  })

  it('is locked for a Coordinator: the window reads, the control is disabled, and there is no Save', () => {
    renderSection(true)
    expect(screen.getByText(/only an admin can change these/i)).toBeInTheDocument()
    const control = screen.getByRole('button', { name: /Staff qualifications/ })
    expect(control).toBeDisabled()
    expect(control).toHaveTextContent('30 days')
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  // F2: Participant plans sits beside Staff qualifications; each save sends exactly the two windows.
  it('saves a changed participant-plan window with the qualification window', async () => {
    const user = userEvent.setup()
    mutate.mockImplementation((_body, opts) => opts.onSuccess())
    renderSection()
    const plans = screen.getByRole('button', { name: /Participant plans/ })
    expect(plans).toHaveTextContent('30 days')
    expect(screen.getByText(/Warn this many days before a participant.s plan ends. Shown on Participants and the dashboard./)).toBeInTheDocument()

    await user.click(plans)
    await user.click(await screen.findByRole('option', { name: '90 days' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mutate.mock.calls[0][0]).toEqual({ qualificationWarningDays: 30, planExpiryWarningDays: 90 })
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('no longer holds Weekly hours (it moved to Rostering rules)', () => {
    renderSection()
    expect(screen.queryByLabelText('Weekly hours')).not.toBeInTheDocument()
  })

  it('locks the plan window for a Coordinator', () => {
    renderSection(true)
    const control = screen.getByRole('button', { name: /Participant plans/ })
    expect(control).toBeDisabled()
    expect(control).toHaveTextContent('30 days')
  })
})
