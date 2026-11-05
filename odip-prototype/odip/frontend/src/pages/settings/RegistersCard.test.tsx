import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RegistersCard } from './RegistersCard'

const { download } = vi.hoisted(() => ({ download: vi.fn() }))
vi.mock('@/lib/downloadFile', () => ({ downloadFile: download }))

const never = () => new Promise<never>(() => {})
const optionNames = () => screen.getAllByRole('option').map(o => o.textContent)
const button = () => screen.getByRole('button', { name: /^(Download CSV|Downloading…)$/ })
const setDates = (_user: unknown, from: string, to: string) => {
  fireEvent.change(screen.getByLabelText('From'), { target: { value: from } })
  fireEvent.change(screen.getByLabelText('To'), { target: { value: to } })
}

beforeEach(() => {
  // Noon in Sydney on 2026-11-05, so "today" and "a year ago" are the same in every test zone.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-05T02:00:00Z') })
  download.mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.useRealTimers(); download.mockReset() })

describe('RegistersCard', () => {
  it('opens on Incidents for the last year, and offers Complaints only when allowed', () => {
    render(<RegistersCard canComplaints />)
    expect(screen.getByRole('heading', { level: 3, name: 'Registers for auditors' })).toBeInTheDocument()
    expect(optionNames()).toEqual(['Incidents', 'Complaints', 'Restrictive practices', 'Risks', 'Staff credentials'])
    expect(screen.getByLabelText('From')).toHaveValue('2025-11-05')
    expect(screen.getByLabelText('To')).toHaveValue('2026-11-05')
    cleanup()
    render(<RegistersCard canComplaints={false} />)
    expect(optionNames()).toEqual(['Incidents', 'Restrictive practices', 'Risks', 'Staff credentials'])
  })

  it('downloads the chosen register for the chosen range', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<RegistersCard canComplaints />)
    await user.selectOptions(screen.getByLabelText('Register'), 'restrictive-practices')
    setDates(user, '2026-07-01', '2026-07-31')
    await user.click(button())
    expect(download).toHaveBeenCalledWith(
      '/registers/restrictive-practices?from=2026-07-01&to=2026-07-31',
      'bunya-support-restrictive-practices-2026-07-01-to-2026-07-31.csv',
    )
  })

  it('hides the dates for Risks and Staff credentials, says why, and asks for no range', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<RegistersCard canComplaints />)
    await user.selectOptions(screen.getByLabelText('Register'), 'staff-credentials')
    expect(screen.queryByLabelText('From')).toBeNull()
    expect(screen.queryByLabelText('To')).toBeNull()
    expect(screen.getByText('Shows the register as it stands today, so there are no dates to choose.')).toBeInTheDocument()
    await user.click(button())
    expect(download).toHaveBeenCalledWith('/registers/staff-credentials', 'bunya-support-staff-credentials-2026-11-05.csv')
  })

  it('refuses an end date before the start without asking the server', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<RegistersCard canComplaints />)
    setDates(user, '2026-08-10', '2026-08-01')
    await user.click(button())
    expect(screen.getByText('The end date must be on or after the start date.')).toBeInTheDocument()
    expect(download).not.toHaveBeenCalled()
  })

  it("shows the server's own sentence when it refuses", async () => {
    download.mockRejectedValue(new Error('Choose an organisation to view as before exporting data.'))
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<RegistersCard canComplaints />)
    await user.click(button())
    expect(await screen.findByText('Choose an organisation to view as before exporting data.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('keeps focus on the busy button and ignores a second click', async () => {
    download.mockReturnValue(never())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<RegistersCard canComplaints />)
    await user.click(button())
    const busy = await screen.findByRole('button', { name: 'Downloading…' })
    expect(busy).toHaveFocus()
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).not.toBeDisabled()
    await user.click(busy)
    expect(download).toHaveBeenCalledTimes(1)
  })
})
