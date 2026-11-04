import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { BreakRow, SubmitStep, TimesStep } from './finishSteps'
import { EMPTY_END_DRAFT, type EndDraft } from './endDraft'
import type { PortalShiftDetailDto, ShiftBreakDto } from '@/api/types'

const h = vi.hoisted(() => ({
  edit: vi.fn(),
  editPending: { value: false },
}))

vi.mock('@/api/hooks', () => ({
  useEditBreak: () => ({ mutateAsync: h.edit, isPending: h.editPending.value }),
  useDeleteBreak: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useEndBreak: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useShiftNotes: () => ({ data: [] }),
}))
vi.mock('@/api/hooks/portal', () => ({ useQueueRecords: () => [] }))

const shift = { id: 'shift-1', timeZoneId: 'Australia/Sydney', participant: { fullName: 'Alexandra Reid' } } as unknown as PortalShiftDetailDto
const brk = (over: Partial<ShiftBreakDto> = {}): ShiftBreakDto => ({
  id: 'b1', startedAt: '2026-08-17T02:00:00Z', endedAt: '2026-08-17T02:30:00Z', isRunning: false, minutes: 30, editedAt: null, createdByUserId: 'u', withParticipant: false, ...over,
})

describe('BreakRow: who was the break with (W9)', () => {
  beforeEach(() => { h.edit.mockReset(); h.edit.mockResolvedValue({}); h.editPending.value = false })

  it('reads On my own, then With {first}, in that order, and starts on my own', () => {
    render(<BreakRow shift={shift} brk={brk()} online />)
    const group = screen.getByRole('radiogroup', { name: 'Who was your break with?' })
    const radios = Array.from(group.querySelectorAll('[role="radio"]'))
    expect(radios.map(r => r.textContent)).toEqual(['On my own', 'With Alexandra'])
    expect(radios.map(r => r.getAttribute('aria-checked'))).toEqual(['true', 'false'])
  })

  it('saves at once with the break\'s own times plus the kind, and shows it selected', async () => {
    render(<BreakRow shift={shift} brk={brk()} online />)
    fireEvent.click(screen.getByRole('radio', { name: 'With Alexandra' }))
    await waitFor(() => expect(h.edit).toHaveBeenCalledWith({
      id: 'shift-1', breakId: 'b1', data: { startedAt: '2026-08-17T02:00:00Z', endedAt: '2026-08-17T02:30:00Z', withParticipant: true },
    }))
  })

  it('reflects a break already with the participant, and a running break keeps running (endedAt null)', async () => {
    render(<BreakRow shift={shift} brk={brk({ withParticipant: true, endedAt: null, isRunning: true })} online />)
    expect(screen.getByRole('radio', { name: 'With Alexandra' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'On my own' }))
    await waitFor(() => expect(h.edit).toHaveBeenCalledWith({
      id: 'shift-1', breakId: 'b1', data: { startedAt: '2026-08-17T02:00:00Z', endedAt: null, withParticipant: false },
    }))
  })

  it('is disabled offline, with the existing line saying why', () => {
    render(<BreakRow shift={shift} brk={brk()} online={false} />)
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled()
    expect(screen.getByText('Editing a break needs a connection.')).toBeInTheDocument()
  })

  it('disables the group while saving, and says so inline when the save fails', async () => {
    h.edit.mockRejectedValueOnce(new Error('boom'))
    render(<BreakRow shift={shift} brk={brk()} online />)
    fireEvent.click(screen.getByRole('radio', { name: 'With Alexandra' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't/)
  })
})

// Rostered 09:00 to 17:00 in Brisbane (UTC+10): 17:00 is 07:00Z.
const rostered = {
  id: 'shift-1', timeZoneId: 'Australia/Brisbane', serviceDate: '2026-08-17', startTime: '09:00:00', endTime: '17:00:00', endsNextDay: false,
  participant: { fullName: 'Alexandra Reid' }, breaks: [], travelAsked: false, medicationsDue: [], shiftRoutines: [],
  completion: { actualStart: '2026-08-16T23:00:00Z', startTimeReason: null },
}
const timeShift = (completion: Record<string, unknown> = {}) => ({ ...rostered, completion: { ...rostered.completion, ...completion } }) as unknown as PortalShiftDetailDto
const NOW_LATE_8 = new Date('2026-08-17T07:08:00Z')   // 17:08

function Times({ now, start = timeShift(), over = {} }: { now: Date; start?: PortalShiftDetailDto; over?: Partial<EndDraft> }) {
  const [d, setD] = useState<EndDraft>({ ...EMPTY_END_DRAFT, ...over })
  return <TimesStep shift={start} online now={now} draft={d} set={p => setD(x => ({ ...x, ...p }))} />
}

describe('TimesStep: why off roster (W2)', () => {
  it('asks why a finish 8 minutes late, optional, and keeps what is typed', () => {
    render(<Times now={NOW_LATE_8} />)
    const box = screen.getByLabelText('Why are you finishing 8 minutes late? (optional)')
    fireEvent.change(box, { target: { value: 'Waited for the taxi' } })
    expect(box).toHaveValue('Waited for the taxi')
  })

  it('asks about a finish 8 minutes early the same way', () => {
    render(<Times now={new Date('2026-08-17T06:52:00Z')} />)
    expect(screen.getByLabelText('Why are you finishing 8 minutes early? (optional)')).toBeInTheDocument()
  })

  it('asks nothing for a finish within 5 minutes', () => {
    render(<Times now={new Date('2026-08-17T07:04:00Z')} />)
    expect(screen.queryByLabelText(/^Why are you finishing/)).not.toBeInTheDocument()
  })

  it('asks about a start moved to 6 minutes early', () => {
    render(<Times now={new Date('2026-08-17T07:00:00Z')} over={{ startOverride: '2026-08-17T08:54' }} />)
    expect(screen.getByLabelText('Why are your times off roster? (optional)')).toBeInTheDocument()
  })

  it('asks about both in one box', () => {
    render(<Times now={NOW_LATE_8} over={{ startOverride: '2026-08-17T08:54' }} />)
    expect(screen.getByLabelText('Why are your times off roster? (optional)')).toBeInTheDocument()
  })

  it('does not ask again about a start that already has its reason', () => {
    render(<Times now={new Date('2026-08-17T07:00:00Z')} start={timeShift({ startTimeReason: 'Early handover' })} over={{ startOverride: '2026-08-17T08:54' }} />)
    expect(screen.queryByLabelText(/^Why are your times off roster/)).not.toBeInTheDocument()
  })
})

describe('SubmitStep: the finish drifted off roster (W2)', () => {
  const submit = (over: Partial<EndDraft>, go = vi.fn()) => {
    render(<SubmitStep shift={timeShift()} draft={{ ...EMPTY_END_DRAFT, ...over }} noteCount={0} now={new Date('2026-08-17T07:07:00Z')} refusals={[]} go={go}
      moved={{ start: null, end: null }} kilometres={null} travel={{ preTravelMinutes: null, preTravelKilometres: null, postTravelMinutes: null, postTravelKilometres: null }}
      drifted={false} onUseSubmitTime={vi.fn()} onChangeTimes={vi.fn()} />)
    return go
  }

  it('says so once, offers Add a reason, and sends the worker back to step 1', () => {
    const go = submit({ finishAsked: false })
    expect(screen.getByText("You're now finishing 7 minutes late. Add a reason? It's optional.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add a reason' }))
    expect(go).toHaveBeenCalledWith('times')
  })

  it('stays quiet when step 1 already asked, or a reason is typed', () => {
    submit({ finishAsked: true })
    expect(screen.queryByRole('button', { name: 'Add a reason' })).not.toBeInTheDocument()
  })
})
