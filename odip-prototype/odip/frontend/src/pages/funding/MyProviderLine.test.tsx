import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MyProviderLine } from './MyProviderLine'
import { plan } from '@/test/fixtures/funding'

// The "my provider" line on the Funding tab's current plan: whether we are recorded as the participant's my provider for this plan, and the modal that changes it.

const { mutate, providerToday, state } = vi.hoisted(() => ({ mutate: vi.fn(), providerToday: { data: undefined as unknown }, state: { isPending: false, error: null as unknown } }))
vi.mock('@/api/hooks', () => ({ useProviderTodayQuery: () => providerToday, useSetMyProvider: () => ({ mutate, isPending: state.isPending, error: state.error }) }))

beforeEach(() => {
  vi.clearAllMocks()
  state.isPending = false
  state.error = null
  providerToday.data = undefined
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-03T03:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const user = () => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
const show = (overrides = {}, planType: 'AgencyManaged' | 'PlanManaged' | 'SelfManaged' = 'AgencyManaged') =>
  render(<MyProviderLine participantId="participant-1" plan={plan(overrides)} planType={planType} />)

describe('My provider line', () => {
  it('says "Not recorded" with no date for a plan that has no record', () => {
    show()
    expect(screen.getByText('My provider')).toBeInTheDocument()
    expect(screen.getByText('Not recorded')).toBeInTheDocument()
    expect(screen.queryByText(/^(on|from) /)).not.toBeInTheDocument()
  })

  it('says "Requested" with the date it was requested on', () => {
    show({ myProvider: 'Requested', myProviderOn: '2026-11-03' })
    expect(screen.getByText('Requested')).toBeInTheDocument()
    expect(screen.getByText('on 3 Nov 2026')).toBeInTheDocument()
  })

  it('says "Recorded" with the date it runs from', () => {
    show({ myProvider: 'Recorded', myProviderOn: '2026-11-03' })
    expect(screen.getByText('Recorded')).toBeInTheDocument()
    expect(screen.getByText('from 3 Nov 2026')).toBeInTheDocument()
  })

  it('is there for a plan-managed participant', () => {
    show({}, 'PlanManaged')
    expect(screen.getByRole('button', { name: 'Update' })).toBeInTheDocument()
  })

  it('draws nothing for a self-managed participant', () => {
    const { container } = show({}, 'SelfManaged')
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the modal on the current choice, hides the date for "Not recorded", and shows the labelled date for the others', async () => {
    show({ myProvider: 'Recorded', myProviderOn: '2026-10-28' })
    await user().click(screen.getByRole('button', { name: 'Update' }))

    expect(screen.getByRole('dialog', { name: 'My provider' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Recorded' })).toBeChecked()
    expect(screen.getByLabelText('Recorded from')).toHaveValue('2026-10-28')

    await user().click(screen.getByRole('radio', { name: 'Requested' }))
    expect(screen.getByLabelText('Requested on')).toHaveAttribute('max', '2026-11-03')

    await user().click(screen.getByRole('radio', { name: 'Not recorded' }))
    expect(screen.queryByLabelText(/Requested on|Recorded from/)).not.toBeInTheDocument()
  })

  it('keeps Save off until something changes, then saves the choice and the date, and closes', async () => {
    mutate.mockImplementation((_body: unknown, opts: { onSuccess: () => void }) => opts.onSuccess())
    show()
    await user().click(screen.getByRole('button', { name: 'Update' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user().click(screen.getByRole('radio', { name: 'Recorded' }))
    await user().type(screen.getByLabelText('Recorded from'), '2026-10-28')
    await user().click(screen.getByRole('button', { name: 'Save' }))

    expect(mutate).toHaveBeenCalledWith({ planId: 'plan-1', body: { myProvider: 'Recorded', myProviderOn: '2026-10-28' } }, expect.anything())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('saves "Not recorded" with no date', async () => {
    mutate.mockImplementation((_body: unknown, opts: { onSuccess: () => void }) => opts.onSuccess())
    show({ myProvider: 'Requested', myProviderOn: '2026-11-01' })
    await user().click(screen.getByRole('button', { name: 'Update' }))
    await user().click(screen.getByRole('radio', { name: 'Not recorded' }))
    await user().click(screen.getByRole('button', { name: 'Save' }))

    expect(mutate).toHaveBeenCalledWith({ planId: 'plan-1', body: { myProvider: 'Unknown', myProviderOn: null } }, expect.anything())
  })

  it('says "Enter the date." under the date, with focus on it, and does not save without one', async () => {
    show()
    await user().click(screen.getByRole('button', { name: 'Update' }))
    await user().click(screen.getByRole('radio', { name: 'Requested' }))
    await user().click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.getByText('Enter the date.')).toBeInTheDocument()
    expect(screen.getByLabelText('Requested on')).toHaveFocus()
    expect(mutate).not.toHaveBeenCalled()
  })

  // 14:30 UTC on 5 Nov is already 6 Nov in Sydney: a Requested date of 6 Nov is today for the organisation, not the future.
  it("accepts today on the organisation's calendar, which the browser's clock still calls tomorrow", async () => {
    vi.setSystemTime(new Date('2026-11-05T14:30:00Z'))
    providerToday.data = { date: '2026-11-06' }
    show({ myProvider: 'Requested', myProviderOn: '2026-11-01' })
    await user().click(screen.getByRole('button', { name: 'Update' }))
    const field = screen.getByLabelText('Requested on')
    await user().clear(field)
    await user().type(field, '2026-11-06')
    await user().click(screen.getByRole('button', { name: 'Save' }))

    expect(screen.queryByText('The date cannot be in the future.')).not.toBeInTheDocument()
    expect(mutate).toHaveBeenCalledWith({ planId: expect.anything(), body: { myProvider: 'Requested', myProviderOn: '2026-11-06' } }, expect.anything())
  })

  it('shows what the server refused with, in the dialog', async () => {
    state.error = { response: { data: { errors: ['The date cannot be in the future.'] } } }
    show({ myProvider: 'Requested', myProviderOn: '2026-11-01' })
    await user().click(screen.getByRole('button', { name: 'Update' }))

    expect(screen.getByText('The date cannot be in the future.')).toBeInTheDocument()
  })
})
