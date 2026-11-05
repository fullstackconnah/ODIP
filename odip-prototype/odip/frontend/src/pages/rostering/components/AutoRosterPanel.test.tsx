import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AutoRosterPanel, type AutoRosterPanelProps } from './AutoRosterPanel'
import type { AutoRosterChangeDto, AutoRosterDraftDto } from '@/api/types'

// Monday: Ava on Mia 9-3 and Sam on Dan 10-2 (they overlap, so Sam is no choice for Ava's row). Tuesday: Jo on Dan 7pm-7am.
const change = (o: Partial<AutoRosterChangeDto>): AutoRosterChangeDto => ({
  shiftId: 's1', participantId: 'p1', participantName: 'Mia Chen', serviceDate: '2026-09-07', startTime: '09:00:00', endTime: '15:00:00',
  staffId: 'ava', staffName: 'Ava Nguyen', pick: 'Regular', rank: null, underGoal: false, regularAway: null, warnings: [], alternates: [], ...o,
})
const DRAFT: AutoRosterDraftDto = {
  weekStart: '2026-09-07', generatedAt: '2026-09-04T00:00:00Z', splits: [],
  changes: [
    change({ shiftId: 's1', alternates: [{ staffId: 'sam', staffName: 'Sam Lee', pick: 'Preferred', rank: 1 }, { staffId: 'jo', staffName: 'Jo Park', pick: 'Backup' }] }),
    change({ shiftId: 's2', participantId: 'p2', participantName: 'Dan Osei', staffId: 'sam', staffName: 'Sam Lee', pick: 'Preferred', rank: 2, underGoal: true, startTime: '10:00:00', endTime: '14:00:00',
      regularAway: 'Pat Kim is away: on approved leave', warnings: [{ code: 'PUBLIC_HOLIDAY', severity: 'Warning', message: 'Public holiday', requiresReason: false }] }),
    change({ shiftId: 's3', serviceDate: '2026-09-08', participantName: 'Dan Osei', staffId: 'jo', staffName: 'Jo Park', pick: 'Allowed', startTime: '19:00:00', endTime: '07:00:00' }),
  ],
  hours: [
    { staffId: 'ava', staffName: 'Ava Nguyen', employmentType: 'FullTime', goalHours: 38, goalIsDefault: true, rosteredHours: 10, draftHours: 6 },
    { staffId: 'sam', staffName: 'Sam Lee', employmentType: 'PartTime', goalHours: 20, goalIsDefault: false, rosteredHours: 0, draftHours: 4 },
    { staffId: 'jo', staffName: 'Jo Park', employmentType: 'Casual', goalHours: 0, goalIsDefault: false, rosteredHours: 0, draftHours: 12 },
    { staffId: 'zed', staffName: 'Zed Unused', employmentType: 'Casual', goalHours: 0, goalIsDefault: false, rosteredHours: 0, draftHours: 0 },
  ],
  uncovered: [
    { shiftId: 'u1', participantName: 'Eli Ford', serviceDate: '2026-09-09', startTime: '09:00:00', endTime: '15:00:00', reason: 'OnlyNoStaff',
      recommendations: [{ kind: 'Override', staffId: 'pat', text: 'Pat Kim can take it with a reason: Needs a reason' }, { kind: 'Soft', staffId: 'lee', text: 'Regular Lee: pending leave' }] },
    { shiftId: 'u2', participantName: 'Ava Nguyen', serviceDate: '2026-09-09', startTime: '16:00:00', endTime: '18:00:00', reason: 'ParticipantNotReady', recommendations: [] },
  ],
}

function setup(over: Partial<AutoRosterPanelProps> = {}, draft: AutoRosterDraftDto = DRAFT) {
  const props: AutoRosterPanelProps = {
    open: true, onClose: vi.fn(), description: '7 – 13 Sep 2026', run: { status: 'draft', draft }, onRetryRun: vi.fn(),
    onApply: vi.fn().mockResolvedValue({ applied: ['s1', 's2', 's3'], skipped: [] }), onApplied: vi.fn(), onArmedChange: vi.fn(), ...over,
  }
  return { props, user: userEvent.setup(), ...render(<AutoRosterPanel {...props} />) }
}
const applyButton = () => screen.getByRole('button', { name: /^Apply/ })

// Wednesday: Dan Osei 9am-5pm split at 1pm, Eli Brooks until 1pm, Jo Park after.
const SPLIT = {
  shiftId: 'x1', participantId: 'p2', participantName: 'Dan Osei', serviceDate: '2026-09-09', startTime: '09:00:00', endTime: '17:00:00', cutAt: '13:00:00',
  first: { staffId: 'eli', staffName: 'Eli Brooks' }, second: { staffId: 'jo', staffName: 'Jo Park' },
}
const WITH_SPLIT: AutoRosterDraftDto = { ...DRAFT, splits: [SPLIT] }

