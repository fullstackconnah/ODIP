import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { GroupStaffReviewSection } from './GroupStaffReviewSection'
import type { GroupStaffReviewDto } from '@/api/types'

const { reviews, approveMutate, saveMutate } = vi.hoisted(() => ({
  reviews: { current: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() } as Record<string, unknown> },
  approveMutate: vi.fn(),
  saveMutate: vi.fn(),
}))

vi.mock('@/api/hooks', () => ({
  useGroupStaffReviews: () => reviews.current,
  useApproveGroupStaffRows: () => ({ mutate: approveMutate, isPending: false }),
  useSetGroupStaffActuals: () => ({ mutate: saveMutate, isPending: false }),
}))

const row = (over: Partial<GroupStaffReviewDto> = {}): GroupStaffReviewDto => ({
  rowId: 'r1', groupActivityId: 'ga1', activityTitle: 'Bowling', serviceDate: '2026-11-16', userId: 'u1', staffName: 'Wendy Worker', role: null,
  startTime: '09:00:00', endTime: '15:00:00', endsNextDay: false,
  actualStart: '2026-11-15T22:02:00Z', actualEnd: '2026-11-16T04:10:00Z', breakStartedAt: null, breakEndedAt: null, timeZoneId: 'Australia/Sydney',
  state: 'Finished', locationCheck: null, offRoster: false, adjustmentReason: null, payrollLinked: true, participantCount: 2, didNotAttendCount: 0,
  ...over,
})

const show = (rows: GroupStaffReviewDto[], total = rows.length) => {
  reviews.current = { data: { rows, total }, isLoading: false, isError: false, refetch: vi.fn() }
  return render(<GroupStaffReviewSection canReview />)
}

beforeEach(() => { approveMutate.mockReset(); saveMutate.mockReset() })

describe('GroupStaffReviewSection', () => {
  it('draws nothing when there are no rows, and a retry when the load fails', () => {
    const empty = show([])
    expect(empty.container).toBeEmptyDOMElement()
    empty.unmount()
    const refetch = vi.fn()
    reviews.current = { data: undefined, isLoading: false, isError: true, refetch }
    render(<GroupStaffReviewSection canReview />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('shows planned and actual times, the state and the flags', () => {
    show([
      row({ offRoster: true, locationCheck: 'NotAtLocation', payrollLinked: false, adjustmentReason: 'Phone died' }),
      row({ rowId: 'r2', staffName: 'Sam Started', state: 'Started', actualEnd: null }),
      row({ rowId: 'r3', staffName: 'Nora NotStarted', state: 'NotStarted', actualStart: null, actualEnd: null }),
    ])
    expect(screen.getByRole('heading', { name: 'Group activity staff (3)' })).toBeInTheDocument()
    expect(screen.getAllByText(/9:02 am – 3:10 pm/).length).toBeGreaterThan(0)
    for (const flag of ['Off roster', 'Off site', 'No payroll ID', 'Edited']) expect(screen.getAllByText(flag).length).toBeGreaterThan(0)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getAllByTitle('Phone died').length).toBeGreaterThan(0)
  })

  it('Approve is offered on Finished rows only and sends a batch of one', () => {
    show([row(), row({ rowId: 'r2', staffName: 'Sam Started', state: 'Started', actualEnd: null })])
    expect(screen.getAllByRole('button', { name: /^Approve Wendy/ }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /^Approve Sam/ })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /^Approve Wendy/ })[0])
    expect(approveMutate.mock.calls[0][0]).toEqual(['r1'])
  })

  it('bulk approve confirms with the count, and lists failures afterwards', () => {
    show([row(), row({ rowId: 'r2', staffName: 'Fred Finished' })])
    for (const box of screen.getAllByRole('checkbox', { name: /select all/i }).slice(0, 1)) fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: /Approve selected \(2\)/ }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('2 staff shifts will be approved and sent to payroll.')).toBeInTheDocument()
    approveMutate.mockImplementation((_ids, opts) => opts.onSuccess([
      { rowId: 'r1', ok: true, code: null, message: null },
      { rowId: 'r2', ok: false, code: 'GA_STAFF_NOT_FINISHED', message: 'Not finished yet.' },
    ]))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }))
    expect(approveMutate.mock.calls[0][0]).toEqual(['r1', 'r2'])
    expect(screen.getByText(/Fred Finished, Bowling: Not finished yet\./)).toBeInTheDocument()
  })

  it('the partial-approve Dismiss meets the touch minimum', () => {
    show([row(), row({ rowId: 'r2', staffName: 'Fred Finished' })])
    fireEvent.click(screen.getAllByRole('checkbox', { name: /select all/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /Approve selected \(2\)/ }))
    approveMutate.mockImplementation((_ids, opts) => opts.onSuccess([{ rowId: 'r2', ok: false, code: 'GA_STAFF_NOT_FINISHED', message: 'Not finished yet.' }]))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Approve' }))
    expect(screen.getByRole('button', { name: 'Dismiss' }).className).toContain('pointer-coarse:min-h-[var(--tap-min)]')
  })

  it('Record times maps a reason refusal to the reason field and keeps the modal open', () => {
    show([row({ state: 'Started', actualEnd: null })])
    fireEvent.click(screen.getAllByRole('button', { name: /^Record times for Wendy/ })[0])
    const modal = screen.getByRole('dialog')
    fireEvent.change(within(modal).getByLabelText('Finish'), { target: { value: '2026-11-16T15:10' } })
    fireEvent.click(within(modal).getByRole('button', { name: 'Save times' }))
    expect(within(modal).getByRole('alert')).toHaveTextContent('Enter why these times are being recorded.')
    expect(saveMutate).not.toHaveBeenCalled()
    fireEvent.change(within(modal).getByLabelText('Reason'), { target: { value: 'Phone died' } })
    saveMutate.mockImplementation((_v, opts) => opts.onError({ response: { status: 409, data: { code: 'GA_ACTUALS_LONG', message: 'These times are over 24 hours. Record times first.' } } }))
    fireEvent.click(within(modal).getByRole('button', { name: 'Save times' }))
    expect(saveMutate.mock.calls[0][0].data).toMatchObject({ actualStart: '2026-11-15T22:02:00Z', actualEnd: '2026-11-16T04:10:00Z', reason: 'Phone died' })
    expect(within(modal).getByRole('alert')).toHaveTextContent('These times are over 24 hours. Record times first.')
    expect(within(modal).getByLabelText('Finish')).toHaveAttribute('aria-invalid', 'true')
  })
})

