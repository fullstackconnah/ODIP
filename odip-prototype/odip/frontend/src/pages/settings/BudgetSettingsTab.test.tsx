import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BudgetSettingsTab from './BudgetSettingsTab'
import type { BudgetSettingsDto } from '@/api/types'

// Settings, Budgets (Admin and SuperAdmin; budget phase 1). The mode and the "approaching" percentage are STORED for the checks a later release brings, and the tab says so. It copies the stale-form
// protection of Provider Settings: only what the person deliberately changed is sent, and a choice made against a value that has since moved is dropped, never pushed over a newer one.

const { useBudgetSettings, mutate } = vi.hoisted(() => ({ useBudgetSettings: vi.fn(), mutate: vi.fn() }))

vi.mock('@/api/hooks', () => ({
  useBudgetSettings,
  useUpdateBudgetSettings: () => ({ mutate, isPending: false }),
}))

// The unsaved-changes prompt needs a data router (useBlocker); this suite is about the form, and the prompt has its own tests.
vi.mock('@/hooks/useUnsavedChangesWarning', () => ({ useUnsavedChangesWarning: () => ({ dialog: null }) }))

const saved = (changes: Partial<BudgetSettingsDto> = {}): BudgetSettingsDto => ({ mode: 'Warn', approachingPercent: 80, isDefault: false, ...changes })
const reply = (data: BudgetSettingsDto | undefined, extra: Record<string, unknown> = {}) => ({ data, isLoading: false, isError: false, refetch: vi.fn(), ...extra })

const renderTab = () => render(<BudgetSettingsTab />)

beforeEach(() => {
  vi.clearAllMocks()
  useBudgetSettings.mockReturnValue(reply(saved()))
})

describe('Budgets tab: what is shown', () => {
  it('shows the mode and the percentage as saved, and says what each mode does', () => {
    renderTab()

    expect(screen.getByRole('radio', { name: 'Warn only' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Hard limit for ad-hoc shifts' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: /Warn when used reaches/ })).toHaveTextContent('80%')
    expect(screen.getByText(/Refuses a one-off roster shift that would take a participant's forecast past their budget for the funding period, unless an Admin overrides it with a reason\. Emergency or safety bookings are always allowed and reviewed by an Admin afterwards\./)).toBeInTheDocument()
  })

  it('says that the checks arrive in a later release and this choice is saved for them', () => {
    renderTab()

    expect(screen.getByText('Budget checks arrive in a later release; this choice is saved for them.')).toBeInTheDocument()
  })

  it('says nothing has been saved yet while these are the defaults', () => {
    useBudgetSettings.mockReturnValue(reply(saved({ isDefault: true })))
    renderTab()

    expect(screen.getByText(/Nothing has been saved yet/)).toBeInTheDocument()
  })

  it('offers 50 to 95 percent in steps of five', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: /Warn when used reaches/ }))

    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['50%', '55%', '60%', '65%', '70%', '75%', '80%', '85%', '90%', '95%'])
  })

  it('tells a SuperAdmin who has not chosen an organisation to choose one, rather than showing a failure', () => {
    useBudgetSettings.mockReturnValue(reply(undefined, {
      isError: true, error: { response: { status: 400, data: { success: false, errors: ['Choose an organisation to view as before using budget settings: they belong to one organisation.'] } } },
    }))
    renderTab()

    expect(screen.getByText(/Choose an organisation to view as/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument()
  })

  it('offers to try again when the settings could not be loaded', async () => {
    const refetch = vi.fn()
    useBudgetSettings.mockReturnValue(reply(undefined, { isError: true, error: new Error('boom'), refetch }))
    renderTab()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))

    expect(refetch).toHaveBeenCalled()
  })
})

describe('Budgets tab: saving sends only what was changed', () => {
  it('has nothing to save until something is changed', () => {
    renderTab()

    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })

  it('sends the mode alone when only the mode was changed', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('radio', { name: 'Hard limit for ad-hoc shifts' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0][0]).toEqual({ mode: 'HardLimit' })
  })

  it('sends the percentage alone when only the percentage was changed', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('button', { name: /Warn when used reaches/ }))
    await user.click(screen.getByRole('option', { name: '65%' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(mutate.mock.calls[0][0]).toEqual({ approachingPercent: 65 })
  })

  it('sends both when both were changed, and nothing for a pick that was put back', async () => {
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('radio', { name: 'Hard limit for ad-hoc shifts' }))
    await user.click(screen.getByRole('button', { name: /Warn when used reaches/ }))
    await user.click(screen.getByRole('option', { name: '95%' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))
    expect(mutate.mock.calls[0][0]).toEqual({ mode: 'HardLimit', approachingPercent: 95 })

    mutate.mockClear()
    await user.click(screen.getByRole('radio', { name: 'Warn only' }))
    await user.click(screen.getByRole('button', { name: /Warn when used reaches/ }))
    await user.click(screen.getByRole('option', { name: '80%' }))
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('says it was saved, and puts the form back to what the server holds', async () => {
    mutate.mockImplementation((_changes, options) => options.onSuccess())
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('radio', { name: 'Hard limit for ad-hoc shifts' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(screen.getByText('Budget settings saved.')).toBeInTheDocument()
  })

  it('shows the server’s reason when it refuses, and keeps the pick', async () => {
    mutate.mockImplementation((_changes, options) => options.onError({ response: { status: 400, data: { success: false, errors: ['Warn when used reaches must be from 50 to 95 percent, in steps of 5.'] } } }))
    const user = userEvent.setup()
    renderTab()

    await user.click(screen.getByRole('radio', { name: 'Hard limit for ad-hoc shifts' }))
    await user.click(screen.getByRole('button', { name: 'Save settings' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Warn when used reaches must be from 50 to 95 percent, in steps of 5.')
    expect(screen.getByRole('radio', { name: 'Hard limit for ad-hoc shifts' })).toBeChecked()
  })
})

describe('Budgets tab: a pick made against a value that has since moved is dropped', () => {
  it('shows what the server now holds, and never pushes the old pick back over it, even when the server later returns to the value the pick was made against', async () => {
    const user = userEvent.setup()
    const { rerender } = renderTab()

    // The person picks Hard limit while the server holds Warn.
    await user.click(screen.getByRole('radio', { name: 'Hard limit for ad-hoc shifts' }))
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled()

    // Another admin changes the server to Hard limit with 90%: the pick (against Warn) is stale.
    useBudgetSettings.mockReturnValue(reply(saved({ mode: 'HardLimit', approachingPercent: 90 })))
    rerender(<BudgetSettingsTab />)
    expect(screen.getByRole('radio', { name: 'Hard limit for ad-hoc shifts' })).toBeChecked()
    expect(screen.getByRole('button', { name: /Warn when used reaches/ })).toHaveTextContent('90%')

    // And back to Warn: the old pick is not revived.
    useBudgetSettings.mockReturnValue(reply(saved({ mode: 'Warn', approachingPercent: 90 })))
    rerender(<BudgetSettingsTab />)
    expect(screen.getByRole('radio', { name: 'Warn only' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled()
  })
})