describe('a split in the draft roster panel', () => {
  it('is one row with both names, each with their part, the cut time, Leave open and no Change', () => {
    setup({}, WITH_SPLIT)
    const row = screen.getByText('Eli Brooks').closest('li')!
    expect(within(row).getByText('Jo Park')).toBeInTheDocument()
    expect(within(row).getByText('9am–\u20601pm')).toBeInTheDocument()
    expect(within(row).getByText('1pm–\u20605pm')).toBeInTheDocument()
    expect(within(row).getByText('Split at 1pm')).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: 'Leave Dan Osei 9am–5pm open' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Change' })).not.toBeInTheDocument()
    expect(applyButton()).toHaveTextContent('Apply 4 changes')
  })

  it('apply sends it as a split with the cut and both people, and Leave open then Undo moves it out of the disclosure and back', async () => {
    const { user, props } = setup({}, WITH_SPLIT)
    await user.click(screen.getByRole('button', { name: 'Leave Dan Osei 9am–5pm open' }))
    expect(applyButton()).toHaveTextContent('Apply 3 changes')
    await user.click(screen.getByRole('button', { name: 'Left open (1)' }))
    await user.click(screen.getByRole('button', { name: 'Put the split of Dan Osei 9am–5pm back' }))
    expect(applyButton()).toHaveTextContent('Apply 4 changes')
    await user.click(applyButton())
    expect(props.onApply).toHaveBeenCalledWith(expect.any(Array), [
      { shiftId: 'x1', startTime: '09:00:00', endTime: '17:00:00', cutAt: '13:00:00', firstStaffId: 'eli', secondStaffId: 'jo' },
    ])
  })

  it('never offers a person who has a half at an overlapping time, and counts each half’s own hours', async () => {
    const row = change({ shiftId: 's9', serviceDate: '2026-09-09', startTime: '10:00:00', endTime: '12:00:00', alternates: [{ staffId: 'eli', staffName: 'Eli Brooks', pick: 'Backup' }, { staffId: 'zed', staffName: 'Zed Unused', pick: 'Allowed' }] })
    const { user } = setup({}, { ...WITH_SPLIT, changes: [row] })
    await user.click(screen.getByRole('button', { name: 'Change' }))
    expect(await screen.findByRole('option', { name: /Zed Unused/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Eli Brooks/ })).not.toBeInTheDocument()   // Eli has the 9am to 1pm half
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('tab', { name: 'Hours' }))
    expect(screen.getAllByText('0 + 4 h')).toHaveLength(2)             // Eli's 9am to 1pm half is the same length, and is not in the pool list so gets its own row
  })
})

