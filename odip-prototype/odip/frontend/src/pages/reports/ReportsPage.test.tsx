import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { restoreZone, setZone } from '@/test/timeZone'
import type { HoursByWorkerRowDto, LeaveTakenRowDto, ShiftFulfilmentWeekDto } from '@/api/types/reports'

type Q = { data?: unknown[]; isError?: boolean; isPlaceholderData?: boolean; isFetching?: boolean; refetch: () => void }
const h = vi.hoisted(() => ({
  hours: {} as Q, fulfilment: {} as Q, leave: {} as Q,
  hoursHook: vi.fn(), fulfilmentHook: vi.fn(), leaveHook: vi.fn(),
  perms: { hasOrganisation: true },
  saveBlob: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useHoursByWorkerReport: (...a: unknown[]) => (h.hoursHook(...a), h.hours),
  useShiftFulfilmentReport: (...a: unknown[]) => (h.fulfilmentHook(...a), h.fulfilment),
  useLeaveTakenReport: (...a: unknown[]) => (h.leaveHook(...a), h.leave),
}))
vi.mock('@/lib/permissions', () => ({ usePermissions: () => h.perms }))
vi.mock('@/lib/downloadFile', () => ({ saveBlob: h.saveBlob }))

import ReportsPage from './ReportsPage'

const worker = (workerName: string, approvedShifts: number, approvedHours: number, awaitingApprovalHours = 0): HoursByWorkerRowDto =>
  ({ workerId: workerName, workerName, approvedShifts, approvedHours, awaitingApprovalHours })
const week = (weekStart: string, o: Partial<ShiftFulfilmentWeekDto> = {}): ShiftFulfilmentWeekDto =>
  ({ weekStart, shifts: 4, filled: 3, unstaffed: 1, cancelled: 0, fillRatePercent: 75, partWeek: false, ...o })
const leave = (leaveId: string, workerName: string, from: string, to: string, daysInRange: number): LeaveTakenRowDto =>
  ({ leaveId, workerId: workerName, workerName, type: 'Annual', from, to, daysInRange })

const ok = (data: unknown[]): Q => ({ data, refetch: vi.fn() })

function setData() {
  h.hours = ok([worker('Ava Nguyen', 5, 7, 1.5), worker('=cmd', 2, 9.25)])
  h.fulfilment = ok([week('2026-09-28'), week('2026-10-05', { shifts: 0, filled: 0, unstaffed: 0, fillRatePercent: null, partWeek: true })])
  h.leave = ok([leave('l1', 'Sam Lee', '2026-10-05', '2026-10-06', 2)])
}

const RANGE = '/reports?from=2026-09-28&to=2026-10-25'
const renderAt = (url = RANGE) => render(<MemoryRouter initialEntries={[url]}><ReportsPage /></MemoryRouter>)
const section = (name: string) => screen.getByRole('region', { name })
const download = (name: string) => within(section(name)).getByRole('button', { name: /Download CSV/ })
const lastCsv = async () => {
  const [blob, filename] = h.saveBlob.mock.calls.at(-1)!
  return { filename: filename as string, text: await new Promise<string>(resolve => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.readAsText(blob as Blob) }) }
}

beforeEach(() => { setData(); h.perms = { hasOrganisation: true } })
afterEach(() => { vi.clearAllMocks(); restoreZone() })

