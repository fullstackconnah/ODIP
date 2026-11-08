import { describe, expect, it, vi, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { facts, headers, renderGroup, rowOf, subjects } from './groupHarness'
import { useGroupStaffGroup } from './useGroupStaffGroup'

vi.mock('@/lib/firebase', () => ({ auth: null, devAuthEnabled: true }))
const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('@/api/client', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/api/client')>()), apiGet, apiPost }))

const row = (rowId: string, o: Record<string, unknown> = {}) => ({
  rowId, groupActivityId: 'a-1', activityTitle: 'Bowling', serviceDate: '2026-10-21', userId: `u-${rowId}`, staffName: `Staff ${rowId}`, role: null,
  startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false, actualStart: '2026-10-20T22:02:00Z', actualEnd: '2026-10-21T04:01:00Z',
  breakStartedAt: null, breakEndedAt: null, timeZoneId: 'Australia/Sydney', state: 'Finished', locationCheck: 'AtLocation', offRoster: false,
  adjustmentReason: null, payrollLinked: true, participantCount: 3, ...o,
})
const list = (...rows: unknown[]) => ({ rows, total: rows.length })

beforeEach(() => { apiGet.mockReset(); apiPost.mockReset() })

describe('Group activities group', () => {
  it('lists only finished rows, counted, with the activity, the actual hours and the plan', async () => {
    apiGet.mockResolvedValue(list(row('r1'), row('r2', { state: 'Started' }), row('r3', { state: 'NotStarted' })))
    renderGroup(() => useGroupStaffGroup(true))

    await screen.findByText('Staff r1')
    expect(apiGet).toHaveBeenCalledWith('/rostering/group-activities/staff-reviews')
    expect(subjects()).toEqual(['Staff r1'])
    expect(screen.getByRole('tab', { name: 'Group activities (1)' })).toBeInTheDocument()
    expect(headers()).toEqual(['Staff', 'Activity', 'Hours', 'Planned', 'Actions'])
    expect(facts('Staff r1')[0]).toBe('Bowling')
    expect(facts('Staff r1')[2]).toMatch(/^Planned 9/)
    expect(screen.getByRole('link', { name: 'Open completions' })).toHaveAttribute('href', '/rostering/completions')
  })

  it('approves a clean row by its row id', async () => {
    apiGet.mockResolvedValue(list(row('r1')))
    apiPost.mockResolvedValue([{ rowId: 'r1', ok: true, code: null, message: null }])
    renderGroup(() => useGroupStaffGroup(true))

    await userEvent.click(await screen.findByRole('button', { name: /^Approve hours: Staff r1 at Bowling/ }))

    expect(apiPost).toHaveBeenCalledWith('/rostering/group-activities/staff-reviews/approve', { rowIds: ['r1'] })
  })

  it('sends a flagged row to the full page instead of a one-tap approve', async () => {
    apiGet.mockResolvedValue(list(row('r1', { offRoster: true, payrollLinked: false })))
    renderGroup(() => useGroupStaffGroup(true))

    await screen.findByText('Staff r1')
    const r = rowOf('Staff r1')
    expect(within(r).getByText('Off roster')).toBeInTheDocument()
    expect(within(r).getByRole('link', { name: /^Review hours: Staff r1 at Bowling/ })).toHaveAttribute('href', '/rostering/completions')
    expect(within(r).queryByRole('button', { name: /^Approve hours/ })).not.toBeInTheDocument()
  })

  it('makes no request while it is off', () => {
    renderGroup(() => useGroupStaffGroup(false))

    expect(apiGet).not.toHaveBeenCalled()
  })
})
