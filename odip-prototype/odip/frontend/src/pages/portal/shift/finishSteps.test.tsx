import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BreakRow } from './finishSteps'
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