describe('ReportsPage', () => {
  it('shows the rows of each report', () => {
    renderAt()
    const hours = section('Hours by worker')
    expect(within(hours).getByText('7.00')).toBeInTheDocument()
    expect(within(hours).getByText('1.50')).toBeInTheDocument()
    const fulfilment = section('Shift fulfilment by week')
    expect(within(fulfilment).getByText('75%')).toBeInTheDocument()
    expect(within(fulfilment).getByText('No shifts to fill')).toBeInTheDocument()
    expect(within(fulfilment).getByText(/\(part week\)/)).toBeInTheDocument()
    expect(within(section('Leave taken')).getByText('Sam Lee')).toBeInTheDocument()
  })

  it('shows a loading strip on first load and a Try again on a first-load failure', () => {
    h.hours = { refetch: vi.fn() }
    h.fulfilment = { isError: true, refetch: vi.fn() }
    renderAt()
    expect(within(section('Hours by worker')).getByText('Loading hours…')).toBeInTheDocument()
    fireEvent.click(within(section('Shift fulfilment by week')).getByRole('button', { name: 'Try again' }))
    expect(h.fulfilment.refetch).toHaveBeenCalled()
    expect(within(section('Leave taken')).getByText('Sam Lee')).toBeInTheDocument()
  })

  it('says each report is empty without a Download button', () => {
    h.hours = ok([]); h.fulfilment = ok([]); h.leave = ok([])
    renderAt()
    expect(screen.getByText('No completed shifts in this range. Try a wider date range.')).toBeInTheDocument()
    expect(screen.getByText('No shifts in this range. Try a wider date range.')).toBeInTheDocument()
    expect(screen.getByText('No approved leave in this range. Try a wider date range.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Download CSV/ })).not.toBeInTheDocument()
  })

  it.each([
    ['Australia/Sydney', '2026-09-28', '2026-10-25'],
    ['UTC', '2026-09-21', '2026-10-18'],
  ])('asks for the default range of the viewer calendar in %s', (zone, from, to) => {
    if (!setZone(zone)) return
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-25T13:30:00Z'))
    try { renderAt('/reports') } finally { vi.useRealTimers() }
    expect(h.hoursHook).toHaveBeenCalledWith({ from, to }, true)
  })

  it('refuses a range over 366 days: the reason shows and no report is asked for', () => {
    renderAt('/reports?from=2024-01-01&to=2025-01-01')
    expect(screen.getByText('Pick a range of 366 days or less. This one is 367 days.')).toBeInTheDocument()
    expect(h.hoursHook).toHaveBeenLastCalledWith({ from: '2024-01-01', to: '2025-01-01' }, false)
    expect(h.leaveHook).toHaveBeenLastCalledWith({ from: '2024-01-01', to: '2025-01-01' }, false)
    expect(screen.queryByRole('button', { name: /Download CSV/ })).not.toBeInTheDocument()
  })

  it('downloads a formula-safe CSV named for the report and range', async () => {
    renderAt()
    fireEvent.click(download('Hours by worker'))
    const { filename, text } = await lastCsv()
    expect(filename).toBe('hours-by-worker-2026-09-28-to-2026-10-25.csv')
    expect(text).toContain('Worker,Approved shifts,Approved hours,Awaiting approval')
    expect(text).toContain("'=cmd,2,9.25,0.00")
  })

  it('writes the fulfilment CSV with an empty fill rate and a part_week flag', async () => {
    renderAt()
    fireEvent.click(download('Shift fulfilment by week'))
    const { filename, text } = await lastCsv()
    expect(filename).toBe('shift-fulfilment-by-week-2026-09-28-to-2026-10-25.csv')
    expect(text).toContain('2026-10-05,0,0,0,0,,true')
  })

  it('writes CSV rows in the order the table is sorted', async () => {
    renderAt()
    const sortButton = () => within(section('Hours by worker')).getByRole('columnheader', { name: /Approved hours/ })
    fireEvent.click(sortButton())
    fireEvent.click(sortButton())
    fireEvent.click(download('Hours by worker'))
    const { text } = await lastCsv()
    expect(text.indexOf("'=cmd")).toBeLessThan(text.indexOf('Ava Nguyen'))
  })

  it('keeps old rows but disables Download while a new range loads', () => {
    h.hours = { ...ok([worker('Ava Nguyen', 5, 7)]), isPlaceholderData: true }
    renderAt()
    const button = download('Hours by worker')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(button)
    expect(h.saveBlob).not.toHaveBeenCalled()
    expect(screen.getByText('Ava Nguyen')).toBeInTheDocument()
  })

  it('asks which organisation to view as, and asks for no report', () => {
    h.perms = { hasOrganisation: false }
    renderAt()
    expect(screen.getByText(/Choose an organisation/)).toBeInTheDocument()
    expect(h.hoursHook).toHaveBeenLastCalledWith({ from: '2026-09-28', to: '2026-10-25' }, false)
    expect(screen.queryByRole('region', { name: 'Hours by worker' })).not.toBeInTheDocument()
  })
})