describe('GroupStaffReviewSection attendance', () => {
  const APPROVE_LINE = 'Approving marks everyone still on this activity as attended.'

  it("summarises who is attending under the activity, and who did not come only when someone did not", () => {
    show([row({ participantCount: 2, didNotAttendCount: 1 }), row({ rowId: 'r2', groupActivityId: 'ga2', activityTitle: 'Swimming', participantCount: 3 })])
    expect(screen.getAllByText("2 attending · 1 didn't attend").length).toBeGreaterThan(0)
    expect(screen.getAllByText('3 attending').length).toBeGreaterThan(0)
    expect(screen.queryByText(/0 didn't attend/)).toBeNull()
  })

  it('says approving completes the activity only on a Finished row no other listed row shares', () => {
    show([row(), row({ rowId: 'r2', groupActivityId: 'ga2', activityTitle: 'Swimming', staffName: 'Sam Started', state: 'Started', actualEnd: null })])
    expect(screen.getAllByText(APPROVE_LINE).length).toBeGreaterThan(0)
  })

  it('leaves the line off when another listed row is on the same activity, or the row is not Finished', () => {
    show([row(), row({ rowId: 'r2', staffName: 'Fred Finished' }), row({ rowId: 'r3', groupActivityId: 'ga3', staffName: 'Sam Started', state: 'Started', actualEnd: null })])
    expect(screen.queryByText(APPROVE_LINE)).toBeNull()
  })

  it('adds the same sentence to the Approve selected confirm when a selected row completes its activity', () => {
    show([row(), row({ rowId: 'r2', groupActivityId: 'ga2', activityTitle: 'Swimming', staffName: 'Fred Finished' })])
    fireEvent.click(screen.getAllByRole('checkbox', { name: /select all/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /Approve selected \(2\)/ }))
    expect(within(screen.getByRole('alertdialog')).getByText('Approving marks everyone still on these activities as attended.')).toBeInTheDocument()
  })

  it('keeps the confirm unchanged when no selected row completes its activity', () => {
    show([row(), row({ rowId: 'r2', staffName: 'Fred Finished' })])
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select row r1' }))
    fireEvent.click(screen.getByRole('button', { name: /Approve selected \(1\)/ }))
    expect(within(screen.getByRole('alertdialog')).queryByText(/marks everyone still on/)).toBeNull()
  })

  it('reads "this activity" when one activity completes, even with two rows selected on it', () => {
    show([row(), row({ rowId: 'r2', staffName: 'Fred Finished' })])
    fireEvent.click(screen.getAllByRole('checkbox', { name: /select all/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /Approve selected \(2\)/ }))
    expect(within(screen.getByRole('alertdialog')).getByText(APPROVE_LINE)).toBeInTheDocument()
  })

  it('reads "these activities" when two activities complete, one of them through two selected rows', () => {
    show([row(), row({ rowId: 'r2', groupActivityId: 'ga2', activityTitle: 'Swimming', staffName: 'Fred Finished' }), row({ rowId: 'r3', groupActivityId: 'ga2', activityTitle: 'Swimming', staffName: 'Gus Finished' })])
    fireEvent.click(screen.getAllByRole('checkbox', { name: /select all/i })[0])
    fireEvent.click(screen.getByRole('button', { name: /Approve selected \(3\)/ }))
    expect(within(screen.getByRole('alertdialog')).getByText('Approving marks everyone still on these activities as attended.')).toBeInTheDocument()
  })
})
