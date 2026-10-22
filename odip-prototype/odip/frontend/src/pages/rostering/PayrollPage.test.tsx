import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import PayrollPage from './PayrollPage'
import type { PayrollCheckDto, PayrollShiftDto, PayrollWorkerDto } from '@/api/types'

const { state, calls } = vi.hoisted(() => ({
  state: { periods: undefined as unknown, check: undefined as unknown, admin: true, checkError: false },
  calls: { send: vi.fn(), checkRange: vi.fn() },
}))

vi.mock('@/api/hooks', () => ({
  usePayPeriods: () => ({ data: state.periods, isLoading: false, isError: !state.periods, refetch: vi.fn() }),
  usePayrollCheck: (range: unknown) => {
    calls.checkRange(range)
    return { data: state.check, isLoading: false, isError: state.checkError, refetch: vi.fn(), dataUpdatedAt: 0 }
  },
  useSendMissingTimesheets: () => ({ mutate: calls.send, isPending: false, isError: false, error: null, reset: vi.fn() }),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => ({ isAdmin: state.admin, isSuperAdmin: false }) }))

const period = (o = {}) => ({ payScheduleId: 1, scheduleName: 'Fortnightly', from: '2026-10-06', to: '2026-10-19', finalised: false, ...o })
const shift = (o: Partial<PayrollShiftDto> = {}): PayrollShiftDto => ({
  shiftId: 's1', serviceDate: '2026-10-14', participantName: 'Alex Example', rosteredStart: '09:00', rosteredEnd: '17:00', endsNextDay: false,
  rosteredMinutes: 480, actualStart: '2026-10-14T09:00:00Z', actualEnd: '2026-10-14T17:00:00Z', timeZoneId: 'Australia/Sydney',
  breakMinutes: 30, paidMinutes: 450, nightType: 'None', status: 'Sent', reason: '', sentAt: '2026-10-15T01:00:00Z', sendable: false, ...o,
})
const worker = (o: Partial<PayrollWorkerDto> = {}): PayrollWorkerDto => ({
  userId: 'u1', name: 'Sam Support', linked: true, rosteredMinutes: 480, paidMinutes: 450, shifts: [shift()], ...o,
})
const check = (o: Partial<PayrollCheckDto> = {}): PayrollCheckDto => ({
  from: '2026-10-06', to: '2026-10-19', approved: 1, sent: 1, waiting: 0, failed: 0, changed: 0, notLinked: 0, sendable: 0, awaitingApproval: 0,
  workers: [worker()], ...o,
})
const setup = (c: PayrollCheckDto, periods: unknown = { connected: true, today: '2026-10-14', periods: [period()] }) => {
  state.periods = periods
  state.check = c
  render(<MemoryRouter><PayrollPage /></MemoryRouter>)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  state.admin = true
  state.checkError = false
})

describe('PayrollPage', () => {
  it('checks the pay period that contains today', () => {
    setup(check())
    expect(calls.checkRange).toHaveBeenCalledWith({ from: '2026-10-06', to: '2026-10-19' })
    expect(screen.getByRole('combobox', { name: 'Pay period' })).toHaveDisplayValue(/Open/)
  })

  it('says everything is in Employment Hero when all are sent, and keeps those rows closed', () => {
    setup(check())
    expect(screen.getByText('All 1 approved shifts are in Employment Hero.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show shifts: Sam Support' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens rows with anything not sent, and shows the reason', () => {
    setup(check({
      approved: 2, sent: 1, failed: 1, sendable: 1,
      workers: [worker({ shifts: [shift(), shift({ shiftId: 's2', status: 'Failed', reason: 'Employment Hero refused it.', sendable: true })] })],
    }))
    expect(screen.getByRole('button', { name: 'Hide shifts: Sam Support' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Employment Hero refused it.')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 not sent')).toBeInTheDocument()
  })

  it('sends missing for exactly the shown dates', async () => {
    const user = userEvent.setup()
    setup(check({ approved: 1, sent: 0, waiting: 1, sendable: 1, workers: [worker({ shifts: [shift({ status: 'Waiting', sendable: true })] })] }))
    await user.click(screen.getByRole('button', { name: 'Send missing (1)' }))
    expect(calls.send).toHaveBeenCalledWith({ from: '2026-10-06', to: '2026-10-19' }, expect.anything())
  })

  it('disables Send missing at zero', () => {
    setup(check())
    expect(screen.getByRole('button', { name: 'Send missing (0)' })).toBeDisabled()
    expect(screen.getByText('Nothing to send.')).toBeInTheDocument()
  })

  it('gives a Coordinator no button, only the reason', () => {
    state.admin = false
    setup(check())
    expect(screen.queryByRole('button', { name: /Send missing/ })).toBeNull()
    expect(screen.getByText('An Admin can send missing hours.')).toBeInTheDocument()
  })

  it('points to Completions when shifts are not approved yet', () => {
    setup(check({ awaitingApproval: 2 }))
    expect(screen.getByText(/2 shifts in this period aren't approved yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Completions' })).toHaveAttribute('href', '/rostering/completions')
  })

  it('marks an unlinked worker', () => {
    setup(check({ workers: [worker({ linked: false, shifts: [shift({ status: 'NotLinked', reason: 'Not linked to Employment Hero.' })] })] }))
    expect(screen.getAllByText('Not linked').length).toBeGreaterThan(0)
  })

  it('offers Open Integrations to an Admin when Employment Hero is not connected', () => {
    setup(check(), { connected: false, today: '2026-10-14', periods: [] })
    expect(screen.getByRole('link', { name: 'Open Integrations' })).toHaveAttribute('href', '/settings?section=integrations')
  })
})