describe('the draft roster panel', () => {
  it('shows the Changes tab by day with the pick, under goal, away and warning lines, and counts the changes on the button', () => {
    setup()
    expect(screen.getByRole('tab', { name: /Changes/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'Mon 7 Sep' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Tue 8 Sep' })).toBeInTheDocument()
    expect(screen.getByText('Preferred #2')).toBeInTheDocument()
    expect(screen.getByText('under goal')).toBeInTheDocument()
    expect(screen.getByText('Pat Kim is away: on approved leave')).toBeInTheDocument()
    expect(screen.getByText('Public holiday')).toBeInTheDocument()
    expect(applyButton()).toHaveTextContent('Apply 3 changes')
  })

  it('removing a row leaves it open, under a collapsed disclosure, and Undo puts it back', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: /^Leave Mia Chen 9am–3pm open$/ }))
    expect(applyButton()).toHaveTextContent('Apply 2 changes')
    const toggle = screen.getByRole('button', { name: 'Left open (1)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: /^Put Ava Nguyen back on Mia Chen/ }))
    expect(applyButton()).toHaveTextContent('Apply 3 changes')
    expect(screen.queryByRole('button', { name: /Left open/ })).not.toBeInTheDocument()
  })

  it('Change offers the alternates, the row takes the pick and says who it was, and apply sends the new person', async () => {
    const { user, props } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Change' })[0])
    await user.click(await screen.findByRole('option', { name: /Jo Park/ }))
    expect(screen.getByText('Was Ava Nguyen')).toBeInTheDocument()
    await user.click(applyButton())
    expect(props.onApply).toHaveBeenCalledWith([
      { shiftId: 's1', staffId: 'jo' }, { shiftId: 's2', staffId: 'sam' }, { shiftId: 's3', staffId: 'jo' },
    ], [])
  })

  it('never offers a person who is on another kept row at an overlapping time', async () => {
    const { user } = setup()
    await user.click(screen.getAllByRole('button', { name: 'Change' })[0])
    expect(await screen.findByRole('option', { name: /Jo Park/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /Sam Lee/ })).not.toBeInTheDocument()
  })

  it('draft hours follow the kept rows, and the list covers everyone in the pool, heaviest load first', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('tab', { name: 'Hours' }))
    const names = () => screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[0].textContent)
    expect(names()[0]).toMatch(/^Jo Park/)   // a goal of 0 with hours counts first
    expect(names()[3]).toMatch(/^Zed Unused/)
    expect(screen.getByText('10 + 6 h')).toBeInTheDocument()
    expect(screen.getByText('0 + 12 h')).toBeInTheDocument()   // Jo's overnight shift runs past midnight
    await user.click(screen.getByRole('tab', { name: /Changes/ }))
    await user.click(screen.getByRole('button', { name: /^Leave Mia Chen 9am–3pm open$/ }))
    await user.click(screen.getByRole('tab', { name: 'Hours' }))
    expect(screen.getByText('10 + 0 h')).toBeInTheDocument()
  })

  it('Can’t cover gives each reason, the Override recommendation as display only, and no assign button', async () => {
    const { user } = setup()
    expect(screen.getByRole('tab', { name: /Can't cover/ })).toHaveTextContent('2')
    await user.click(screen.getByRole('tab', { name: /Can't cover/ }))
    expect(screen.getByText(/No one can be placed as it stands/)).toBeInTheDocument()
    expect(screen.getByText("Ava Nguyen isn't ready to be rostered yet.")).toBeInTheDocument()
    expect(screen.getByText('Needs a reason')).toBeInTheDocument()
    expect(screen.getByText(/Pat Kim can take it with a reason/)).toBeInTheDocument()
    expect(screen.getByText(/Assign them on the board/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /assign/i })).not.toBeInTheDocument()
  })

  it('opens on Can’t cover when nothing could be placed', () => {
    setup({}, { ...DRAFT, changes: [], hours: [] })
    expect(screen.getByRole('tab', { name: /Can't cover/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('with nothing to apply the button reads Apply changes and is disabled', () => {
    setup({}, { ...DRAFT, changes: [] })
    expect(applyButton()).toHaveTextContent('Apply changes')
    expect(applyButton()).toBeDisabled()
  })

  it('hands the server answer to the board, with each row’s display text', async () => {
    const { user, props } = setup({ onApply: vi.fn().mockResolvedValue({ applied: ['s2', 's3'], skipped: [{ shiftId: 's1', message: 'Already filled.' }] }) })
    await user.click(applyButton())
    await waitFor(() => expect(props.onApplied).toHaveBeenCalled())
    const [result, rows, stillOpen] = (props.onApplied as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(result.skipped).toEqual([{ shiftId: 's1', message: 'Already filled.' }])
    expect(rows[0]).toEqual({ shiftId: 's1', text: 'Mon 7 Sep, 9am–3pm, Ava Nguyen' })
    expect(stillOpen).toBe(2)   // the two uncovered shifts
  })

  it('a busy 409 keeps the draft and offers Try again, which sends the same rows', async () => {
    const onApply = vi.fn().mockRejectedValueOnce({ response: { status: 409, data: { errors: ['Another roster change is saving.'] } } }).mockResolvedValue({ applied: [], skipped: [] })
    const { user } = setup({ onApply })
    await user.click(applyButton())
    expect(await screen.findByText('Someone else is saving this week’s roster')).toBeInTheDocument()
    expect(screen.getByText(/Another roster change is saving\. Your draft is kept\./)).toBeInTheDocument()
    expect(applyButton()).toHaveTextContent('Apply 3 changes')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2))
    expect(onApply.mock.calls[1][0]).toEqual(onApply.mock.calls[0][0])
  })

  it('any other failure says nothing was saved', async () => {
    const { user } = setup({ onApply: vi.fn().mockRejectedValue({ response: { status: 500, data: {} } }) })
    await user.click(applyButton())
    expect(await screen.findByText('Couldn’t apply the draft')).toBeInTheDocument()
    expect(screen.getByText(/Nothing was saved\./)).toBeInTheDocument()
  })

  it('a failure with no response does not claim nothing was saved', async () => {
    const { user } = setup({ onApply: vi.fn().mockRejectedValue(new Error('Network Error')) })
    await user.click(applyButton())
    expect(await screen.findByText('We couldn’t confirm the apply')).toBeInTheDocument()
    expect(screen.getByText('Check the board before you apply again.')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing was saved/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('loading and a failed run each have one home, and the run error offers Try again', async () => {
    const { rerender, props, user } = setup({ run: { status: 'loading' } })
    expect(screen.getByRole('status')).toHaveTextContent('Drafting the week…')
    rerender(<AutoRosterPanel {...props} run={{ status: 'error', message: 'Choose an organisation to auto-roster its week.' }} />)
    expect(screen.getByText('Choose an organisation to auto-roster its week.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(props.onRetryRun).toHaveBeenCalled()
  })

  it('tells the board it is armed while a row is kept, and Discard closes at once', async () => {
    const { user, props } = setup()
    expect(props.onArmedChange).toHaveBeenLastCalledWith(true)
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(props.onClose).toHaveBeenCalled()
  })
})
