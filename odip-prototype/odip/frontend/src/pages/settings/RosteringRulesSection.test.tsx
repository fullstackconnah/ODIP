import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import RosteringRulesSection from './RosteringRulesSection'

const { settingsData, mutate } = vi.hoisted(() => ({ settingsData: { qualificationWarningDays: 30, weeklyHoursWarning: 38, varianceReviewMinutes: 15, planExpiryWarningDays: 30 }, mutate: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useSettings: () => ({ data: settingsData, isError: false, refetch: vi.fn() }),
  useUpdateSettings: () => ({ mutate, isPending: false }),
}))

function renderSection(readOnly = false) {
  const element = <RosteringRulesSection title="Rostering rules" description="How the roster warns." readOnly={readOnly} focusOnMount={false} />
  render(<RouterProvider router={createMemoryRouter([{ path: '/settings', element }], { initialEntries: ['/settings?section=rostering'] })} />)
}

beforeEach(() => { mutate.mockReset() })

describe('Rostering rules', () => {
  it('shows both figures with their guidance', () => {
    renderSection()
    expect(screen.getByLabelText('Weekly hours')).toHaveValue(38)
    expect(screen.getByLabelText('Shift review minutes')).toHaveValue(15)
    expect(screen.getByText(/38 unless you change it/)).toBeInTheDocument()
    expect(screen.getByText(/15 unless you change it/)).toBeInTheDocument()
  })

  it('saves exactly the two fields it owns, then says Saved', async () => {
    const user = userEvent.setup()
    mutate.mockImplementation((_body, opts) => opts.onSuccess())
    renderSection()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    const minutes = screen.getByLabelText('Shift review minutes')
    await user.clear(minutes)
    await user.type(minutes, '20')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mutate.mock.calls[0][0]).toEqual({ weeklyHoursWarning: 38, varianceReviewMinutes: 20 })
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it('keeps the figures and says why when the server refuses', async () => {
    const user = userEvent.setup()
    mutate.mockImplementation((_body, opts) => opts.onError({ response: { status: 403, data: {} } }))
    renderSection()
    const hours = screen.getByLabelText('Weekly hours')
    await user.clear(hours)
    await user.type(hours, '25')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Not saved. Only an Admin can change these.')
    expect(screen.getByLabelText('Weekly hours')).toHaveValue(25)
  })

  it('refuses hours outside 1 to 100, keeping the guidance, and cannot save', async () => {
    const user = userEvent.setup()
    renderSection()
    const hours = screen.getByLabelText('Weekly hours')
    await user.clear(hours)
    await user.type(hours, '101')
    expect(screen.getByText('Enter a whole number from 1 to 100.')).toBeInTheDocument()
    expect(screen.getByText(/38 unless you change it/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  it.each(['0', '241', '1.5', ''])('refuses shift review minutes of %j', async text => {
    const user = userEvent.setup()
    renderSection()
    const minutes = screen.getByLabelText('Shift review minutes')
    await user.clear(minutes)
    if (text) await user.type(minutes, text)
    expect(screen.getByText('Enter a whole number from 1 to 240.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })

  // F1: the unsaved-changes guard must see an invalid edit as unsaved (plain dirty, not dirty && valid).
  it('counts an invalid edit as dirty, so the foot asks for a fix rather than going quiet', async () => {
    const user = userEvent.setup()
    renderSection()
    const hours = screen.getByLabelText('Weekly hours')
    await user.clear(hours)
    await user.type(hours, '999')
    expect(screen.getByRole('status')).toHaveTextContent('Fix 1 field to save.')
  })

  it('is locked for a Coordinator: read-only fields and no Save', () => {
    renderSection(true)
    expect(screen.getByText(/only an admin can change these/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Weekly hours')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Shift review minutes')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })
})
