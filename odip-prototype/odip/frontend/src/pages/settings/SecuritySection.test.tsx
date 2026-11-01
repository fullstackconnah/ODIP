import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import SecuritySection from './SecuritySection'

const { settingsData, mutate } = vi.hoisted(() => ({ settingsData: { qualificationWarningDays: 30, sessionLengthMinutes: null as number | null }, mutate: vi.fn() }))
vi.mock('@/api/hooks', () => ({
  useSettings: () => ({ data: settingsData, isError: false, refetch: vi.fn() }),
  useUpdateSecuritySettings: () => ({ mutate, isPending: false }),
}))

const FIELD = /Session length/
const SHORTER = 'People signed in for longer than this will be asked to sign in again within 30 minutes.'

function renderSection(readOnly = false) {
  const element = <SecuritySection title="Security" description="How long people stay signed in before they must sign in again." readOnly={readOnly} focusOnMount={false} />
  render(<RouterProvider router={createMemoryRouter([{ path: '/settings', element }], { initialEntries: ['/settings?section=security'] })} />)
}

async function pick(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: FIELD }))
  await user.click(await screen.findByRole('option', { name: label }))
}

beforeEach(() => { mutate.mockReset(); settingsData.sessionLengthMinutes = null })

describe('Security', () => {
  it('lists the seven lengths in order, with No limit selected for an organisation that never chose', async () => {
    const user = userEvent.setup()
    renderSection()
    expect(screen.getByRole('button', { name: FIELD })).toHaveTextContent('No limit')

    await user.click(screen.getByRole('button', { name: FIELD }))

    expect((await screen.findAllByRole('option')).map(o => o.textContent)).toEqual(['15 minutes', '30 minutes', '1 hour', '2 hours', '4 hours', '8 hours', 'No limit'])
  })

  it('saves a chosen length from the foot as minutes, then says Saved', async () => {
    const user = userEvent.setup()
    mutate.mockImplementation((_body, opts) => opts.onSuccess())
    renderSection()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    await pick(user, '2 hours')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mutate.mock.calls[0][0]).toEqual({ sessionLengthMinutes: 120 })
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })

  it('saves No limit as null', async () => {
    const user = userEvent.setup()
    settingsData.sessionLengthMinutes = 60
    renderSection()
    expect(screen.getByRole('button', { name: FIELD })).toHaveTextContent('1 hour')

    await pick(user, 'No limit')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mutate.mock.calls[0][0]).toEqual({ sessionLengthMinutes: null })
  })

  it('says the shorter-limit line only when the new limit is shorter than the saved one', async () => {
    const user = userEvent.setup()
    settingsData.sessionLengthMinutes = 120
    renderSection()
    expect(screen.queryByText(SHORTER)).not.toBeInTheDocument()

    await pick(user, '4 hours')
    expect(screen.queryByText(SHORTER)).not.toBeInTheDocument()

    await pick(user, '1 hour')
    expect(screen.getByText(SHORTER)).toBeInTheDocument()
  })

  it('says the shorter-limit line going from No limit to a limit, and not back to No limit', async () => {
    const user = userEvent.setup()
    renderSection()

    await pick(user, '8 hours')
    expect(screen.getByText(SHORTER)).toBeInTheDocument()

    await pick(user, 'No limit')
    expect(screen.queryByText(SHORTER)).not.toBeInTheDocument()
  })

  it('shows a stored length that is not in the list as its own item', async () => {
    const user = userEvent.setup()
    settingsData.sessionLengthMinutes = 45
    renderSection()
    expect(screen.getByRole('button', { name: FIELD })).toHaveTextContent('45 minutes')

    await user.click(screen.getByRole('button', { name: FIELD }))

    expect((await screen.findAllByRole('option')).map(o => o.textContent)).toContain('45 minutes')
  })

  it('says why a refused save was refused and keeps the length that was picked', async () => {
    const user = userEvent.setup()
    mutate.mockImplementation((_body, opts) => opts.onError({ response: { status: 403, data: {} } }))
    renderSection()

    await pick(user, '15 minutes')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Not saved. Only an Admin can change these.')
    expect(screen.getByRole('button', { name: FIELD })).toHaveTextContent('15 minutes')
  })

  it('is locked for a Coordinator: the length reads, the control is disabled, and there is no Save', () => {
    settingsData.sessionLengthMinutes = 480
    renderSection(true)
    expect(screen.getByText(/only an admin can change these/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: FIELD })).toBeDisabled()
    expect(screen.getByRole('button', { name: FIELD })).toHaveTextContent('8 hours')
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
  })

  // Plan-check S1: the session ending is not promised to end in a password prompt (a Microsoft or already-signed-in person gets no such prompt).
  it("never mentions a password: the section's text promises no password prompt", () => {
    renderSection()
    expect(document.body.textContent).not.toMatch(/password/i)
    expect(screen.getByText('Counted from when someone signs in. When it ends, they sign in again. Microsoft sign-ins end after 12 hours at most.')).toBeInTheDocument()
  })
})
